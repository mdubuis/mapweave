# Mapweave wiki — file schema

One entity per Markdown file, anywhere under `wiki/`. The folder (`places/`, `characters/`, ...) is
just organization — the `type` frontmatter field is what the engine actually reads. The filename
(without `.md`) is the entity's **slug**: its permanent id, used by wikilinks and URLs. Renaming a
file changes its slug and breaks links to it, so prefer adding an alias (see below) over renaming.

## Frontmatter

```yaml
---
title: Old Port
type: place            # place | character | faction | event | item | quest | encounter-table | session-log — or any custom string
summary: A free harbor town at the mouth of the Silt river.
tags: [coastal, trade]
aliases: [Oldport, The Port]   # alternate names that also resolve wikilinks to this file
relations:
  located_in: silt-delta        # slug of another entity — becomes a typed graph edge
  ruled_by: silver-compact
map_ref:                        # optional — links this entity to a map object, per era (see below)
  founding:
    kind: burg
    id: 42
    name: Old Port              # snapshot of the map object's name when linked, for drift-detection
    # cell: 1337                # required for non-burg kinds, to jump to this entity on the map
eras:                           # optional — field overrides for specific eras, see Timeline below
  post-war:
    summary: A besieged ruin, three years into the fighting.
---
```

Only `title` and `type` are meaningful to the engine beyond that — everything else is optional.
`type` has no fixed list; `place / character / faction / event / item` are a starting convention,
not an enum enforced by the parser. Unknown frontmatter fields are preserved but ignored.

### `relations`

A flat map of `relation-name: target-slug`. Each becomes a directed, labeled edge in the entity
graph (`this-file --relation-name--> target-slug`), in addition to whatever `[[wikilinks]]` appear
in the body. Use it for relationships worth showing on the graph even when the body prose doesn't
happen to link them (e.g. `located_in`, `member_of`, `parent_of`).

### `parent`

```yaml
parent: old-port   # slug of another entity of the *same type*
```

Nests this entity under another one in the sidebar (an indented sub-item, like a district page
nested under its city). Only nests when the parent is the same `type` — a `parent` pointing at a
different type, or at a slug that doesn't exist, just falls back to a flat top-level entry rather
than erroring. This is distinct from `relations: { parent_of: ... }` above: that's a generic,
cross-type graph edge shown in the "Relations" list; `parent` specifically controls sidebar
grouping/indentation and only makes sense within one type.

### `map_ref`

Links this wiki entity to one object on the generated map, and powers the bidirectional
map ↔ wiki navigation (Phase 3). It's keyed by **era slug** (Phase 4, see Timeline below) — the
same wiki page can point at burg #7 in the "founding" era and at nothing at all (destroyed, not
yet founded) in another. Projects that don't use eras still nest under one implicit key,
`default` (`DEFAULT_ERA` in `src/wiki/types.ts`), so the shape stays uniform either way.

Within one era's entry: `kind` matches FMG's own entity types (`burg`, `state`, `province`,
`religion`, `culture`, `marker`, `river`); `id` is that object's numeric id in that era's `.map`
file. FMG ids are positional (array index) and only stable within one map's edit lineage — they
are **not** stable across a full regeneration, which is exactly why each era gets its own id
mapping rather than one global one. `name` is a snapshot of the map object's name at link time so
a later mismatch can be flagged instead of silently mislinking.

`cell` is the id of the cell to focus on when jumping from this wiki page to the map, reusing
FMG's native `?cell=<id>` URL parameter (see `docs/wiki/URL-parameters.md`) — required for every
kind except `burg`, which resolves directly via `?burg=<id>` instead. A state/province/religion's
`cell` is its `center` field in the map data; a marker's is its own `cell` field; a river's is its
`mouth` or `source`. Creating a page from a map popup (clicking "Create wiki page" on a burg,
state, or marker) fills in `kind`/`id`/`name`/era automatically; the map app resolves the reverse
direction (map object → wiki page) by scanning all `wiki/**/*.md` files for a matching `map_ref`
entry in the currently active era — see `src/wiki/map-link.ts`.

## Timeline (eras)

An **era** is just a wiki entity with `type: era`, plus two fields the timeline reads:

