import { describe, expect, it } from "vitest";
import { extractTabBlockJson, replaceTabBlock } from "./tabs";

describe("extractTabBlockJson", () => {
  it("returns null when no block for that kind/tabId exists", () => {
    expect(extractTabBlockJson("Just prose.", "board", "tab-1")).toBeNull();
  });

  it("extracts the raw JSON text for a matching kind:tabId fence", () => {
    const body = 'Intro.\n\n```board:tab-2\n{"items":[]}\n```\n';
    expect(extractTabBlockJson(body, "board", "tab-2")).toBe('{"items":[]}');
  });

  it("does not match a block with the same kind but a different tabId", () => {
    const body = '```board:tab-2\n{"items":[]}\n```\n';
    expect(extractTabBlockJson(body, "board", "tab-3")).toBeNull();
  });

  it("does not match a block with the same tabId but a different kind", () => {
    const body = '```board:tab-2\n{"items":[]}\n```\n';
    expect(extractTabBlockJson(body, "map", "tab-2")).toBeNull();
  });

  it("does not match the old singular ```board fence (no tabId) at all", () => {
    const body = '```board\n{"items":[]}\n```\n';
    expect(extractTabBlockJson(body, "board", "board")).toBeNull();
  });

  it("returns null when the fence is never closed", () => {
    const body = '```board:tab-2\n{"items":[]}';
    expect(extractTabBlockJson(body, "board", "tab-2")).toBeNull();
  });

  it("treats tab ids containing regex-special characters literally", () => {
    const body = '```map:tab.2+x\n{"mapId":5}\n```\n';
    expect(extractTabBlockJson(body, "map", "tab.2+x")).toBe('{"mapId":5}');
    expect(extractTabBlockJson(body, "map", "tabX2Yx")).toBeNull();
  });
});

describe("replaceTabBlock", () => {
  it("appends a new block to a body with none", () => {
    const result = replaceTabBlock("Some prose.", "map", "tab-3", { mapId: 17 });
    expect(result).toBe('Some prose.\n\n```map:tab-3\n{"mapId":17}\n```\n');
  });

  it("appends without a leading blank line to an empty body", () => {
    const result = replaceTabBlock("", "board", "tab-1", { items: [] });
    expect(result).toBe('```board:tab-1\n{"items":[]}\n```\n');
  });

  it("replaces an existing block in place, leaving surrounding text and other tabs' blocks untouched", () => {
    const before = 'Intro.\n\n```board:tab-1\n{"items":[]}\n```\n\n```map:tab-2\n{"mapId":1}\n```\n\nOutro.';
    const result = replaceTabBlock(before, "board", "tab-1", { items: ["x"] });
    expect(result).toBe('Intro.\n\n```board:tab-1\n{"items":["x"]}\n```\n\n```map:tab-2\n{"mapId":1}\n```\n\nOutro.');
  });

  it("round-trips through extractTabBlockJson exactly", () => {
    const written = replaceTabBlock("Notes.", "board", "tab-9", { items: [1, 2, 3] });
    expect(JSON.parse(extractTabBlockJson(written, "board", "tab-9")!)).toEqual({ items: [1, 2, 3] });
  });

  it("leaves the old singular ```board fence alone when writing a tab-keyed block", () => {
    const before = '```board\n{"items":["legacy"]}\n```\n';
    const result = replaceTabBlock(before, "board", "tab-1", { items: ["new"] });
    expect(result).toBe('```board\n{"items":["legacy"]}\n```\n\n```board:tab-1\n{"items":["new"]}\n```\n');
  });
});
