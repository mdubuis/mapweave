import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";
import type { WikiEntity } from "./types";

function entity(slug: string, body: string, overrides: Partial<WikiEntity["frontmatter"]> = {}): WikiEntity {
  return {
    slug,
    filePath: `wiki/${slug}.md`,
    frontmatter: { title: slug, type: "note", ...overrides },
    body
  };
}

describe("buildGraph", () => {
  it("creates a link edge for a resolved wikilink", () => {
    const graph = buildGraph([entity("old-port", "See [[Silt Delta]]."), entity("silt-delta", "")]);

    expect(graph.edges).toEqual([{ from: "old-port", to: "silt-delta", kind: "link" }]);
    expect(graph.brokenLinks.size).toBe(0);
  });

  it("records an unresolved wikilink as broken instead of crashing", () => {
    const graph = buildGraph([entity("old-port", "See [[Nowhere]].")]);

    expect(graph.edges).toEqual([]);
    expect(graph.brokenLinks.get("old-port")).toEqual(["Nowhere"]);
  });

  it("creates a labeled edge from a frontmatter relation", () => {
    const graph = buildGraph([
      entity("old-port", "", { relations: { located_in: "silt-delta" } }),
      entity("silt-delta", "")
    ]);

    expect(graph.edges).toEqual([{ from: "old-port", to: "silt-delta", kind: "relation", label: "located_in" }]);
  });

  it("does not duplicate an edge linked twice in the body", () => {
    const graph = buildGraph([entity("old-port", "[[Silt Delta]] again: [[silt-delta]]"), entity("silt-delta", "")]);

    expect(graph.edges).toHaveLength(1);
  });

  it("ignores a self-link", () => {
    const graph = buildGraph([entity("old-port", "[[Old Port]]")]);
    expect(graph.edges).toEqual([]);
  });

  it("resolves a target via another entity's alias", () => {
    const graph = buildGraph([
      entity("mira-thorne", "Sails out of [[Oldport]]."),
      entity("old-port", "", { aliases: ["Oldport"] })
    ]);

    expect(graph.edges).toEqual([{ from: "mira-thorne", to: "old-port", kind: "link" }]);
  });
});