```yaml
---
title: After the Salt War
type: era
order: 2                # sort position in the timeline; lower comes first
map_file: post-war.map  # filename under public/maps/ — the full FMG snapshot for this era
---
Prose about the era itself is a normal wiki page — link to and from it like anything else.
```

The full map state (every burg/state/border) is **not** diffed or merged between eras — each era
is one complete, independently-generated-or-edited `.map` file, because that's how FMG itself
persists state and this project deliberately never reaches into that engine. What Mapweave adds on
top, to avoid duplicating everything else per era, is two lightweight mechanisms on ordinary
entities:

- **`map_ref`** (above) says which map object (if any) this entity corresponds to in each era.
  An entity present in one era's `map_ref` but absent from another's is implicitly "doesn't exist
  there" — destroyed, not yet founded, whatever the prose says.
- **`eras`** is a flat map of `era-slug: {field: override-value}` — a shallow patch applied on top
  of the base frontmatter (see `resolveEntityForEra` in `src/wiki/eras.ts`). Use it for the handful
  of fields that actually change (`summary`, `status`, ...), not for re-describing the whole entity.
  The patch is shallow at the field level: overriding `relations` replaces the *entire* map for that
  era, not one key within it — repeat the whole block if only one relation actually changes. The
  main Markdown body is not era-scoped — write its "current" description there, and use ordinary
  headings for an in-prose history section if you want the full story in one page
  (`## Under the Silver Compact` / `## After the Salt War`).

The wiki app's era selector (top of the sidebar) filters the entity list to what's relevant to the
chosen era (linked via `map_ref` there, overridden via `eras` there, or era-agnostic — no
`map_ref`/`eras` at all, like most characters and factions) and resolves overrides before
rendering. "All eras" shows everything, unresolved. The map app's own era switcher (top of the map
screen) is entirely separate — it just navigates to `?maplink=<that era's map_file>`, FMG's
existing map-loading mechanism, so eras are also just bookmarkable/shareable links.

## Scenario module

Fields for running a game or writing a structured story, layered on the same entity model above —
not new entity kinds with their own rules, just conventional `type` values and frontmatter fields
the app knows how to render specially. Everything here is optional and additive: a page that uses
none of it renders exactly as before.

### Stat blocks — any entity, usually `character`

```yaml
---
title: Mira Thorne
type: character
statBlockSystem: D&D 5e        # free-text label, display only — the app never assumes a system
stats:
  hp: 58
  ac: 15
  attacks: Boarding cutlass +6 (1d8+3 slashing)
---
```

`stats` is a flat `label: value` map (numbers or strings), rendered as a table on the entity page.
There's no separate "NPC" type — a stat block is just an optional field on any entity, so a fully
narrative character and a fight-ready NPC can both be `type: character` and cross-reference each
other normally through `relations`/wikilinks.

### Quests — `type: quest`

```yaml
---
title: The Salt Tithe
type: quest
status: active                 # open | active | complete | abandoned — any other value groups under "other"
hook: Mira Thorne corners the party at the docks with a proposition too profitable to ignore.
objectives:
  - "[x] Meet Mira Thorne at Old Port"
  - "[ ] Escort the salt caravan to the delta crossing"
resolution: How it ended — fill in once status is complete/abandoned
relations:
  given_by: mira-thorne
  set_in: old-port
---
```

`objectives` is a plain list of strings, each optionally prefixed `[x] `/`[ ] ` (done/pending) —
rendered as a read-only checklist; edit the prefix by hand in the raw editor to check something
off, same as any other frontmatter field. The **Quests** view (nav link in the sidebar header, or
`#/quests`) boards every quest grouped by `status`.

### Encounter tables — `type: encounter-table`

```yaml
---
title: Delta Crossing
type: encounter-table
table:
  - "3x Bandits ambush the party from the reeds"
  - "1x A merchant caravan passes"
  - "1x Nothing happens"
---
```

