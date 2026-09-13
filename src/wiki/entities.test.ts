import { describe, expect, it } from "vitest";
import { buildSlugIndex, normalizeKey, parseEntityFile, resolveTarget } from "./entities";

describe("parseEntityFile", () => {
  it("derives the slug from the filename", () => {
    const entity = parseEntityFile("wiki/places/old-port.md", "---\ntitle: Old Port\ntype: place\n---\nBody.");
    expect(entity.slug).toBe("old-port");
    expect(entity.body).toBe("Body.");
  });

  it("falls back to a title-cased slug and 'note' type when frontmatter omits them", () => {
    const entity = parseEntityFile("wiki/silt-delta.md", "No frontmatter here.");
    expect(entity.frontmatter.title).toBe("Silt Delta");
    expect(entity.frontmatter.type).toBe("note");
  });

  it("parses a valid era-keyed map_ref", () => {
    const raw = "---\ntitle: Old Port\nmap_ref:\n  founding:\n    kind: burg\n    id: 42\n    name: Old Port\n---\n";
    const entity = parseEntityFile("wiki/old-port.md", raw);
    expect(entity.frontmatter.map_ref).toEqual({ founding: { kind: "burg", id: 42, name: "Old Port" } });
  });

  it("drops an era entry with an unknown kind rather than passing it through untyped", () => {
    const raw = "---\nmap_ref:\n  founding:\n    kind: castle\n    id: 1\n---\n";
    const entity = parseEntityFile("wiki/x.md", raw);
    expect(entity.frontmatter.map_ref).toBeUndefined();
  });

  it("parses eras field overrides", () => {
    const raw = "---\neras:\n  post-war:\n    summary: A besieged ruin.\n---\n";
    const entity = parseEntityFile("wiki/x.md", raw);
    expect(entity.frontmatter.eras).toEqual({ "post-war": { summary: "A besieged ruin." } });
  });
});

describe("normalizeKey", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(normalizeKey("Old Port")).toBe(normalizeKey("old-port"));
    expect(normalizeKey("  The Port  ")).toBe(normalizeKey("the-port"));
  });
});

describe("buildSlugIndex / resolveTarget", () => {
  it("resolves by slug, title and alias", () => {
    const entities = [parseEntityFile("wiki/old-port.md", "---\ntitle: Old Port\naliases: [Oldport]\n---\n")];
    const index = buildSlugIndex(entities);

    expect(resolveTarget(index, "old-port")).toEqual({ slug: "old-port" });
    expect(resolveTarget(index, "Old Port")).toEqual({ slug: "old-port" });
    expect(resolveTarget(index, "Oldport")).toEqual({ slug: "old-port" });
    expect(resolveTarget(index, "Nowhere")).toBeUndefined();
  });
});
