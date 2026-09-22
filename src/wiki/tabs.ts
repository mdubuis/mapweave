/**
 * Fenced-block storage for multi-tab page content (Phase 6 "Phase 2" — see MAPWEAVE.md/the approved
 * plan). Extends board.ts's ```board convention — itself chosen because the hand-rolled YAML-lite
 * frontmatter parser can't hold an array of objects — to be keyed by tab id, since a page can now
 * carry more than one non-wiki tab. Fence shape: ```<kind>:<tabId> ... ``` — e.g. ```board:tab-2,
 * ```map:tab-3. Deliberately generic: this module only knows fence syntax, not what a "board" or
 * "map" tab's JSON actually means — see board.ts's extractBoardDataForTab for the board-specific
 * validation on top of this.
 */

const FENCE_END = /^```\s*$/;

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tabFenceRe(kind: string, tabId: string): RegExp {
  return new RegExp(`^\`\`\`${escapeForRegExp(`${kind}:${tabId}`)}\\s*$`);
}

/** The raw JSON text inside a ```<kind>:<tabId> block, or null if the block is absent/unterminated.
 *  Callers parse and validate the shape themselves — see board.ts's extractBoardDataForTab. */
export function extractTabBlockJson(body: string, kind: string, tabId: string): string | null {
  const lines = body.split("\n");
  const fenceRe = tabFenceRe(kind, tabId);
  const start = lines.findIndex(line => fenceRe.test(line));
  if (start === -1) return null;

  const end = lines.findIndex((line, i) => i > start && FENCE_END.test(line));
  if (end === -1) return null;

  return lines.slice(start + 1, end).join("\n");
}

/** Replaces (or appends) the ```<kind>:<tabId> block with `data` (JSON-stringified), leaving the
 *  rest of the body untouched — targeted text edit, not reparse+reserialize, same approach as
 *  board.ts/frontmatter-patch.ts/map-ref-patch.ts. */
export function replaceTabBlock(body: string, kind: string, tabId: string, data: unknown): string {
  const block = `\`\`\`${kind}:${tabId}\n${JSON.stringify(data)}\n\`\`\``;
  const lines = body.split("\n");
  const fenceRe = tabFenceRe(kind, tabId);
  const start = lines.findIndex(line => fenceRe.test(line));

  if (start === -1) {
    const trimmed = body.replace(/\s+$/, "");
    return trimmed.length ? `${trimmed}\n\n${block}\n` : `${block}\n`;
  }

  const end = lines.findIndex((line, i) => i > start && FENCE_END.test(line));
  const before = lines.slice(0, start);
  const after = end === -1 ? [] : lines.slice(end + 1);
  return [...before, block, ...after].join("\n");
}
