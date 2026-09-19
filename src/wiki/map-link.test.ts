import { describe, expect, it } from "vitest";
import { findWikiEntitySlug, wikiLinkHref, wikiLinkTip } from "./map-link";

// wiki/places/old-port.md (seed content) declares map_ref for both the "founding" and "post-war" eras: burg id 7
describe("findWikiEntitySlug", () => {
  it("finds the entity linked to a given map kind+id in that era", () => {
    expect(findWikiEntitySlug("founding", { kind: "burg", id: 7 })).toBe("old-port");
    expect(findWikiEntitySlug("post-war", { kind: "burg", id: 7 })).toBe("old-port");
  });

  it("returns undefined for an era the entity isn't linked in", () => {
    expect(findWikiEntitySlug("some-other-era", { kind: "burg", id: 7 })).toBeUndefined();
  });

  it("returns undefined for an unlinked map object", () => {
    expect(findWikiEntitySlug("founding", { kind: "burg", id: 999999 })).toBeUndefined();
  });

  it("does not cross-match ids across different kinds", () => {
    expect(findWikiEntitySlug("founding", { kind: "state", id: 7 })).toBeUndefined();
  });
});

describe("wikiLinkHref", () => {
  it("links straight to the existing page", () => {
    expect(wikiLinkHref("founding", { kind: "burg", id: 7, name: "Old Port" })).toBe("./index.html#/entity/old-port");
  });

  it("prefills a create-page flow, carrying the era, when nothing is linked yet", () => {
    const href = wikiLinkHref("founding", { kind: "marker", id: 3, name: "Ruined Watchtower" });
    expect(href.startsWith("./index.html#/new?")).toBe(true);
    expect(href.includes("mapKind=marker")).toBe(true);
    expect(href.includes("mapId=3")).toBe(true);
    expect(href.includes("mapEra=founding")).toBe(true);
  });
});

describe("wikiLinkTip", () => {
  it("differs between an existing and a missing page", () => {
    expect(wikiLinkTip("founding", { kind: "burg", id: 7 })).toBe("Open wiki page for this entity");
    expect(wikiLinkTip("founding", { kind: "marker", id: 3 })).toBe("Create a wiki page for this entity");
  });
});
