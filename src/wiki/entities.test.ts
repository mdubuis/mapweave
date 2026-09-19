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

  it("parses scenario module fields: quest status/hook/objectives/resolution", () => {
    const raw = [
      "---",
      "status: active",
      "hook: A merchant offers gold for safe passage.",
      "objectives:",
      "  - [x] Find the map",
      "  - [ ] Talk to Mira",
      "resolution: The party escorted the caravan safely.",
      "---"
    ].join("\n");
    const entity = parseEntityFile("wiki/quests/x.md", raw);
    expect(entity.frontmatter.status).toBe("active");
    expect(entity.frontmatter.hook).toBe("A merchant offers gold for safe passage.");
    expect(entity.frontmatter.objectives).toEqual(["[x] Find the map", "[ ] Talk to Mira"]);
    expect(entity.frontmatter.resolution).toBe("The party escorted the caravan safely.");
  });

  it("parses a stat block, dropping any non-string/number value rather than the whole block", () => {
    const raw = ["---", "statBlockSystem: D&D 5e", "stats:", "  hp: 10", "  ac: 14", "  name: Mira", "---"].join("\n");
    const entity = parseEntityFile("wiki/characters/x.md", raw);
    expect(entity.frontmatter.statBlockSystem).toBe("D&D 5e");
    expect(entity.frontmatter.stats).toEqual({ hp: 10, ac: 14, name: "Mira" });
  });

  it("drops the stats block entirely once every non-scalar entry is filtered out", () => {
    const raw = ["---", "stats:", "  weapons:", "    - sword", "    - shield", "---"].join("\n");
    const entity = parseEntityFile("wiki/x.md", raw);
    expect(entity.frontmatter.stats).toBeUndefined();
  });

  it("parses an encounter table and session-log fields", () => {
    const raw = [
      "---",
      "table:",
      "  - 3x Bandits ambush the party",
      "  - 1x A merchant caravan passes",
      "number: 3",
      "date: 2026-01-05",
      "---"
    ].join("\n");
    const entity = parseEntityFile("wiki/x.md", raw);
    expect(entity.frontmatter.table).toEqual(["3x Bandits ambush the party", "1x A merchant caravan passes"]);
    expect(entity.frontmatter.number).toBe(3);
    expect(entity.frontmatter.date).toBe("2026-01-05");
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
