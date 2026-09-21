import { describe, expect, it } from "vitest";
import { applyMarkdownCommand, type TextSelection } from "./markdown-edit-commands";

function sel(value: string, start: number, end = start): TextSelection {
  return { value, start, end };
}

describe("applyMarkdownCommand — wrapping commands", () => {
  it("wraps a selection in bold markers", () => {
    const result = applyMarkdownCommand("bold", sel("Hello world", 6, 11));
    expect(result.value).toBe("Hello **world**");
    expect(result.value.slice(result.start, result.end)).toBe("world");
  });

  it("inserts a placeholder, pre-selected, when nothing is selected", () => {
    const result = applyMarkdownCommand("italic", sel("Hello ", 6));
    expect(result.value).toBe("Hello *italic text*");
    expect(result.value.slice(result.start, result.end)).toBe("italic text");
  });

  it("wraps a selection in inline code", () => {
    const result = applyMarkdownCommand("code", sel("run npm test now", 4, 12));
    expect(result.value).toBe("run `npm test` now");
  });

  it("builds a markdown link around the selection", () => {
    const result = applyMarkdownCommand("link", sel("See Old Port for details", 4, 12));
    expect(result.value).toBe("See [Old Port](url) for details");
  });

  it("wraps a selection as a wikilink with no placeholder needed", () => {
    const result = applyMarkdownCommand("wikilink", sel("Visit Old Port today", 6, 14));
    expect(result.value).toBe("Visit [[Old Port]] today");
  });

  it("wraps an empty wikilink selection with the cursor left inside the brackets", () => {
    const result = applyMarkdownCommand("wikilink", sel("Visit  today", 6));
    expect(result.value).toBe("Visit [[]] today");
    expect(result.start).toBe(8);
    expect(result.end).toBe(8);
  });
});

describe("applyMarkdownCommand — code block", () => {
  it("fences the selection on its own lines", () => {
    const result = applyMarkdownCommand("codeBlock", sel("before\nconst x = 1;\nafter", 7, 19));
    expect(result.value).toBe("before\n```\nconst x = 1;\n```\nafter");
  });
});

describe("applyMarkdownCommand — line-prefix commands (toggle)", () => {
  it("adds a heading prefix to the current line when nothing is selected", () => {
    const result = applyMarkdownCommand("heading", sel("Old Port", 3));
    expect(result.value).toBe("## Old Port");
  });

  it("removes the heading prefix on a second application (toggle)", () => {
    const once = applyMarkdownCommand("heading", sel("Old Port", 3));
    const twice = applyMarkdownCommand("heading", sel(once.value, once.start, once.end));
    expect(twice.value).toBe("Old Port");
  });

  it("applies a bullet list prefix to every line of a multi-line selection", () => {
    const value = "one\ntwo\nthree";
    const result = applyMarkdownCommand("bulletList", sel(value, 0, value.length));
    expect(result.value).toBe("- one\n- two\n- three");
  });

  it("removes the bullet prefix from every line when all are already prefixed", () => {
    const value = "- one\n- two\n- three";
    const result = applyMarkdownCommand("bulletList", sel(value, 0, value.length));
    expect(result.value).toBe("one\ntwo\nthree");
  });

  it("does not toggle off when only some of the selected lines have the prefix", () => {
    const value = "- one\ntwo\n- three";
    const result = applyMarkdownCommand("bulletList", sel(value, 0, value.length));
    expect(result.value).toBe("- - one\n- two\n- - three");
  });

  it("applies a numbered list prefix per line", () => {
    const value = "first\nsecond";
    const result = applyMarkdownCommand("numberedList", sel(value, 0, value.length));
    expect(result.value).toBe("1. first\n1. second");
  });

  it("applies a blockquote prefix per line", () => {
    const value = "line one\nline two";
    const result = applyMarkdownCommand("quote", sel(value, 0, value.length));
    expect(result.value).toBe("> line one\n> line two");
  });

  it("only affects the lines touched by the selection, not the whole document", () => {
    const value = "keep me\ntarget line\nkeep me too";
    const targetStart = value.indexOf("target line");
    const targetEnd = targetStart + "target line".length;
    const result = applyMarkdownCommand("quote", sel(value, targetStart, targetEnd));
    expect(result.value).toBe("keep me\n> target line\nkeep me too");
  });

  it("skips blank lines within a multi-line selection rather than prefixing them", () => {
    const value = "one\n\ntwo";
    const result = applyMarkdownCommand("bulletList", sel(value, 0, value.length));
    expect(result.value).toBe("- one\n\n- two");
  });
});
