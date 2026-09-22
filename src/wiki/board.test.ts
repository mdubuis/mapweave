import { describe, expect, it } from "vitest";
import {
  type BoardData,
  extractBoardData,
  extractBoardDataForTab,
  replaceBoardBlock,
  replaceBoardBlockForTab,
  replaceBoardBlockForTabInRaw,
  replaceBoardBlockInRaw
} from "./board";

const sample: BoardData = {
  items: [
    { id: "a", kind: "text", x: 10, y: 20, width: 200, height: 100, content: "Hello" },
    { id: "b", kind: "image", x: 300, y: 40, width: 150, height: 150, content: "data:image/png;base64,xyz" }
  ],
  connectors: [{ id: "c1", from: "a", to: "b" }]
};

describe("extractBoardData", () => {
  it("returns an empty board when there is no ```board block", () => {
    expect(extractBoardData("Just some prose.\n\nMore text.")).toEqual({ items: [], connectors: [] });
  });

  it("returns an empty board for an empty body", () => {
    expect(extractBoardData("")).toEqual({ items: [], connectors: [] });
  });

  it("parses items and connectors from a ```board block", () => {
    const body = `Some intro text.\n\n\`\`\`board\n${JSON.stringify(sample)}\n\`\`\`\n`;
    expect(extractBoardData(body)).toEqual(sample);
  });

  it("falls back to an empty board on malformed JSON rather than throwing", () => {
    const body = "```board\nnot valid json {{{\n```";
    expect(() => extractBoardData(body)).not.toThrow();
    expect(extractBoardData(body)).toEqual({ items: [], connectors: [] });
  });

  it("falls back to an empty board when the fence is never closed", () => {
    const body = `\`\`\`board\n${JSON.stringify(sample)}`;
    expect(extractBoardData(body)).toEqual({ items: [], connectors: [] });
  });

  it("defaults missing items/connectors arrays to empty rather than undefined", () => {
    const body = "```board\n{}\n```";
    expect(extractBoardData(body)).toEqual({ items: [], connectors: [] });
  });
});

describe("replaceBoardBlock", () => {
  it("appends a new block to a body with none", () => {
    const result = replaceBoardBlock("Some prose.", sample);
    expect(result).toBe(`Some prose.\n\n\`\`\`board\n${JSON.stringify(sample)}\n\`\`\`\n`);
  });

  it("appends a block to an empty body without a leading blank line", () => {
    const result = replaceBoardBlock("", sample);
    expect(result).toBe(`\`\`\`board\n${JSON.stringify(sample)}\n\`\`\`\n`);
  });

  it("replaces an existing block in place, leaving surrounding text untouched", () => {
    const before = `Intro.\n\n\`\`\`board\n${JSON.stringify({ items: [], connectors: [] })}\n\`\`\`\n\nOutro.`;
    const result = replaceBoardBlock(before, sample);
    expect(result).toBe(`Intro.\n\n\`\`\`board\n${JSON.stringify(sample)}\n\`\`\`\n\nOutro.`);
  });

  it("round-trips through extractBoardData exactly", () => {
    const written = replaceBoardBlock("Notes here.", sample);
    expect(extractBoardData(written)).toEqual(sample);
  });

  it("handles an unterminated existing block by treating the rest of the body as the block", () => {
    const before = "Intro.\n\n```board\nold data";
    const result = replaceBoardBlock(before, sample);
    expect(result).toBe(`Intro.\n\n\`\`\`board\n${JSON.stringify(sample)}\n\`\`\``);
    expect(extractBoardData(result)).toEqual(sample);
  });
});

