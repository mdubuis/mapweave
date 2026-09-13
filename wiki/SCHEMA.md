# Mapweave wiki — file schema

One entity per Markdown file, anywhere under `wiki/`. The folder (`places/`, `characters/`, ...) is
just organization — the `type` frontmatter field is what the engine actually reads. The filename
(without `.md`) is the entity's **slug**: its permanent id, used by wikilinks and URLs. Renaming a
file changes its slug and breaks links to it, so prefer adding an alias (see below) over renaming.

## Frontmatter

```yaml
---
title: Old Port
type: place            # place | character | faction | event | item — or any custom string
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
  of fields that actually change (`summary`, a `status` field you define, `relations.ruled_by`,
  ...), not for re-describing the whole entity. The main Markdown body is not era-scoped — write
  its "current" description there, and use ordinary headings for an in-prose history section if
  you want the full story in one page (`## Under the Silver Compact` / `## After the Salt War`).

The wiki app's era selector (top of the sidebar) filters the entity list to what's relevant to the
chosen era (linked via `map_ref` there, overridden via `eras` there, or era-agnostic — no
`map_ref`/`eras` at all, like most characters and factions) and resolves overrides before
rendering. "All eras" shows everything, unresolved. The map app's own era switcher (top of the map
screen) is entirely separate — it just navigates to `?maplink=<that era's map_file>`, FMG's
existing map-loading mechanism, so eras are also just bookmarkable/shareable links.

## Wikilinks

`[[slug]]` or `[[slug|display text]]` anywhere in the body. Resolution is case-insensitive and
matches against each file's slug and its `aliases`. A link that resolves nowhere still renders —
as a distinctly styled "missing page" link — rather than breaking the page; Phase 3 extends this
to "create the page" instead of just flagging it.

## Markdown support

The renderer covers the subset lore pages actually need: headings (`#`..`######`), paragraphs,
bold/italic, inline code, fenced code blocks, unordered/ordered lists, blockquotes, horizontal
rules, and links (both `[text](url)` and `[[wikilinks]]`). It is not full CommonMark — no tables,
no nested blockquotes/lists beyond one level. Extend `src/wiki/markdown.ts` if a page needs more.
