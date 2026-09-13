import { describe, expect, it } from "vitest";
import { isEntityInEra, loadEras, resolveEntityForEra } from "./eras";
import type { WikiEntity } from "./types";

function entity(slug: string, overrides: Partial<WikiEntity["frontmatter"]> = {}): WikiEntity {
  return { slug, filePath: `wiki/${slug}.md`, frontmatter: { title: slug, type: "note", ...overrides }, body: "" };
}

describe("loadEras", () => {
  it("keeps only type: era entities, sorted by order", () => {
    const eras = loadEras([
      entity("post-war", { type: "era", order: 2, map_file: "post-war.map" }),
      entity("old-port", { type: "place" }),
      entity("founding", { type: "era", order: 1, map_file: "founding.map" })
    ]);

    expect(eras.map(era => era.slug)).toEqual(["founding", "post-war"]);
    expect(eras[0]).toEqual({ slug: "founding", label: "founding", order: 1, mapFile: "founding.map" });
  });

  it("defaults order to 0 when absent", () => {
    expect(loadEras([entity("only-era", { type: "era" })])[0].order).toBe(0);
  });
});

describe("isEntityInEra", () => {
  it("is always present for an entity with no map_ref and no eras block", () => {
    expect(isEntityInEra(entity("mira-thorne"), "founding")).toBe(true);
  });

  it("is present only in eras it's map-linked to", () => {
    const e = entity("old-port", { map_ref: { founding: { kind: "burg", id: 7, name: "Old Port" } } });
    expect(isEntityInEra(e, "founding")).toBe(true);
    expect(isEntityInEra(e, "post-war")).toBe(false);
  });

  it("is present in an era it has an override for, even without a map_ref there", () => {
    const e = entity("old-port", { eras: { "post-war": { status: "besieged" } } });
    expect(isEntityInEra(e, "post-war")).toBe(true);
    expect(isEntityInEra(e, "founding")).toBe(false);
  });
});

describe("resolveEntityForEra", () => {
  it("returns the base frontmatter and map_ref unchanged when there is no override for that era", () => {
    const e = entity("old-port", {
      summary: "A free port.",
      map_ref: { founding: { kind: "burg", id: 7, name: "Old Port" } }
    });
    const resolved = resolveEntityForEra(e, "founding");
    expect(resolved.frontmatter.summary).toBe("A free port.");
    expect(resolved.mapRef).toEqual({ kind: "burg", id: 7, name: "Old Port" });
  });

  it("shallow-merges the era override on top of the base frontmatter", () => {
    const e = entity("old-port", {
      summary: "A free port.",
      eras: { "post-war": { summary: "A besieged ruin." } }
    });
    expect(resolveEntityForEra(e, "post-war").frontmatter.summary).toBe("A besieged ruin.");
    expect(resolveEntityForEra(e, "founding").frontmatter.summary).toBe("A free port.");
  });

  it("has no mapRef for an era the entity isn't linked to", () => {
    const e = entity("old-port", { map_ref: { founding: { kind: "burg", id: 7, name: "Old Port" } } });
    expect(resolveEntityForEra(e, "post-war").mapRef).toBeUndefined();
  });
});
