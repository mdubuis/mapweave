import { describe, expect, it } from "vitest";
import {
  buildAutoLinkNames,
  buildEntityTree,
  buildPageTree,
  buildSlugIndex,
  effectiveTabs,
  extractSnippet,
  normalizeKey,
  parseEntityFile,
  resolveTarget
} from "./entities";

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

  it("parses a valid tab-id-keyed tabs block", () => {
    const raw = "---\ntitle: City\ntabs:\n  overview:\n    type: wiki\n  atlas:\n    type: map\n    mapId: 17\n---\n";
    const entity = parseEntityFile("wiki/city.md", raw);
    expect(entity.frontmatter.tabs).toEqual({
      overview: { type: "wiki" },
      atlas: { type: "map", mapId: 17 }
    });
  });

  it("drops a tab entry with an invalid/missing type rather than the whole tabs block", () => {
    const raw = "---\ntabs:\n  good:\n    type: board\n  bad:\n    title: no type here\n---\n";
    const entity = parseEntityFile("wiki/x.md", raw);
    expect(entity.frontmatter.tabs).toEqual({ good: { type: "board" } });
  });

  it("leaves tabs undefined when the frontmatter has none", () => {
    const entity = parseEntityFile("wiki/plain.md", "---\ntitle: Plain\n---\n");
    expect(entity.frontmatter.tabs).toBeUndefined();
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

  it("parses secret: true, and drops any other value", () => {
    const secret = parseEntityFile("wiki/x.md", "---\nsecret: true\n---\n");
    expect(secret.frontmatter.secret).toBe(true);

    const notSecret = parseEntityFile("wiki/y.md", "---\ntitle: Y\n---\n");
    expect(notSecret.frontmatter.secret).toBeUndefined();
  });

  it("parses a parent slug, trimmed", () => {
    const entity = parseEntityFile("wiki/x.md", "---\nparent: old-port \n---\n");
    expect(entity.frontmatter.parent).toBe("old-port");
  });

  it("parses an event's order/date/group", () => {
    const raw =
      "---\ntitle: The Hollow Emperor emerges\ntype: event\norder: 1\ndate: 492 CE\ngroup: Adversaries\n---\n";
    const entity = parseEntityFile("wiki/x.md", raw);
    expect(entity.frontmatter.order).toBe(1);
    expect(entity.frontmatter.date).toBe("492 CE");
    expect(entity.frontmatter.group).toBe("Adversaries");
  });

  it("drops a blank group rather than keeping an empty string", () => {
    const entity = parseEntityFile("wiki/x.md", '---\ngroup: " "\n---\n');
    expect(entity.frontmatter.group).toBeUndefined();
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

describe("buildAutoLinkNames", () => {
  it("includes titles and aliases, sorted longest name first", () => {
    const entities = [
      parseEntityFile("wiki/port.md", "---\ntitle: Port\n---\n"),
      parseEntityFile("wiki/old-port.md", "---\ntitle: Old Port\naliases: [The Harbor]\n---\n")
    ];
    const names = buildAutoLinkNames(entities);
    expect(names.map(n => n.name)).toEqual(["The Harbor", "Old Port", "Port"]);
    expect(names.find(n => n.name === "Old Port")?.slug).toBe("old-port");
  });

  it("excludes names shorter than the minimum auto-link length", () => {
    const entities = [parseEntityFile("wiki/rok.md", "---\ntitle: Rok\n---\n")];
    expect(buildAutoLinkNames(entities)).toEqual([]);
  });
});

describe("extractSnippet", () => {
  it("returns an excerpt around the match, original casing preserved", () => {
    const snippet = extractSnippet("The merchant seems trustworthy enough, or so he claims.", "trustworthy");
    expect(snippet.includes("trustworthy")).toBe(true);
    expect(snippet.includes("…")).toBe(false); // short text, whole thing fits within the radius
  });

  it("adds an ellipsis on the side(s) that got truncated", () => {
    const long = `${"a".repeat(100)} needle ${"b".repeat(100)}`;
    const snippet = extractSnippet(long, "needle");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("returns an empty string when there is no match", () => {
    expect(extractSnippet("Nothing relevant here.", "dragon")).toBe("");
  });

  it("matches case-insensitively", () => {
    expect(extractSnippet("The Dragon sleeps.", "dragon").includes("Dragon")).toBe(true);
  });
});

describe("buildEntityTree", () => {
  it("nests a child under its parent", () => {
    const parent = parseEntityFile("wiki/old-port.md", "---\ntitle: Old Port\ntype: place\n---\n");
    const child = parseEntityFile("wiki/docks.md", "---\ntitle: Docks\ntype: place\nparent: old-port\n---\n");
    const { roots, childrenBySlug } = buildEntityTree([parent, child]);

    expect(roots).toEqual([parent]);
    expect(childrenBySlug.get("old-port")).toEqual([child]);
  });

  it("falls back to a root when the parent slug doesn't exist in the given list", () => {
    const orphan = parseEntityFile("wiki/x.md", "---\nparent: nowhere\n---\n");
    const { roots, childrenBySlug } = buildEntityTree([orphan]);
    expect(roots).toEqual([orphan]);
    expect(childrenBySlug.size).toBe(0);
  });

  it("breaks a two-entity cycle by making both roots, rather than dropping either", () => {
    const a = parseEntityFile("wiki/a.md", "---\ntitle: A\nparent: b\n---\n");
    const b = parseEntityFile("wiki/b.md", "---\ntitle: B\nparent: a\n---\n");
    const { roots, childrenBySlug } = buildEntityTree([a, b]);

    expect(roots.map(e => e.slug).sort()).toEqual(["a", "b"]);
    expect(childrenBySlug.size).toBe(0);
  });

  it("treats a self-referencing parent as a root, not an infinite loop", () => {
    const selfParent = parseEntityFile("wiki/x.md", "---\nparent: x\n---\n");
    const { roots, childrenBySlug } = buildEntityTree([selfParent]);
    expect(roots).toEqual([selfParent]);
    expect(childrenBySlug.size).toBe(0);
  });
});

describe("buildPageTree", () => {
  it("nests a child under a parent of a DIFFERENT type, unlike buildEntityTree's per-type callers", () => {
    const city = parseEntityFile("wiki/old-port.md", "---\ntitle: Old Port\ntype: place\n---\n");
    const board = parseEntityFile(
      "wiki/old-port-board.md",
      "---\ntitle: Old Port — mood board\ntype: board\nparent: old-port\n---\n"
    );
    const { roots, childrenBySlug } = buildPageTree([city, board]);

    expect(roots).toEqual([city]);
    expect(childrenBySlug.get("old-port")).toEqual([board]);
  });

  it("still breaks cycles across types the same way buildEntityTree does", () => {
    const a = parseEntityFile("wiki/a.md", "---\ntitle: A\ntype: place\nparent: b\n---\n");
    const b = parseEntityFile("wiki/b.md", "---\ntitle: B\ntype: board\nparent: a\n---\n");
    const { roots, childrenBySlug } = buildPageTree([a, b]);

    expect(roots.map(e => e.slug).sort()).toEqual(["a", "b"]);
    expect(childrenBySlug.size).toBe(0);
  });
});

describe("effectiveTabs", () => {
  it("treats an entity with no tabs field as one implicit wiki tab", () => {
    const entity = parseEntityFile("wiki/plain.md", "---\ntitle: Plain\n---\n");
    expect(effectiveTabs(entity.frontmatter)).toEqual([{ id: "wiki", type: "wiki" }]);
  });

  it("returns each declared tab with its id attached", () => {
    const raw = "---\ntabs:\n  overview:\n    type: wiki\n  atlas:\n    type: map\n    mapId: 17\n---\n";
    const entity = parseEntityFile("wiki/city.md", raw);
    expect(effectiveTabs(entity.frontmatter)).toEqual([
      { id: "overview", type: "wiki" },
      { id: "atlas", type: "map", mapId: 17 }
    ]);
  });
});
