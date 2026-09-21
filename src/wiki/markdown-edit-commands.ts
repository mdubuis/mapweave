/**
 * Toolbar/keyboard-shortcut logic for the wiki editor's plain `<textarea>` — inserts or wraps
 * Markdown syntax around the current selection, rather than a WYSIWYG editor. The wiki's storage
 * format stays plain Markdown text either way: no HTML round-trip, no serializer (see markdown.ts's
 * header comment on why this repo avoids one). Pure string logic, no DOM — wiki-main.ts wires this
 * to an actual textarea's selectionStart/selectionEnd.
 */

export interface TextSelection {
  value: string;
  start: number;
  end: number;
}

export type MarkdownCommand =
  | "bold"
  | "italic"
  | "code"
  | "link"
  | "wikilink"
  | "heading"
  | "bulletList"
  | "numberedList"
  | "quote"
  | "codeBlock";

function wrapSelection(selection: TextSelection, before: string, after: string, placeholder: string): TextSelection {
  const { value, start, end } = selection;
  const hasSelection = end > start;
  const inner = hasSelection ? value.slice(start, end) : placeholder;
  const newValue = value.slice(0, start) + before + inner + after + value.slice(end);
  return { value: newValue, start: start + before.length, end: start + before.length + inner.length };
}

/** Wraps the selection in its own paragraph of ```-fenced lines — always inserts newlines around
 *  the fence so the block doesn't merge into surrounding prose, per markdown.ts's line-based fence
 *  detection (a fence line must start with ```` ``` ````, nothing else on it). */
function wrapCodeBlock(selection: TextSelection): TextSelection {
  const { value, start, end } = selection;
  const inner = end > start ? value.slice(start, end) : "code";
  const before = "```\n";
  const after = "\n```";
  const newValue = value.slice(0, start) + before + inner + after + value.slice(end);
  return { value: newValue, start: start + before.length, end: start + before.length + inner.length };
}

function lineRange(value: string, start: number, end: number): { lineStart: number; lineEnd: number } {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextNewline = value.indexOf("\n", Math.max(end - 1, lineStart));
  const lineEnd = nextNewline === -1 ? value.length : nextNewline;
  return { lineStart, lineEnd };
}

/** Prefixes every non-empty line touched by the selection with `prefix` — a toggle: if every such
 *  line already has it, removes it instead of doubling up. */
function togglePrefix(selection: TextSelection, prefix: string): TextSelection {
  const { value, start, end } = selection;
  const { lineStart, lineEnd } = lineRange(value, start, end);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const contentLines = lines.filter(line => line !== "");
  const allPrefixed = contentLines.length > 0 && contentLines.every(line => line.startsWith(prefix));

  const newLines = lines.map(line => {
    if (line === "") return line;
    return allPrefixed ? line.slice(prefix.length) : prefix + line;
  });
  const newBlock = newLines.join("\n");
  const newValue = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
  return { value: newValue, start: lineStart, end: lineStart + newBlock.length };
}

export function applyMarkdownCommand(command: MarkdownCommand, selection: TextSelection): TextSelection {
  switch (command) {
    case "bold":
      return wrapSelection(selection, "**", "**", "bold text");
    case "italic":
      return wrapSelection(selection, "*", "*", "italic text");
    case "code":
      return wrapSelection(selection, "`", "`", "code");
    case "link":
      return wrapSelection(selection, "[", "](url)", "link text");
    case "wikilink":
      return wrapSelection(selection, "[[", "]]", "");
    case "codeBlock":
      return wrapCodeBlock(selection);
    case "heading":
      return togglePrefix(selection, "## ");
    case "bulletList":
      return togglePrefix(selection, "- ");
    case "numberedList":
      return togglePrefix(selection, "1. ");
    case "quote":
      return togglePrefix(selection, "> ");
  }
}
