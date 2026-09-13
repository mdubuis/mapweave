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

## 2. Test the Postgres/PostGIS migration (Phases 1-2)

This is separate from the app above — nothing in the running app talks to it yet (that's Phase 4+).
It's its own thing to click through: a local database plus a small API server, checked with `curl`
and `psql` rather than a browser.

**Start the database:**

```bash
docker compose up -d        # from the repo root — starts Postgres+PostGIS, applies the schema on first run
```

`docker compose down -v` wipes it (e.g. to re-apply a changed `server/db/schema.sql`, which only
runs against an empty volume).

**Install and start the API:**

```bash
cd server
npm install
npm run start                # listens on http://127.0.0.1:3001
```

**Import a map.** Fastest path — the bundled synthetic fixture (three cells, no real map needed):

```bash
node scripts/import-map.mjs --pack scripts/fixtures/PackCells.sample.json --name "Test Map"
```

To import a map you actually generated: in the running app, **Options → Export → JSON → Pack
Cells** (not the GeoJSON export menu — see `server/README.md` for why), then:

```bash
node scripts/import-map.mjs --pack ~/Downloads/PackCells.json --name "My World"
```

**Look at what landed**, either via `psql`:

```bash
docker exec mapweave-postgres psql -U mapweave -d mapweave -c "SELECT id, name, seed FROM maps;"
```

or via the API (any of these in a browser or `curl`):

```
http://127.0.0.1:3001/api/maps
http://127.0.0.1:3001/api/maps/1
http://127.0.0.1:3001/api/maps/1/layers/states     # a GeoJSON FeatureCollection
http://127.0.0.1:3001/api/maps/1/entities/tree      # states → provinces → burgs, + cultures/religions/rivers/markers
```

Full endpoint list and what's deliberately not imported yet (zones, river meandering, grid
topology) in `server/README.md`.

**Generate a map server-side** (Phase 3 — the real generation engine, running under Node, no
browser needed):

```bash
npm run generate -- --seed my-world --width 1280 --height 800 --density 4 --name "My World"
```

This generates and imports in one step. `density` is the same graph-size slider step as the app's
own UI (0 = 1000 points ... 4 = 10000 default ... 12 = 100000). To actually confirm a server run
matches a browser run for the same seed (the one check that needs a real browser — see
`server/README.md`'s Phase 3 section for why), generate that seed/size in the running app, export
**Pack Cells JSON**, then `npx tsx scripts/compare-with-browser.ts --seed ... --pack ...`.

## 3. Try the map app changes (Phase 3/4)

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
- **Wiki menu button**: a small circular button (top-right, book/sitemap icon) opens the wiki as a
  slide-in panel without leaving the map — see below.
- **Style**: dialogs, buttons, inputs, the options panel, and the bottom hint bar got a pass —
  rounded corners, soft shadows, smoother transitions, and a proper keyboard focus ring, all layered
  on the app's existing dialog theme-color system rather than replacing it. This hasn't been
  clicked through in a real browser (see step 4) — if something looks off in a specific dialog,
  that's the first place to check.

## 4. Try the wiki app (Phase 2/4)

Click the circular wiki button (top-right of the map screen) to open it as a slide-in panel — no
map needs to be loaded for this. You can also open `/Fantasy-Map-Generator/wiki.html` directly in
its own tab if you'd rather not have it embedded.

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

## 5. Verify nothing's broken after a change

Run these before considering any change done — same commands CI and the pre-commit hook use:

```bash
npx tsc --noEmit     # type errors
npm run lint         # biome check --write
npm run test         # vitest unit tests
npm run build        # both index.html and wiki.html bundles
```

`npm run test:e2e` (Playwright) exists but per project convention is **never run automatically** —
only run it yourself, deliberately, if you need end-to-end coverage.

## 6. Where to make improvements

| Want to change... | Look at |
|---|---|
| The lore file format itself | `wiki/SCHEMA.md` (spec) + `src/wiki/entities.ts`, `frontmatter.ts` (parsing) |
| Markdown rendering (tables, etc. aren't supported yet) | `src/wiki/markdown.ts` |
| The wiki browsing/editing UI | `src/wiki-main.ts`, `src/wiki.html`, `src/wiki.css` |
| How map objects link to wiki pages | `src/wiki/map-link.ts`, plus the three call sites: `src/controllers/burg-editor.ts`, `markers-editor.ts`, `states-editor.ts` |
| Timeline / era logic | `src/wiki/eras.ts` (resolution), `src/services/era-switcher.ts` (map-side UI) |
| Seed/example content | `wiki/**/*.md` — feel free to replace with your real world's content |
| The wiki menu button/panel on the map | `src/services/wiki-panel.ts` |
| Shared dialog/button/input styling | `public/index.css` — look for the `--radius`/`--shadow`/`--transition` tokens near the top and the rules using them (`.ui-widget.ui-widget-content`, `.ui-widget-header`, `#options`, generic `button`/`input`/`select`) |
| The Postgres/PostGIS migration | `MIGRATION.md` (plan + phase status), `server/README.md` (how to run/test it) |

Known gaps worth tackling next (see `MAPWEAVE.md`'s decisions log for full context):
- No real `.map` files for the seed eras yet — the timeline feature has nothing to actually load.
- README and the About tab's community links still describe upstream Azgaar/FMG, not Mapweave.
- Map↔wiki linking covers burgs, states, and markers only (per the original scope) — provinces,
  religions, rivers, cultures have the data model (`map_ref.kind` already supports them) but no
  click-to-link UI wired in yet.
