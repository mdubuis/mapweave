import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter";
import { insertMapRefBlock } from "./map-ref-patch";

describe("insertMapRefBlock", () => {
  it("inserts the block before the closing --- and leaves the body untouched", () => {
    const raw = "---\ntitle: New Keep\ntype: place\n---\n\nA fortress on the hill.\n";
    const result = insertMapRefBlock(raw, "founding", { kind: "burg", id: 12, name: "New Keep" });
    expect(result).toBe(
      "---\ntitle: New Keep\ntype: place\nmap_ref:\n  founding:\n    kind: burg\n    id: 12\n    name: New Keep\n---\n\nA fortress on the hill.\n"
    );
  });

  it("includes a cell line only when the map ref carries one (marker case)", () => {
    const raw = "---\ntitle: Ruined Shrine\ntype: place\n---\n\nBody.\n";
    const result = insertMapRefBlock(raw, "founding", { kind: "marker", id: 3, name: "Ruined Shrine", cell: 401 });
    expect(result.includes("    cell: 401")).toBe(true);
  });

  it("omits the cell line for a burg with no cell", () => {
    const raw = "---\ntitle: New Keep\ntype: place\n---\n\nBody.\n";
    const result = insertMapRefBlock(raw, "founding", { kind: "burg", id: 12, name: "New Keep" });
    expect(result.includes("cell:")).toBe(false);
  });

  it("round-trips through parseFrontmatter", () => {
    const raw = "---\ntitle: New Keep\ntype: place\n---\n\nBody.\n";
    const mapRef = { kind: "marker" as const, id: 7, name: "New Keep", cell: 99 };
    const result = insertMapRefBlock(raw, "founding", mapRef);
    const { data } = parseFrontmatter(result);
    expect(data.map_ref).toEqual({ founding: mapRef });
  });

  it("returns the input unchanged when there is no frontmatter block", () => {
    const raw = "Just a body.\n";
    expect(insertMapRefBlock(raw, "founding", { kind: "burg", id: 1, name: "X" })).toBe(raw);
  });
});
