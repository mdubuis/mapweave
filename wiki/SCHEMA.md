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
map_ref:                        # optional — links this entity to a map object (see below)
  kind: burg
  id: 42
  name: Old Port                # snapshot of the map object's name when linked, for drift-detection
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

Reserved for Phase 3 (map ↔ wiki linking). Links this wiki entity to one object on the generated
map. `kind` matches FMG's own entity types (`burg`, `state`, `province`, `religion`, `culture`,
`marker`, `river`); `id` is that object's numeric id in the currently loaded `.map` file. FMG ids
are positional (array index) and only stable within one map's edit lineage — they are **not**
stable across a full regeneration. `name` is a snapshot of the map object's name at link time so a
later mismatch (id now points at a differently-named object) can be flagged instead of silently
mislinking.

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
