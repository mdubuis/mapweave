# Running and testing Mapweave

A practical walkthrough for trying out what's been built (see `MAPWEAVE.md` for the full phase
history) and where to go next if something needs improving.

## 1. Install and start the dev server

```bash
npm install
npm run dev -- --port 5199 --strictPort   # or just `npm run dev`
```

Open the URL Vite prints (something like `http://localhost:5199/Fantasy-Map-Generator/` — the
`/Fantasy-Map-Generator/` base path is inherited from upstream FMG and hasn't been renamed yet).
The map app boots as usual: a random map generates on load.

## 2. Try the map app changes (Phase 3/4)

- **Wiki links on map entities**: click any burg on the map (opens the Burg Editor) — there's a new
  link icon (🔗-style, `icon-link-ext`) next to the notes/book icon in the bottom toolbar. Click it:
  since nothing in the seed wiki links to *your* random burg, it opens the wiki app's "create a
  page" flow, prefilled with that burg's id. Same icon exists on markers (Markers Editor) and on
  each row of the States Editor table.
  - To see the "already linked" path instead of "create new": open States/Burgs Editor, note a
    burg's id (shown in its editor dialog), then edit `wiki/places/old-port.md`'s `map_ref` to use
    that id instead of `7`, reload, and click the same burg — it should now open the existing page.
- **Era switcher**: a small floating dropdown appears top-center of the map screen (only shows up
  because `wiki/eras/founding.md` and `post-war.md` exist). Selecting an era navigates to
  `?maplink=...&` for that era's `public/maps/*.map` file — which doesn't exist yet in this repo
  (see `public/maps/README.md`), so you'll see FMG's normal "map link is not valid" message. That's
  expected until a real `.map` file is exported and dropped there for at least one era.

## 3. Try the wiki app (Phase 2/4)

Open `/Fantasy-Map-Generator/wiki.html` (same origin, swap `index.html` for `wiki.html` in the URL
bar). No map needs to be loaded for this — it's a separate page.

- Browse the seed content: **Old Port**, **Mira Thorne**, **Silver Compact**, **The Salt War**, and
  the two eras, all cross-linked with `[[wikilinks]]`. Click through them.
- Click **"Show graph"** (bottom of the sidebar) for the force-directed relation graph.
- Try the **era selector** at the top of the sidebar: switching between "Founding" / "After the
  Salt War" / "All eras" changes which entities show and resolves `eras:` overrides (Old Port's
  summary changes between the two, and its "map:" badge switches burg ids per era if you set
  different ones).
- Click a `[[broken link]]` (there's one by design in "The Salt War", `[[map_ref]]`) to see the
  "doesn't have a page yet" flow.
- **Editing**: in a Chromium-based browser (Chrome/Edge — Firefox/Safari don't support the File
  System Access API and the button will be disabled), click **"Open wiki folder…"** and pick this
  repo's `wiki/` directory. You can now edit any page in place (a plain `<textarea>` over the raw
  Markdown+frontmatter) and create new pages from broken/create links — changes write straight to
  disk.

## 4. Verify nothing's broken after a change

Run these before considering any change done — same commands CI and the pre-commit hook use:

```bash
npx tsc --noEmit     # type errors
npm run lint         # biome check --write
npm run test         # vitest unit tests
npm run build        # both index.html and wiki.html bundles
```

`npm run test:e2e` (Playwright) exists but per project convention is **never run automatically** —
only run it yourself, deliberately, if you need end-to-end coverage.

## 5. Where to make improvements

| Want to change... | Look at |
|---|---|
| The lore file format itself | `wiki/SCHEMA.md` (spec) + `src/wiki/entities.ts`, `frontmatter.ts` (parsing) |
| Markdown rendering (tables, etc. aren't supported yet) | `src/wiki/markdown.ts` |
| The wiki browsing/editing UI | `src/wiki-main.ts`, `src/wiki.html`, `src/wiki.css` |
| How map objects link to wiki pages | `src/wiki/map-link.ts`, plus the three call sites: `src/controllers/burg-editor.ts`, `markers-editor.ts`, `states-editor.ts` |
| Timeline / era logic | `src/wiki/eras.ts` (resolution), `src/services/era-switcher.ts` (map-side UI) |
| Seed/example content | `wiki/**/*.md` — feel free to replace with your real world's content |

Known gaps worth tackling next (see `MAPWEAVE.md`'s decisions log for full context):
- No real `.map` files for the seed eras yet — the timeline feature has nothing to actually load.
- README and the About tab's community links still describe upstream Azgaar/FMG, not Mapweave.
- Map↔wiki linking covers burgs, states, and markers only (per the original scope) — provinces,
  religions, rivers, cultures have the data model (`map_ref.kind` already supports them) but no
  click-to-link UI wired in yet.