describe("replaceBoardBlockInRaw", () => {
  it("preserves the frontmatter block untouched and only rewrites the body", () => {
    const raw = "---\ntitle: My Board\ntype: board\n---\nSome notes.";
    const result = replaceBoardBlockInRaw(raw, sample);
    expect(result).toBe(
      `---\ntitle: My Board\ntype: board\n---\nSome notes.\n\n\`\`\`board\n${JSON.stringify(sample)}\n\`\`\`\n`
    );
  });

  it("replaces an existing board block without disturbing the frontmatter", () => {
    const raw = `---\ntitle: My Board\ntype: board\n---\n\`\`\`board\n${JSON.stringify({ items: [], connectors: [] })}\n\`\`\`\n`;
    const result = replaceBoardBlockInRaw(raw, sample);
    expect(result).toBe(`---\ntitle: My Board\ntype: board\n---\n\`\`\`board\n${JSON.stringify(sample)}\n\`\`\`\n`);
  });

  it("falls back to treating the whole text as body when there is no frontmatter", () => {
    const raw = "Just prose, no frontmatter.";
    const result = replaceBoardBlockInRaw(raw, sample);
    expect(result).toBe(`Just prose, no frontmatter.\n\n\`\`\`board\n${JSON.stringify(sample)}\n\`\`\`\n`);
  });

  it("round-trips: extractBoardData on the result's body-equivalent matches the input", () => {
    const raw = "---\ntitle: Board\ntype: board\n---\n";
    const written = replaceBoardBlockInRaw(raw, sample);
    const bodyStart = written.indexOf("\n---\n") + "\n---\n".length;
    expect(extractBoardData(written.slice(bodyStart))).toEqual(sample);
  });
});

describe("extractBoardDataForTab / replaceBoardBlockForTab", () => {
  it("returns an empty board when the tab has no block yet", () => {
    expect(extractBoardDataForTab("Some prose.", "tab-1")).toEqual({ items: [], connectors: [] });
  });

  it("round-trips sample data through a tab-keyed block", () => {
    const written = replaceBoardBlockForTab("Notes.", "tab-2", sample);
    expect(extractBoardDataForTab(written, "tab-2")).toEqual(sample);
  });

  it("keeps two different tabs' board data independent", () => {
    let body = "A multi-tab page.";
    body = replaceBoardBlockForTab(body, "tab-a", sample);
    body = replaceBoardBlockForTab(body, "tab-b", { items: [], connectors: [] });

    expect(extractBoardDataForTab(body, "tab-a")).toEqual(sample);
    expect(extractBoardDataForTab(body, "tab-b")).toEqual({ items: [], connectors: [] });
  });

  it("never reads the singular ```board fence a type: board entity uses", () => {
    const body = `\`\`\`board\n${JSON.stringify(sample)}\n\`\`\`\n`;
    expect(extractBoardDataForTab(body, "tab-1")).toEqual({ items: [], connectors: [] });
  });

  it("writing a tab's block does not disturb an existing singular ```board fence", () => {
    const before = `\`\`\`board\n${JSON.stringify(sample)}\n\`\`\`\n`;
    const after = replaceBoardBlockForTab(before, "tab-1", { items: [], connectors: [] });
    expect(extractBoardData(after)).toEqual(sample);
    expect(extractBoardDataForTab(after, "tab-1")).toEqual({ items: [], connectors: [] });
  });

  it("falls back to an empty board on malformed JSON in a tab block", () => {
    const body = "```board:tab-1\nnot valid json {{{\n```";
    expect(() => extractBoardDataForTab(body, "tab-1")).not.toThrow();
    expect(extractBoardDataForTab(body, "tab-1")).toEqual({ items: [], connectors: [] });
  });
});

describe("replaceBoardBlockForTabInRaw", () => {
  it("preserves the frontmatter block untouched and only rewrites the tab's block in the body", () => {
    const raw = "---\ntitle: A City Page\n---\nSome prose.";
    const result = replaceBoardBlockForTabInRaw(raw, "tab-1", sample);
    expect(result).toBe(
      `---\ntitle: A City Page\n---\nSome prose.\n\n\`\`\`board:tab-1\n${JSON.stringify(sample)}\n\`\`\`\n`
    );
  });

  it("round-trips through extractBoardDataForTab, unaffected by the frontmatter block", () => {
    const raw = "---\ntitle: A City Page\ntabs:\n  overview:\n    type: wiki\n---\nNotes.";
    const written = replaceBoardBlockForTabInRaw(raw, "board-tab", sample);
    const bodyStart = written.indexOf("---\nNotes.") + "---\n".length;
    expect(extractBoardDataForTab(written.slice(bodyStart), "board-tab")).toEqual(sample);
  });

  it("falls back to treating the whole text as body when there is no frontmatter", () => {
    const raw = "Just prose, no frontmatter.";
    const result = replaceBoardBlockForTabInRaw(raw, "tab-1", sample);
    expect(result).toBe(`Just prose, no frontmatter.\n\n\`\`\`board:tab-1\n${JSON.stringify(sample)}\n\`\`\`\n`);
  });
});
