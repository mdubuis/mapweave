import { describe, expect, it } from "vitest";
import { findWikiEntitySlug, wikiLinkHref, wikiLinkTip } from "./map-link";

// wiki/places/old-port.md (seed content) declares map_ref: { kind: burg, id: 7, name: "Old Port" }
describe("findWikiEntitySlug", () => {
  it("finds the entity linked to a given map kind+id", () => {
    expect(findWikiEntitySlug({ kind: "burg", id: 7 })).toBe("old-port");
  });

  it("returns undefined for an unlinked map object", () => {
    expect(findWikiEntitySlug({ kind: "burg", id: 999999 })).toBeUndefined();
  });

  it("does not cross-match ids across different kinds", () => {
    expect(findWikiEntitySlug({ kind: "state", id: 7 })).toBeUndefined();
  });
});

describe("wikiLinkHref", () => {
  it("links straight to the existing page", () => {
    expect(wikiLinkHref({ kind: "burg", id: 7, name: "Old Port" })).toBe("./wiki.html#/entity/old-port");
  });

  it("prefills a create-page flow when nothing is linked yet", () => {
    const href = wikiLinkHref({ kind: "marker", id: 3, name: "Ruined Watchtower" });
    expect(href.startsWith("./wiki.html#/new?")).toBe(true);
    expect(href.includes("mapKind=marker")).toBe(true);
    expect(href.includes("mapId=3")).toBe(true);
  });
});

describe("wikiLinkTip", () => {
  it("differs between an existing and a missing page", () => {
    expect(wikiLinkTip({ kind: "burg", id: 7, name: "Old Port" })).toBe("Open wiki page for this entity");
    expect(wikiLinkTip({ kind: "marker", id: 3, name: "Ruined Watchtower" })).toBe(
      "Create a wiki page for this entity"
    );
  });
});
