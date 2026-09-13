import { describe, expect, it } from "vitest";
import { dbRefOf, type EntityTree, flattenTree } from "./db-entities";

const emptyTree: EntityTree = { states: [], cultures: [], religions: [], rivers: [], markers: [] };

describe("flattenTree", () => {
  it("flattens states, their province/burg children, and the flat lists into one array", () => {
    const tree: EntityTree = {
      states: [
        {
          kind: "state",
          id: 1,
          name: "Testland",
          children: [
            {
              kind: "province",
              id: 5,
              name: "Coastal Province",
              children: [{ kind: "burg", id: 42, name: "Testville", population: 12, capital: true }]
            },
            { kind: "burg", id: 43, name: "Direct Burg" } // a burg with no province, straight under the state
          ]
        }
      ],
      cultures: [{ kind: "culture", id: 1, name: "Test Culture" }],
      religions: [],
      rivers: [{ kind: "river", id: 1, name: "Test River" }],
      markers: []
    };

    const entities = flattenTree(9, tree);
    const slugs = entities.map(e => e.slug);

    expect(slugs).toEqual([
      "db-9-state-1",
      "db-9-province-5",
      "db-9-burg-42",
      "db-9-burg-43",
      "db-9-culture-1",
      "db-9-river-1"
    ]);
  });

  it("gives each entity a title, a type, and a dbRef pointing back at the map/kind/id", () => {
    const tree: EntityTree = { ...emptyTree, states: [{ kind: "state", id: 1, name: "Testland" }] };
    const [entity] = flattenTree(9, tree);

    expect(entity.frontmatter.title).toBe("Testland");
    expect(entity.frontmatter.type).toBe("state");
    expect(dbRefOf(entity)).toEqual({ mapId: 9, kind: "state", id: 1 });
  });

  it("falls back to a placeholder title for an unnamed entity", () => {
    const tree: EntityTree = { ...emptyTree, markers: [{ kind: "marker", id: 3, name: "" }] };
    expect(flattenTree(1, tree)[0].frontmatter.title).toBe("Unnamed marker #3");
  });

  it("builds a summary noting parent, population, and capital status", () => {
    const tree: EntityTree = {
      ...emptyTree,
      states: [
        {
          kind: "state",
          id: 1,
          name: "Testland",
          children: [{ kind: "burg", id: 42, name: "Testville", population: 12, capital: true }]
        }
      ]
    };

    const burg = flattenTree(9, tree).find(e => e.slug === "db-9-burg-42")!;
    expect(burg.frontmatter.summary).toBe("Part of Testland. Population: 12. Capital.");
  });

  it("has no summary field when there is nothing to say", () => {
    const tree: EntityTree = { ...emptyTree, cultures: [{ kind: "culture", id: 1, name: "Bare Culture" }] };
    expect(flattenTree(1, tree)[0].frontmatter.summary).toBeUndefined();
  });
});

describe("dbRefOf", () => {
  it("returns undefined for a plain (non-db) entity", () => {
    expect(
      dbRefOf({ slug: "x", filePath: "x.md", frontmatter: { title: "X", type: "place" }, body: "" })
    ).toBeUndefined();
  });
});