Each entry is a plain string, optionally prefixed `Nx ` to weight it (default weight 1 — no prefix
needed for an even table). The entity page for this type shows a **Roll** button that picks one
entry at random, weighted accordingly (`src/wiki/scenario.ts`'s `rollEncounter`) — nothing is saved
or persisted, it's a live dice-roll aid, re-roll as many times as you like.

### Session log — `type: session-log`, one file per session

```yaml
---
title: "Session 1: The Harbor-Master's Offer"
type: session-log
number: 1                      # sort order in the session log view
date: 2026-01-05                # free-form, display only (in-fiction or real-world)
summary: The party meets Mira Thorne and agrees to escort the salt tithe.
relations:
  touches: the-salt-tithe
---
What actually happened at the table, in prose. Link freely to the quests/characters/places
touched, same as any other page.
```

This is distinct from **eras** (above): an era is the world's own history, one era per major
map state; a session is what a group actually played, in real order, regardless of how much
in-fiction time a session covers. The **Session log** view (`#/sessions`) lists every session
sorted by `number`.

### Events (timeline) — `type: event`

```yaml
---
title: The Hollow Emperor emerges
type: event
order: 1                # sort position in the #/timeline view — lower comes first
date: 492 CE             # free-form, display only, never parsed (see below)
group: Adversaries        # free-form category for grouping in the timeline view
summary: A shadow rises from the ruins of the old capital.
relations:
  involves: the-hollow-emperor
---
```

The **Timeline** view (`#/timeline`) lists every `event` entity sorted by `order`, grouped into
sections by `group` (entities without one land in an "Other" section). `order` and `group` are
both optional — an event with neither still shows up, sorted last, in "Other". Like a session's
`date`, an event's `date` is **free-form text, never parsed** — there is no real calendar engine
here (custom calendars, date arithmetic across arbitrary month/day lengths): if you write `492 CE`
and another event `January 10th, 1201 CE`, nothing checks that they're actually in the right
order relative to each other — `order` is what controls sequence, `date` is just a label.

`[[slug]]` or `[[slug|display text]]` anywhere in the body. Resolution is case-insensitive and
matches against each file's slug and its `aliases`. A link that resolves nowhere still renders —
as a distinctly styled "missing page" link — rather than breaking the page; Phase 3 extends this
to "create the page" instead of just flagging it.

## Secrets (GM view / player view)

Mapweave has no accounts or access control — this is a **local display filter**, not real
permissions. Usable on any entity, not gated to a specific `type`.

- `secret: true` in frontmatter hides the whole page in player view — it disappears from the
  sidebar/search and a direct link to it renders as "no such page." GM view always shows it, with a
  "secret page" badge.
- A `:::secret` ... `:::` block in the body (each marker alone on its own line) hides just that
  part of an otherwise-visible page. GM view renders it normally, with a "has secrets" badge on the
  page; player view strips the block entirely before rendering.

```yaml
---
title: The Salt-Tithe Contract
secret: true          # whole page hidden from players
---
```

```markdown
The merchant seems trustworthy enough.

:::secret
He's been skimming the tithe for years — the ledger in his study proves it.
:::

He offers you passage south.
```

Toggle GM/player view from the sidebar's view-mode button (persisted in this browser, per device —
not shared with anyone else, since there's no multi-user concept to share it through).

## Page templates

A starter you can pick when creating a page, beyond the built-in per-type ones. From the editor,
"Save as template…" captures the whole page (frontmatter + body) as-is under a name you choose;
from "Create page," pick that template from the "Template:" dropdown (filtered to the type you've
selected) instead of starting blank — only the title changes, everything else in the template
carries over verbatim.

Templates live under `wiki/templates/` as ordinary Markdown files (frontmatter + body, same shape
as any entity) — real files, so they travel with the folder like everything else, including under
version control. That folder is excluded from the entity list itself, so a template never shows up
as a page in the sidebar, search, or graph.

## Markdown support

The renderer covers the subset lore pages actually need: headings (`#`..`######`), paragraphs,
bold/italic, inline code, fenced code blocks, unordered/ordered lists, blockquotes, horizontal
rules, and links (both `[text](url)` and `[[wikilinks]]`). It is not full CommonMark — no tables,
no nested blockquotes/lists beyond one level. Extend `src/wiki/markdown.ts` if a page needs more.

**Auto-linking**: any entity's title or alias that appears as plain text in a page's body is
automatically turned into a link, the same as typing `[[Old Port]]` by hand — no brackets needed.
Matching is case-insensitive, whole-word only (won't match "Porter" for an entity named "Port"),
and names under 4 characters are skipped to avoid auto-linking every occurrence of a short, common
word that happens to share an entity's name. An explicit `[[wikilink]]` always takes priority and
is never re-linked by this pass.
