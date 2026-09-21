import { describe, expect, it } from "vitest";
import { patchFrontmatterField, patchFrontmatterType } from "./frontmatter-patch";

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

describe("patchFrontmatterField", () => {
  it("replaces an arbitrary key, not just type", () => {
    const raw = "---\ntitle: Old Draft\ntype: place\n---\n\nBody.\n";
    expect(patchFrontmatterField(raw, "title", "Old Port")).toBe("---\ntitle: Old Port\ntype: place\n---\n\nBody.\n");
  });

  it("inserts the key right after the opening --- when it's missing", () => {
    const raw = "---\ntype: place\n---\n\nBody.\n";
    expect(patchFrontmatterField(raw, "title", "Old Port")).toBe("---\ntitle: Old Port\ntype: place\n---\n\nBody.\n");
  });

  it("doesn't confuse a prefix match (e.g. 'parent' vs 'parenthood')", () => {
    const raw = "---\nparenthood: true\n---\n\nBody.\n";
    expect(patchFrontmatterField(raw, "parent", "old-port")).toBe(
      "---\nparent: old-port\nparenthood: true\n---\n\nBody.\n"
    );
  });
});
