import { describe, expect, it } from "vitest";
import { patchFrontmatterType } from "./frontmatter-patch";

describe("patchFrontmatterType", () => {
  it("replaces an existing type line without touching the rest", () => {
    const raw = "---\ntitle: Old Port\ntype: place\nsummary: A harbor town\n---\n\nBody text.\n";
    expect(patchFrontmatterType(raw, "character")).toBe(
      "---\ntitle: Old Port\ntype: character\nsummary: A harbor town\n---\n\nBody text.\n"
    );
  });

  it("inserts a type line when none exists", () => {
    const raw = "---\ntitle: Old Port\n---\n\nBody text.\n";
    expect(patchFrontmatterType(raw, "place")).toBe("---\ntype: place\ntitle: Old Port\n---\n\nBody text.\n");
  });

  it("does not touch a type-like line in the body", () => {
    const raw = "---\ntitle: Old Port\ntype: place\n---\n\ntype: not frontmatter\n";
    expect(patchFrontmatterType(raw, "character")).toBe(
      "---\ntitle: Old Port\ntype: character\n---\n\ntype: not frontmatter\n"
    );
  });

  it("returns the input unchanged when there is no frontmatter block", () => {
    const raw = "Just a body, no frontmatter.\n";
    expect(patchFrontmatterType(raw, "place")).toBe(raw);
  });
});
