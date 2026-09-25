import { describe, expect, it } from "vitest";
import { scenarioTemplateBlock, slugify } from "./db-editor";

describe("slugify", () => {
  it("lowercases and hyphenates a plain title", () => {
    expect(slugify("Old Port")).toBe("old-port");
  });

  it("collapses runs of non-alphanumeric characters into one hyphen", () => {
    expect(slugify("The Salt War: Act II!")).toBe("the-salt-war-act-ii");
  });

  it("trims leading/trailing hyphens left over from punctuation at the edges", () => {
    expect(slugify("  -Mira Thorne- ")).toBe("mira-thorne");
  });

  it("falls back to 'untitled' when nothing alphanumeric survives", () => {
    expect(slugify("***")).toBe("untitled");
  });
});

describe("scenarioTemplateBlock", () => {
  it("gives a quest a status and an objectives checklist stub", () => {
    expect(scenarioTemplateBlock("quest")).toBe("status: open\nobjectives:\n  - [ ] \n");
  });

  it("gives an encounter-table a table stub", () => {
    expect(scenarioTemplateBlock("encounter-table")).toBe("table:\n  - \n");
  });

  it("gives a session-log a number/date stub", () => {
    expect(scenarioTemplateBlock("session-log")).toBe("number: 1\ndate: \n");
  });

  it("gives an event an order/date/group stub", () => {
    expect(scenarioTemplateBlock("event")).toBe("order: \ndate: \ngroup: \n");
  });

  it("returns an empty block for a type with no scenario module", () => {
    expect(scenarioTemplateBlock("place")).toBe("");
  });
});
