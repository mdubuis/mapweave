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
browser needed). Still from `server/` (all `npm run` commands on this page are — the `generate`
script only exists in `server/package.json`, not the one at the repo root):

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
- **"View Map" panel** (Phase 4.1): click it in the sidebar — the map app opens full-screen inside
  the wiki, in an iframe. Its own wiki button is suppressed while nested (no infinite wiki-in-map-
  in-wiki), so this is currently one-way: wiki hosts map, not map hosts wiki.
- **"Connect to map database…"** (Phase 4.2): needs the Postgres + API server from step 2 running,
  and at least one map imported there. Click the button, pick a map from the dropdown, **Connect**.
  The sidebar now shows a live tree of every generated entity (states → provinces → burgs, plus
  cultures/religions/rivers/markers) merged in alongside the hand-written pages above — none of
  that data was written to any `.md` file. Click a generated entity: it has a "from map #N" badge
  and a **"Write a lore page for this ↗"** link that hands off to the normal page-creation flow,
  pre-filled. If the button just shows an error, the API server (step 2) isn't running.

## 5. Try the Leaflet camera and the converted layers (Phase 5, in progress)

Pan/zoom on the map screen is now driven by a real Leaflet map instance instead of the previous
d3-zoom code, and eight layers — the five territory layers (**biomes**, **religions**, **cultures**,
**provinces**, **states**) plus **rivers**, **routes**, and **markers** — are now actually rendered
by Leaflet (`L.geoJSON()`/`L.marker`) rather than hand-drawn SVG. Everything else (burgs, the
minimap, the ruler) is still on the old code, unconverted. There's no visible UI difference to look
for beyond those layers — the useful check is that nothing *regressed*:

- Drag to pan, scroll/pinch to zoom, double-click to zoom in — should feel the same as before.
- `F2` / the "new map" button, the heightmap gallery, and `?seed=`/`?maplink=` URLs should all still
  load and center correctly.
- Zoom in enough to trigger label resizing — reads `viewport.scale`, now fed by Leaflet rather
  than d3.
- The minimap (bottom-left, if enabled) should still track the viewport rectangle correctly while
  panning/zooming.
- Open the Style Editor for Biomes/Religions/Cultures/Provinces and check the opacity slider has a
  visible effect, and that these layers *aren't* fully opaque by default (this exercises a real,
  retroactive bug found and fixed — see `MIGRATION.md`). Biomes specifically should never paint
  over open ocean.
- **Biomes**: switch to the "Biomes" layer preset (or toggle the biomes layer on from the layers
  panel) — it should render and color exactly as before. In the Biomes editor (bottom toolbar),
  hover a biome row to confirm the highlight-on-hover outline still appears on the map, and change
  a biome's color to confirm it updates. Toggle the layer off and back on to confirm it still
  reappears correctly (this exercises the pane-creation fix described in `MIGRATION.md`).
- **Religions**: switch to the "Religions" preset. In the Religions editor: hover a row (outline
  highlight on the map), change a color (should update), click the "locate" icon on a row (should
  zoom/pan to that religion's territory — this exercises a real coordinate-space bug found and
  fixed during this conversion, see `MIGRATION.md`), and remove a religion (its territory should
  disappear from the map, not just the editor list).
- **Cultures**: switch to the "Cultural" preset. Same checks as Religions in the Cultures editor —
  hover, recolor, "locate", and remove — plus each culture's center marker (a small circle) should
  keep tracking correctly since that part wasn't touched by this conversion.
- **Provinces**: switch to the "Provinces" preset. In the Provinces editor: hover a row, recolor,
  "locate", and remove a province — same checks as the others. Two additional ones unique to
  provinces, both exercising a real bug found and fixed during this conversion (see
  `MIGRATION.md`): click the fog/focus icon (pin icon) on a province row — it should dim everything
  outside that province's actual territory, correctly aligned, not offset or oddly scaled; and
  start a province merge (Merge button) and hover a candidate province — the animated red outline
  trace should hug that province's real boundary.
- **States**: default view, no preset switch needed. In the States editor: hover, recolor,
  "locate", remove, fog/focus, and merge-hover — same checks as Provinces. Two more, unique to
  states: turn on **Options → Interface → shapeRendering → geometricPrecision** and confirm every
  state shows a soft blurred border glow that actually follows its territory's real shape (this is
  the one layer with no direct Leaflet equivalent for this effect — worth a close look); and open
  the **Diplomacy editor** and confirm every state recolors by its relationship to the selected one
  (ally/enemy/neutral colors) — this exercises a whole feature found late in this conversion, not
  just in the States editor itself.
