// Pure helpers for the scenario module (quests, encounter tables) — kept out of the frontmatter
// parser and wiki-main.ts's rendering so both conventions (weighted entries, objective checkboxes)
// stay simple, hand-editable strings and unit-testable in isolation. See wiki/SCHEMA.md.

export interface WeightedEntry {
  weight: number;
  text: string;
}

const WEIGHT_PREFIX = /^(\d+)x\s+(.*)$/i;

/** "3x A caravan passes" -> weight 3, text "A caravan passes"; no prefix -> weight 1 */
export function parseWeightedEntry(entry: string): WeightedEntry {
  const match = entry.match(WEIGHT_PREFIX);
  if (!match) return { weight: 1, text: entry };
  const weight = Number(match[1]);
  return { weight: weight > 0 ? weight : 1, text: match[2] };
}

/** Picks one entry from an encounter table, weighted per parseWeightedEntry. `random` is injectable
 *  for deterministic tests; defaults to Math.random for real rolls */
export function rollEncounter(table: string[], random: () => number = Math.random): WeightedEntry | undefined {
  if (!table.length) return undefined;
  const entries = table.map(parseWeightedEntry);
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * totalWeight;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1]; // floating-point rounding fallback: last entry
}

export interface Objective {
  text: string;
  done: boolean;
}

const OBJECTIVE_PREFIX = /^\[([ xX])\]\s+(.*)$/;

/** "[x] Find the map" -> done, text "Find the map"; "[ ] ..." -> pending; no prefix -> pending */
export function parseObjective(entry: string): Objective {
  const match = entry.match(OBJECTIVE_PREFIX);
  if (!match) return { text: entry, done: false };
  return { done: match[1].toLowerCase() === "x", text: match[2] };
}
