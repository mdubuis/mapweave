import { describe, expect, it } from "vitest";
import { type BoardData, extractBoardData, replaceBoardBlock, replaceBoardBlockInRaw } from "./board";

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