- **Rivers**: rivers should render and color exactly as before (a shared water color, not per-river
  like the other five layers). Open **Rivers Overview** and try: hover a row (the river should
  highlight red on the map), "locate" a row (zoom/pan to it), and **Basin Highlight** (every river
  should get a distinct color by drainage basin, then revert cleanly when toggled off). Open the
  River editor on one (via the pencil icon in Rivers Overview, not by clicking the map — see below)
  and drag a control point: the river's shape should update live, smoothly, without the other
  rivers flickering or re-rendering. **Specifically worth checking, uncertain outcome**: does
  clicking a river directly *on the map* open its editor, and does hovering a river on the map
  highlight its row in Rivers Overview? Both depend on a real risk found during this conversion
  (unlike the five previous layers, rivers were never click-through by design) — a "no" here isn't
  a regression from this session's work, it's the click-delegation gap already tracked in
  `MIGRATION.md` as still-pending, now confirmed to matter for rivers specifically.
- **Routes**: roads/trails/sea routes should each keep their own distinct color/width/dash style
  (not all one color like rivers). Open the **Route editor** on one (via Routes Overview) and drag a
  control point — same "updates live, other routes untouched" check as rivers, plus **specifically**:
  change the route's group in the editor (the dropdown) while still editing it — the route should
  recolor to match the new group *and remain editable* (draggable, clickable to add points) without
  needing to reopen the editor. Try **Route Groups editor**: add a custom group, assign a route to
  it, remove a group — the group list and route colors should stay in sync. Same map-click/hover
  uncertainty as rivers applies here too (see above).
- **Markers**: markers should render with the same pin shapes/icons/colors as before. Open a marker
  (via **Markers Overview**'s pencil icon, not by clicking the map — see below) and **drag it** on
  the map: it should move smoothly (this is now real native Leaflet dragging, not the old
  d3-drag-on-SVG-attributes code) and land at the new position once released. While editing, change
  its icon, pin shape, size, or colors in the dialog — the marker should update live and *stay
  draggable*. Zoom in/out and confirm marker icons resize (the "rescale" style option, on by
  default) — the resize should settle once the zoom gesture ends, not stutter mid-gesture. Try
  **Markers Overview**: filter by state/culture/type/search (only matching markers should show on
  the map), pin/unpin, lock/unlock, "locate" (zoom + flash outline), and remove one/remove all
  unlocked. Try **Markers in Radius** (the dot-circle icon in the marker editor): the radius circle
  and the in-range list should stay in sync as you change the radius, and removing a marker from the
  list should update both the list and the map. Same map-click/hover uncertainty as rivers/routes
  applies here too (see above) — clicking a marker pin directly on the map to open its editor is not
  guaranteed to work yet.

If any of that feels off, that's the regression to report — see `MIGRATION.md`'s Phase 5 section
for exactly what changed (`src/components/zoom.ts`, `src/components/leaflet-map.ts`,
`src/renderers/leaflet/`, `src/renderers/draw-biomes.ts`, `src/renderers/draw-religions.ts`,
`src/renderers/draw-cultures.ts`, `src/renderers/draw-provinces.ts`, `src/renderers/draw-states.ts`,
`src/renderers/draw-rivers.ts`, `src/renderers/draw-routes.ts`, `src/renderers/draw-markers.ts`) and
what's still unconverted. **Also worth knowing**: image export (SVG/PNG/JPEG/tiles, via the Export
menu) currently omits all 8 converted layers entirely — a real, newly-discovered gap, not something
to re-report as a surprise; see `MIGRATION.md`'s Phase 5 section for details.

## 6. Verify nothing's broken after a change

Run these before considering any change done — same commands CI and the pre-commit hook use:

```bash
npx tsc --noEmit     # type errors
npm run lint         # biome check --write
npm run test         # vitest unit tests
npm run build        # both index.html and wiki.html bundles
```

`npm run test:e2e` (Playwright) exists but per project convention is **never run automatically** —
only run it yourself, deliberately, if you need end-to-end coverage.

## 7. Where to make improvements

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
