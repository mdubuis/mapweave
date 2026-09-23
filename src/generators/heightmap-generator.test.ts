// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import type { GridGraph } from "@/types/GridGraph";
import "@/generators/heightmap-generator";

beforeAll(async () => {
  await import("@/generators/heightmap-generator");
});

function fakeGraph(cellCount: number): GridGraph {
  return { cells: { h: new Uint8Array(cellCount) } } as unknown as GridGraph;
}

describe("HeightmapGenerator.fromParentSlice", () => {
  it("sets the graph's cell heights directly from the given array", () => {
    const graph = fakeGraph(4);
    const parentHeights = Uint8Array.from([10, 20, 55, 90]);

    const result = HeightmapGenerator.fromParentSlice(graph, parentHeights);

    expect(Array.from(graph.cells.h)).toEqual([10, 20, 55, 90]);
    expect(result).toBe(parentHeights);
  });

  it("returns the exact same array instance it was given, not a copy", () => {
    const graph = fakeGraph(3);
    const parentHeights = new Uint8Array([1, 2, 3]);

    HeightmapGenerator.fromParentSlice(graph, parentHeights);

    expect(graph.cells.h).toBe(parentHeights);
  });
});
