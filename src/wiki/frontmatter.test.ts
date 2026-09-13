import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("returns the raw text untouched when there is no frontmatter block", () => {
    expect(parseFrontmatter("Just a paragraph.")).toEqual({ data: {}, content: "Just a paragraph." });
  });

  it("parses scalars, inline arrays and block lists", () => {
    const raw = [
      "---",
      "title: Old Port",
      "type: place",
      "tags: [coastal, trade]",
      "aliases:",
      "  - Oldport",
      "  - The Port",
      "---",
      "Body text."
    ].join("\n");

    const { data, content } = parseFrontmatter(raw);

    expect(data).toEqual({
      title: "Old Port",
      type: "place",
      tags: ["coastal", "trade"],
      aliases: ["Oldport", "The Port"]
    });
    expect(content).toBe("Body text.");
  });

  it("parses one level of nested maps", () => {
    const raw = ["---", "map_ref:", "  kind: burg", "  id: 42", "  name: Old Port", "---", ""].join("\n");

    const { data } = parseFrontmatter(raw);

    expect(data.map_ref).toEqual({ kind: "burg", id: 42, name: "Old Port" });
  });

  it("treats a missing closing marker as no frontmatter", () => {
    const raw = "---\ntitle: Broken\nNo closing marker here.";
    expect(parseFrontmatter(raw)).toEqual({ data: {}, content: raw });
  });
});
