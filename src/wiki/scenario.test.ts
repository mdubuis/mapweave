import { describe, expect, it } from "vitest";
import { parseObjective, parseWeightedEntry, rollEncounter } from "./scenario";

describe("parseWeightedEntry", () => {
  it("parses a leading weight prefix", () => {
    expect(parseWeightedEntry("3x A caravan passes")).toEqual({ weight: 3, text: "A caravan passes" });
  });

  it("defaults to weight 1 when there is no prefix", () => {
    expect(parseWeightedEntry("Nothing happens")).toEqual({ weight: 1, text: "Nothing happens" });
  });

  it("treats a zero or malformed weight as 1 rather than dropping the entry", () => {
    expect(parseWeightedEntry("0x Bandits ambush the party")).toEqual({ weight: 1, text: "Bandits ambush the party" });
  });

  it("is case-insensitive on the x", () => {
    expect(parseWeightedEntry("2X Wolves howl nearby")).toEqual({ weight: 2, text: "Wolves howl nearby" });
  });
});

describe("rollEncounter", () => {
  it("returns undefined for an empty table", () => {
    expect(rollEncounter([])).toBeUndefined();
  });

  it("picks the only entry in a single-entry table", () => {
    expect(rollEncounter(["Nothing happens"], () => 0.5)).toEqual({ weight: 1, text: "Nothing happens" });
  });

  it("weights entries proportionally to their prefix", () => {
    const table = ["3x Bandits ambush the party", "1x A merchant caravan passes"];
    // total weight 4: roll < 3/4 picks the first (heavier) entry, >= 3/4 picks the second
    expect(rollEncounter(table, () => 0)).toEqual({ weight: 3, text: "Bandits ambush the party" });
    expect(rollEncounter(table, () => 0.5)).toEqual({ weight: 3, text: "Bandits ambush the party" });
    expect(rollEncounter(table, () => 0.9)).toEqual({ weight: 1, text: "A merchant caravan passes" });
  });

  it("falls back to the last entry if the random source returns exactly 1", () => {
    // roll = 1 * totalWeight lands exactly on the boundary (subtracting every weight never goes
    // negative), so the loop falls through — the explicit fallback, not the normal per-entry match
    const table = ["1x A", "1x B"];
    expect(rollEncounter(table, () => 1)).toEqual({ weight: 1, text: "B" });
  });
});

describe("parseObjective", () => {
  it("parses a done checkbox", () => {
    expect(parseObjective("[x] Find the map")).toEqual({ done: true, text: "Find the map" });
  });

  it("parses a pending checkbox, case-insensitively", () => {
    expect(parseObjective("[X] Talk to Mira")).toEqual({ done: true, text: "Talk to Mira" });
    expect(parseObjective("[ ] Talk to Mira")).toEqual({ done: false, text: "Talk to Mira" });
  });

  it("treats a plain string with no checkbox as pending", () => {
    expect(parseObjective("Talk to Mira")).toEqual({ done: false, text: "Talk to Mira" });
  });
});
