import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  select
} from "d3";
import { type BoardHandle, mountBoard } from "@/renderers/leaflet/board-canvas";
import {
  type BoardData,
  extractBoardData,
  extractBoardDataForTab,
  replaceBoardBlockForTabInRaw,
  replaceBoardBlockInRaw
} from "@/wiki/board";
import {
  API_BASE,
  type ConnectedMapInfo,
  dbRefOf,
  fetchAvailableMaps,
  fetchConnectedMapInfo,
  getConnectedMapId,
  loadGeneratedEntities,
  type MapSummary,
  setConnectedMapId
} from "@/wiki/db-entities";
import {
  createEntity,
  deleteTemplate,
  isFileSystemAccessSupported,
  loadFromDirectory,
  loadTemplates,
  type PageTemplate,
  pickWikiDirectory,
  saveEntity,
  saveTemplate
} from "@/wiki/editor";
import {
  type AutoLinkName,
  buildAutoLinkNames,
  buildEntityTree,
  buildSlugIndex,
  effectiveTabs,
  extractSnippet,
  loadEntities,
  resolveTarget
} from "@/wiki/entities";
import { type Era, isEntityInEra, loadEras, resolveEntityForEra } from "@/wiki/eras";
import { parseFrontmatter } from "@/wiki/frontmatter";
import { patchFrontmatterType } from "@/wiki/frontmatter-patch";
import { buildGraph } from "@/wiki/graph";
import {
  mapToWikiBus,
  PLACEMENT_CANCEL,
  PLACEMENT_REQUEST,
  PLACEMENT_RESULT,
  type PlacementKind,
  type PlacementMessage,
  wikiToMapBus
} from "@/wiki/map-bridge";
import { insertMapRefBlock } from "@/wiki/map-ref-patch";
import { renderMarkdown } from "@/wiki/markdown";
import { applyMarkdownCommand, type MarkdownCommand } from "@/wiki/markdown-edit-commands";
import { parseObjective, parseWeightedEntry, rollEncounter } from "@/wiki/scenario";
import { hasSecretContent, stripSecrets } from "@/wiki/secrets";
import {
  DEFAULT_ERA,
  type EdgeKind,
  type MapRef,
  type MapRefKind,
  type PageTabMeta,
  type WikiEntity,
  type WikiGraph
} from "@/wiki/types";

// Two independent entity sources, merged into `entities` below — see src/wiki/db-entities.ts and
// MIGRATION.md Phase 4.2. Each source reloads on its own; neither wipes the other out.
let fileEntities: WikiEntity[] = loadEntities();
let dbEntities: WikiEntity[] = [];
let entities: WikiEntity[] = fileEntities;
let graph: WikiGraph = buildGraph(entities);
let slugIndex = buildSlugIndex(entities);
let eras: Era[] = loadEras(entities);
let autoLinkNames: AutoLinkName[] = buildAutoLinkNames(entities);
let handles = new Map<string, FileSystemFileHandle>();
let rawContents = new Map<string, string>();
let dirHandle: FileSystemDirectoryHandle | undefined;
/** The DB-connected map's identity — see loadDatabaseEntities. Not yet wired into the map engine's
 *  own load (see renderMapView's doc comment on that deferred gap); still used by the world
 *  switcher UI. */
let connectedMap: ConnectedMapInfo | undefined;
/** Cached result of the last fetchAvailableMaps() call — the world switcher and the "choose a
 *  world" view both need the full list; refetched whenever either is opened, not on every render. */
let availableWorlds: MapSummary[] = [];

const WORLD_STORAGE_KEY = "mapweave.lastMapId";
/** "Place on map" request in flight — see requestPlacement/the message listener in initToolbar().
 *  Only one at a time; the UI doesn't offer a second "Place on map" click while this is set. */
let pendingPlacement: { requestId: string; slug: string; era: string; kind: PlacementKind } | undefined;

/** The one `type: board` canvas currently mounted, if any — owns a live Leaflet map instance that
 *  must be explicitly torn down (destroy()) before #content is overwritten, or it leaks document-
 *  level event listeners. See teardownBoard(). */
let activeBoardHandle: BoardHandle | undefined;

function teardownBoard(): void {
  activeBoardHandle?.destroy();
  activeBoardHandle = undefined;
}

function mergeEntitySources(): void {
  entities = [...fileEntities, ...dbEntities];
  graph = buildGraph(entities);
  slugIndex = buildSlugIndex(entities);
  eras = loadEras(entities);
  autoLinkNames = buildAutoLinkNames(entities);
}

/** Sticky UI state, not solely URL-derived: browsing via wikilinks shouldn't reset the chosen era */
let activeEra: string | undefined = new URL(location.href).searchParams.get("era") ?? undefined;

const VIEW_MODE_STORAGE_KEY = "mapweave.viewMode";
/** GM view shows everything; player view hides `secret: true` entities and `:::secret` blocks — a
 *  local display filter the GM flips before sharing their screen, not real access control (this
 *  app has no auth/multi-user concept at all — see MAPWEAVE.md). */
let viewMode: "gm" | "player" = localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "player" ? "player" : "gm";

/** User-saved page templates — a starter you pick when creating a page, beyond the built-in
 *  per-type ones (scenarioTemplateBlock in editor.ts). Live in wiki/templates/ as real files
 *  (wiki/editor.ts's loadTemplates/saveTemplate/deleteTemplate), reloaded alongside the rest of the
 *  directory in reloadFromDirectory — same file-based storage as the wiki's own content, unlike
 *  most of this app's other localStorage-backed UI state. */
let templates: PageTemplate[] = [];

function templatesForType(type: string): PageTemplate[] {
  return templates.filter(template => template.type === type);
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const byslug = (slug: string) => entities.find(e => e.slug === slug);
const resolveLink = (target: string) => resolveTarget(slugIndex, target);

const MAP_REF_KINDS: MapRefKind[] = ["burg", "state", "province", "religion", "culture", "marker", "river"];

const ENTITY_TYPES = [
  "place",
  "character",
  "faction",
  "event",
  "item",
  "quest",
  "encounter-table",
  "session-log",
  "board"
];

/** Current type first if it's not one of the standard ones (e.g. "era"), so the select never
 *  silently swaps a page to a different type just by opening the editor. */
function typeOptionsHtml(selected: string): string {
  const types = ENTITY_TYPES.includes(selected) ? ENTITY_TYPES : [selected, ...ENTITY_TYPES];
  return types.map(type => `<option value="${type}"${type === selected ? " selected" : ""}>${type}</option>`).join("");
}

type Route =
  | { view: "list" }
  | { view: "entity"; slug: string; tab?: string }
  | { view: "new"; title: string; mapRef?: MapRef }
  | { view: "quests" }
  | { view: "sessions" }
  | { view: "timeline" }
  | { view: "choose-world" }
  | { view: "map"; newWorld?: boolean };

function currentRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("entity/")) {
    const [slugPart, query] = hash.slice("entity/".length).split("?");
    const tab = query ? (new URLSearchParams(query).get("tab") ?? undefined) : undefined;
    return { view: "entity", slug: decodeURIComponent(slugPart), tab };
  }
  if (hash.startsWith("map")) {
    const newWorld = new URLSearchParams(hash.split("?")[1] ?? "").get("new") === "1";
    return { view: "map", newWorld };
  }
  if (hash.startsWith("quests")) return { view: "quests" };
  if (hash.startsWith("sessions")) return { view: "sessions" };
  if (hash.startsWith("timeline")) return { view: "timeline" };
  if (hash.startsWith("choose-world")) return { view: "choose-world" };
  if (hash.startsWith("new")) {
    const params = new URLSearchParams(hash.split("?")[1] ?? "");
    const title = params.get("title") ?? "";
    const mapKind = params.get("mapKind");
    const mapId = params.get("mapId");
    const mapCell = params.get("mapCell");
    const mapEra = params.get("mapEra");
    if (mapEra) activeEra = mapEra; // arriving from a map click: adopt that era as the browsing context too
    const mapRef =
      mapKind && MAP_REF_KINDS.includes(mapKind as MapRefKind) && mapId
        ? { kind: mapKind as MapRefKind, id: Number(mapId), name: title, cell: mapCell ? Number(mapCell) : undefined }
        : undefined;
    return { view: "new", title, mapRef };
  }
  return { view: "list" };
}

async function reloadFromDirectory(): Promise<void> {
  if (!dirHandle) return;
  const [source, loadedTemplates] = await Promise.all([loadFromDirectory(dirHandle), loadTemplates(dirHandle)]);
  fileEntities = source.entities;
  handles = source.handles;
  rawContents = source.raw;
  templates = loadedTemplates;
  mergeEntitySources();
  renderEraSelect();
  renderSidebar(el<HTMLInputElement>("search").value);
}

async function loadDatabaseEntities(mapId: number): Promise<void> {
  // No feedback here before — a world switch just looked frozen until both fetches resolved.
  el<HTMLElement>("loading-bar").removeAttribute("hidden");
  try {
    const [entities, mapInfo] = await Promise.all([
      loadGeneratedEntities(API_BASE, mapId),
      fetchConnectedMapInfo(API_BASE, mapId)
    ]);
    dbEntities = entities;
    connectedMap = mapInfo;
    setConnectedMapId(mapInfo.id);
    mergeEntitySources();
    localStorage.setItem(WORLD_STORAGE_KEY, String(mapId));
    updateWorldSwitcherLabel();
    renderEraSelect();
    renderSidebar(el<HTMLInputElement>("search").value);
  } finally {
    el<HTMLElement>("loading-bar").setAttribute("hidden", "");
  }
}

/** Reflects the connected world's name in the sidebar control — looked up from availableWorlds
 *  (populated by whichever of connectToPersistedWorld/openWorldMenu/renderChooseWorldView last
 *  fetched the list) rather than carried on ConnectedMapInfo, which has no name field. */
function updateWorldSwitcherLabel(): void {
  const label = el<HTMLElement>("world-switcher-label");
  const name = connectedMap && availableWorlds.find(map => map.id === connectedMap!.id)?.name;
  label.textContent = name ?? (connectedMap ? `World #${connectedMap.id}` : "Choose a world…");
}

/**
 * Connects to whichever world the user picked last time (see renderChooseWorldView/openWorldMenu),
 * so returning to the app doesn't re-ask every load — but never guesses "the most recent map" the
 * way the old auto-connect did. No persisted world, or it no longer exists, or the API server
 * can't be reached at all to check: sends a first-time visitor (still on the plain landing route)
 * to #/choose-world — the "pick an existing world or create a new one" landing choice, never
 * silently dropped onto the plain wiki home view, even fully offline (creating a new world is the
 * legacy engine's own client-side generation, which needs no server at all; renderChooseWorldView
 * itself degrades gracefully when the "existing worlds" list can't be fetched). Leaves a direct
 * deep link (e.g. a bookmarked entity page) alone rather than yanking it away.
 */
async function connectToPersistedWorld(): Promise<void> {
  const persistedId = Number(localStorage.getItem(WORLD_STORAGE_KEY)) || undefined;
  let matched = false;

  try {
    availableWorlds = await fetchAvailableMaps(API_BASE);
    const match = persistedId && availableWorlds.find(map => map.id === persistedId);
    if (match) {
      await loadDatabaseEntities(match.id);
      matched = true;
    }
  } catch {
    // offline/unreachable server: file entities alone still work either way
  }

  // Checked now, not captured before the awaits above: the user may have already navigated away
  // (e.g. clicked "+ Create a new world" while this fetch was in flight) — redirecting over that
  // would silently yank them back to #/choose-world mid-boot, exactly the "yanking away" this
  // function's own doc comment says to avoid. A stale pre-fetch snapshot of the route can't tell
  // the difference between "still on the landing route" and "was on it a moment ago."
  if (!matched && currentRoute().view === "list") {
    location.hash = "#/choose-world";
    return;
  }
  updateWorldSwitcherLabel();
  render();
}

/** Shared markup for a list of worlds — callers wire up their own click handler on
 *  `.world-list-item` afterward, since the "pick a world" action differs (route vs. in-place). */
function renderWorldPicker(maps: MapSummary[]): string {
  if (!maps.length)
    return `<p class="muted">No worlds yet — generate or import one first (see <code>server/README.md</code>).</p>`;
  return `<ul class="world-list">${maps
    .map(
      map =>
        `<li><button type="button" class="world-list-item${map.id === connectedMap?.id ? " current" : ""}" data-map-id="${map.id}"><strong>${map.name}</strong> <span class="muted">seed ${map.seed}</span></button></li>`
    )
    .join("")}</ul>`;
}

/** Shown on every branch of renderChooseWorldView, including the offline/error one — creating a
 *  new world is the legacy engine's own client-side generation, which doesn't touch the API server
 *  at all, so it stays available even when the "existing worlds" list can't be fetched. Lands on
 *  the engine's generation-settings tab (renderMapView's `newWorld`), not an instant random map. */
const CREATE_WORLD_HTML = `<p><a href="#/map?new=1" class="world-list-item create-world">+ Create a new world…</a></p>`;

function renderChooseWorldView(): void {
  const content = el<HTMLElement>("content");
  content.innerHTML = `<div class="landing-view"><h1>Mapweave</h1><p>Loading worlds…</p></div>`;

  fetchAvailableMaps(API_BASE)
    .then((maps: MapSummary[]) => {
      availableWorlds = maps;
      content.innerHTML = `<div class="landing-view">
        <h1>Mapweave</h1>
        <p class="landing-tagline">Choose a world to continue, or start a new one</p>
        ${CREATE_WORLD_HTML}${renderWorldPicker(maps)}
      </div>`;
      // button.world-list-item, not just .world-list-item — CREATE_WORLD_HTML's link shares the
      // class for consistent styling but is an <a href> with no data-map-id, handled by its own
      // href navigation instead of this click-to-load-a-DB-world delegation.
      content.querySelectorAll<HTMLButtonElement>("button.world-list-item").forEach(button => {
        button.addEventListener("click", async () => {
          await loadDatabaseEntities(Number(button.dataset.mapId));
          location.hash = "#/";
        });
      });
    })
    .catch((error: Error) => {
      content.innerHTML = `<div class="landing-view">
        <h1>Mapweave</h1>
        <p class="landing-tagline">Choose a world to continue, or start a new one</p>
        ${CREATE_WORLD_HTML}
        <p class="wiki-link-broken">Could not reach the API at ${API_BASE} — is the server running?
        (<code>cd server && npm run start</code>)</p>
        <p class="summary">${error.message}</p>
      </div>`;
    });
}

/** Quick world switch from anywhere in the wiki, without leaving the page you're on (unlike
 *  #/choose-world, a real route that replaces #content — appropriate for a first-time landing,
 *  not for switching mid-read). Toggled by the sidebar's world-switcher button. */
async function toggleWorldMenu(): Promise<void> {
  const menu = el<HTMLElement>("world-menu");
  if (!menu.hasAttribute("hidden")) {
    menu.setAttribute("hidden", "");
    return;
  }

  menu.innerHTML = `<p class="muted">Loading…</p>`;
  menu.removeAttribute("hidden");
  try {
    availableWorlds = await fetchAvailableMaps(API_BASE);
    menu.innerHTML = `${renderWorldPicker(availableWorlds)}<a href="#/choose-world">Browse all worlds…</a>`;
    menu.querySelectorAll<HTMLButtonElement>(".world-list-item").forEach(button => {
      button.addEventListener("click", async () => {
        menu.setAttribute("hidden", "");
        await loadDatabaseEntities(Number(button.dataset.mapId));
        render();
      });
    });
  } catch {
    menu.innerHTML = `<p class="wiki-link-broken">Could not reach the API — is the server running?</p>`;
  }
}

function renderEraSelect(): void {
  const eraSelect = el<HTMLSelectElement>("era-select");
  if (!eras.length) {
    eraSelect.hidden = true;
    return;
  }
  eraSelect.hidden = false;
  eraSelect.innerHTML = `<option value="">All eras</option>${eras
    .map(era => `<option value="${era.slug}"${era.slug === activeEra ? " selected" : ""}>${era.label}</option>`)
    .join("")}`;
}

function renderEntityList(
  items: WikiEntity[],
  childrenBySlug: Map<string, WikiEntity[]>,
  snippetBySlug: Map<string, string>
): HTMLUListElement {
  const ul = document.createElement("ul");
  for (const entity of items) {
    const brokenCount = graph.brokenLinks.get(entity.slug)?.length ?? 0;
    const snippet = snippetBySlug.get(entity.slug);
    const li = document.createElement("li");
    li.innerHTML = `<a href="#/entity/${encodeURIComponent(entity.slug)}">${entity.frontmatter.title}</a>${
      brokenCount ? ` <span class="badge-broken" title="${brokenCount} unresolved link(s)">${brokenCount}</span>` : ""
    }${snippet ? `<div class="search-snippet">${snippet}</div>` : ""}`;
    const children = childrenBySlug.get(entity.slug);
    if (children?.length) li.appendChild(renderEntityList(children, childrenBySlug, snippetBySlug));
    ul.appendChild(li);
  }
  return ul;
}

function renderSidebar(filter = ""): void {
  const list = el<HTMLElement>("entity-list");
  const grouped = new Map<string, WikiEntity[]>();
  const snippetBySlug = new Map<string, string>();
  const needle = filter.toLowerCase();
  let matchCount = 0;

  for (const entity of entities) {
    if (activeEra && !isEntityInEra(entity, activeEra)) continue;
    if (viewMode === "player" && entity.frontmatter.secret) continue;

    const titleAndTags = `${entity.frontmatter.title} ${(entity.frontmatter.tags ?? []).join(" ")}`;
    if (needle && !titleAndTags.toLowerCase().includes(needle)) {
      const body = viewMode === "player" ? stripSecrets(entity.body) : entity.body;
      if (!body.toLowerCase().includes(needle)) continue;
      snippetBySlug.set(entity.slug, extractSnippet(body, needle));
    }

    matchCount++;
    const group = grouped.get(entity.frontmatter.type) ?? [];
    group.push(entity);
    grouped.set(entity.frontmatter.type, group);
  }

  el<HTMLElement>("search-count").textContent = needle ? `${matchCount} result${matchCount === 1 ? "" : "s"}` : "";

  list.innerHTML = "";
  for (const [type, items] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const section = document.createElement("div");
    section.className = "entity-group";
    const heading = document.createElement("h2");
    heading.textContent = type;
    section.appendChild(heading);

    const { roots, childrenBySlug } = buildEntityTree(items);
    section.appendChild(renderEntityList(roots, childrenBySlug, snippetBySlug));
    list.appendChild(section);
  }
}

function renderRelations(relations: Record<string, string> | undefined): string {
  const entries = Object.entries(relations ?? {});
  if (!entries.length) return "";

  const items = entries
    .map(([label, target]) => {
      const resolved = resolveLink(target);
      const readable = label.replace(/_/g, " ");
      if (!resolved) return `<li>${readable}: <span class="wiki-link-broken">${target}</span></li>`;
      const title = byslug(resolved.slug)?.frontmatter.title ?? resolved.slug;
      return `<li>${readable}: <a class="wiki-link" href="#/entity/${encodeURIComponent(resolved.slug)}">${title}</a></li>`;
    })
    .join("");

  return `<section class="relations"><h3>Relations</h3><ul>${items}</ul></section>`;
}

const QUEST_STATUSES = ["open", "active", "complete", "abandoned"];

/** A quest's status as a colored pill in the header — any value outside the documented set still
 *  renders, just without a dedicated color (falls back to the plain badge style) */
function renderStatusBadge(status: string | undefined): string {
  if (!status) return "";
  const known = QUEST_STATUSES.includes(status) ? status : "other";
  return `<span class="status-badge status-${known}">${status}</span>`;
}

/** A generic key/value table — works for any game system, since the app never assumes what a
 *  stat's key means (see WikiFrontmatter.statBlockSystem, display-only) */
function renderStatsBlock(stats: Record<string, string | number> | undefined, system: string | undefined): string {
  if (!stats || !Object.keys(stats).length) return "";
  const rows = Object.entries(stats)
    .map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`)
    .join("");
  return `<section class="stats-block"><h3>Stats${system ? ` <span class="muted">(${system})</span>` : ""}</h3><table>${rows}</table></section>`;
}

/** Read-only checklist for a quest's objectives — editing an objective's done state still goes
 *  through the raw textarea editor, same as every other frontmatter field in this app */
function renderObjectives(objectives: string[] | undefined): string {
  if (!objectives?.length) return "";
  const items = objectives
    .map(parseObjective)
    .map(({ text, done }) => `<li class="${done ? "objective-done" : ""}">${done ? "☑" : "☐"} ${text}</li>`)
    .join("");
  return `<section class="objectives"><h3>Objectives</h3><ul>${items}</ul></section>`;
}

/** The wiki app's first stateful/interactive (non-editing) widget — rolls a weighted pick from an
 *  encounter table on demand. Owns its result in a closure and re-renders only its own container,
 *  never the route/URL. See scenario.ts's rollEncounter/parseWeightedEntry */
function mountEncounterRoller(container: HTMLElement, table: string[]): void {
  const entries = table.map(parseWeightedEntry);
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);

  function draw(): void {
    const result = rollEncounter(table);
    container.innerHTML = `
      <h3>Encounter table</h3>
      <ul class="encounter-entries">
        ${entries.map(entry => `<li>${entry.weight}× ${entry.text}</li>`).join("")}
      </ul>
      <button id="encounter-roll-btn" type="button">Roll</button>
      ${result ? `<p class="encounter-result">🎲 ${result.text}</p>` : ""}
    `;
    container.querySelector<HTMLButtonElement>("#encounter-roll-btn")?.addEventListener("click", draw);
  }

  if (!table.length || !totalWeight) {
    container.innerHTML = `<h3>Encounter table</h3><p class="muted">No entries yet — add some to the "table" list.</p>`;
    return;
  }
  draw();
}

/** FMG's `?burg=<id>` / `?cell=<id>` URL params already focus the map — see docs/wiki/URL-parameters.md.
 *  A real query string (read by url-params.ts's checkLoadParameters/focusOn) plus the `#/map` hash
 *  the shell's own router recognizes — one URL, both mechanisms, each reading the part it already
 *  reads. Changing the query string always reloads the page (unlike a hash-only navigation), so
 *  this is a real page reload, not instant — an accepted interim trade-off (see MAPWEAVE.md's
 *  Phase 6 "Phase 3" entry) until burg/cell focus can be requested without one. */
function mapViewHref(mapRef: MapRef | undefined): string | undefined {
  if (!mapRef) return undefined;
  if (mapRef.kind === "burg") return `?burg=${mapRef.id}&scale=8#/map`;
  if (mapRef.cell !== undefined) return `?cell=${mapRef.cell}&scale=8#/map`;
  return undefined;
}

/** Gate for offering "Place on map": must be editable, have no map_ref for any era yet, and — if
 *  this world defines eras at all — have one selected (an unscoped map_ref would be invisible in
 *  every era's view, see isEntityInEra). */
function canPlaceOnMap(entity: WikiEntity): boolean {
  if (!dirHandle || !handles.has(entity.slug)) return false;
  if (Object.keys(entity.frontmatter.map_ref ?? {}).length > 0) return false;
  if (eras.length > 0 && !activeEra) return false;
  return true;
}

/** The board toolbar + canvas container markup, shared by a whole-entity `type: board` page and a
 *  multi-tab page's board tab — only how it's mounted afterward differs (see mountBoardView's
 *  optional `tabId`). */
function boardSectionHtml(slug: string, canEdit: boolean): string {
  return `<div id="board-toolbar" class="board-toolbar">
      ${
        canEdit
          ? `<button id="board-add-image-btn" type="button">Add image</button>
            <button id="board-add-text-btn" type="button">Add text</button>
            <label>Link page:
              <select id="board-page-picker">${boardPagePickerOptions(slug)}</select>
            </label>
            <button id="board-add-page-btn" type="button">Link page</button>
            <button id="board-connect-btn" type="button">Connect</button>
            <button id="board-delete-btn" type="button">Delete</button>
            <button id="board-save-btn" type="button">Save</button>`
          : `<p class="muted">Read-only board</p>`
      }
    </div>
    <div id="board-canvas-container" class="board-canvas-container"></div>`;
}

/** Tab bar for a multi-tab page (Phase 6) — only rendered when the entity has more than one tab;
 *  a plain wiki page (the overwhelming majority, and every entity that predates this field) never
 *  shows one. See wiki/entities.ts's effectiveTabs and wiki/types.ts's PageTabs. */
function pageTabsHtml(slug: string, tabs: Array<PageTabMeta & { id: string }>, activeTabId: string): string {
  if (tabs.length <= 1) return "";
  const links = tabs
    .map(tab => {
      const label = tab.title ?? (tab.type === "wiki" ? "Wiki" : tab.type === "map" ? "Map" : "Board");
      const active = tab.id === activeTabId ? " active" : "";
      return `<a href="#/entity/${encodeURIComponent(slug)}?tab=${encodeURIComponent(tab.id)}" class="page-tab${active}">${label}</a>`;
    })
    .join("");
  return `<nav class="page-tabs">${links}</nav>`;
}

function renderEntityView(slug: string, tabParam?: string): void {
  teardownBoard();
  const content = el<HTMLElement>("content");
  const entity = byslug(slug);
  // A direct/bookmarked link to a secret page in player view should behave as if it doesn't exist
  // — same as it already not appearing in the sidebar/search (renderSidebar).
  if (!entity || (viewMode === "player" && entity.frontmatter.secret)) {
    content.innerHTML = `<p>No such page: <code>${slug}</code></p>`;
    return;
  }

  const resolved = activeEra
    ? resolveEntityForEra(entity, activeEra)
    : { frontmatter: entity.frontmatter, mapRef: undefined };
  const { frontmatter } = resolved;
  const eraCount = Object.keys(entity.frontmatter.map_ref ?? {}).length;

  const mapRefBadge = resolved.mapRef
    ? `<span class="map-ref-badge">map: ${resolved.mapRef.kind} #${resolved.mapRef.id} (${resolved.mapRef.name})</span>`
    : !activeEra && eraCount
      ? `<span class="map-ref-badge muted">linked on ${eraCount} era${eraCount === 1 ? "" : "s"} — pick one to view</span>`
      : "";
  const tags = (frontmatter.tags ?? []).map(tag => `<span class="tag">${tag}</span>`).join(" ");
  const canEdit = dirHandle && handles.has(slug);
  const mapHref = mapViewHref(resolved.mapRef);
  const dbRef = dbRefOf(entity);

  // Multi-tab pages (Phase 6): an entity with no explicit `tabs` frontmatter — every entity that
  // predates this field, and the common case going forward for a plain wiki/board page — takes the
  // exact code path this app has always used, completely unchanged below. Only a page that opts
  // into `tabs` reaches the new tab-bar/tab-dispatch logic.
  const hasExplicitTabs = Boolean(frontmatter.tabs && Object.keys(frontmatter.tabs).length > 0);
  const tabs = hasExplicitTabs ? effectiveTabs(frontmatter) : [];
  const activeTabId = hasExplicitTabs ? (tabParam && tabs.some(t => t.id === tabParam) ? tabParam : tabs[0].id) : "";
  const activeTab = hasExplicitTabs ? tabs.find(t => t.id === activeTabId) : undefined;

  const isEncounterTable = frontmatter.type === "encounter-table" && (frontmatter.table?.length ?? 0) > 0;
  const isBoard = !hasExplicitTabs && frontmatter.type === "board";
  const isBoardTab = hasExplicitTabs && activeTab?.type === "board";
  const isMapTab = hasExplicitTabs && activeTab?.type === "map";
  const hasSecrets = viewMode === "gm" && (frontmatter.secret || hasSecretContent(entity.body));
  const secretBadge = hasSecrets
    ? `<span class="secret-badge" title="Hidden from player view">${frontmatter.secret ? "secret page" : "has secrets"}</span>`
    : "";
  const body = viewMode === "player" ? stripSecrets(entity.body) : entity.body;

  const placementState: "idle" | "waiting" | "none" =
    pendingPlacement?.slug === slug ? "waiting" : canPlaceOnMap(entity) ? "idle" : "none";
  const placeOnMapHtml =
    placementState === "idle"
      ? `<section id="place-on-map">
          <label>Place as:
            <select id="place-kind">
              <option value="burg">Town/City (burg)</option>
              <option value="marker">Marker</option>
            </select>
          </label>
          <button id="place-on-map-btn" type="button">Place on map</button>
        </section>`
      : placementState === "waiting"
        ? `<section id="place-on-map">
            <p class="muted">Click the map to place it… <button id="place-cancel-btn" type="button">Cancel</button></p>
          </section>`
        : "";

  content.innerHTML = `
    <header class="entity-header">
      <h1>${frontmatter.title}</h1>
      <div class="entity-meta">
        <span class="type-badge">${frontmatter.type}</span>
        ${renderStatusBadge(frontmatter.status)}
        ${dbRef ? `<span class="map-ref-badge">from map #${dbRef.mapId}</span>` : ""}
        ${mapRefBadge}
        ${secretBadge}
        ${tags}
      </div>
      ${frontmatter.summary ? `<p class="summary">${frontmatter.summary}</p>` : ""}
      ${frontmatter.hook ? `<p class="hook">${frontmatter.hook}</p>` : ""}
      <div class="entity-actions">
        ${mapHref ? `<a href="${mapHref}">View on map</a>` : ""}
        ${canEdit ? `<button id="edit-btn" type="button">Edit</button>` : ""}
        ${
          dbRef
            ? `<a href="#/new?title=${encodeURIComponent(frontmatter.title)}" class="lore-cta">✎ Write a lore page for this</a>`
            : ""
        }
      </div>
    </header>
    ${placeOnMapHtml}
    ${renderObjectives(frontmatter.objectives)}
    ${frontmatter.resolution ? `<section class="resolution"><h3>Resolution</h3><p>${frontmatter.resolution}</p></section>` : ""}
    ${renderStatsBlock(frontmatter.stats, frontmatter.statBlockSystem)}
    ${isEncounterTable ? `<section id="encounter-roller"></section>` : ""}
    ${renderRelations(frontmatter.relations)}
    ${hasExplicitTabs ? pageTabsHtml(slug, tabs, activeTabId) : ""}
    ${
      isBoard || isBoardTab
        ? boardSectionHtml(slug, Boolean(canEdit))
        : isMapTab
          ? `<section id="map-tab-panel">
              ${
                activeTab?.mapId !== undefined && activeTab.mapId !== getConnectedMapId()
                  ? `<p id="map-tab-mismatch" class="muted">This tab is linked to map #${activeTab.mapId}, but the ${
                      getConnectedMapId() !== undefined
                        ? `currently loaded map is #${getConnectedMapId()}`
                        : "engine has no database world loaded"
                    } — showing that below (switching a tab to a specific database world without a full reload isn't wired up yet).</p>`
                  : ""
              }
              <div id="map-tab-mount"></div>
            </section>`
          : `<article class="entity-body">${renderMarkdown(body, resolveLink, autoLinkNames)}</article>`
    }
  `;

  el<HTMLButtonElement>("edit-btn")?.addEventListener("click", () => renderEditorView(slug));
  if (isEncounterTable) mountEncounterRoller(el<HTMLElement>("encounter-roller"), frontmatter.table!);
  if (isBoard) mountBoardView(slug, entity, Boolean(canEdit));
  if (isBoardTab) mountBoardView(slug, entity, Boolean(canEdit), activeTabId);
  if (isMapTab) void mountMapTabView();

  el<HTMLButtonElement>("place-on-map-btn")?.addEventListener("click", () => {
    const kind = el<HTMLSelectElement>("place-kind").value as PlacementKind;
    void requestPlacement(slug, kind);
  });
  el<HTMLButtonElement>("place-cancel-btn")?.addEventListener("click", () => {
    cancelPendingPlacement();
    renderEntityView(slug);
  });
}

function boardPagePickerOptions(excludeSlug: string): string {
  return entities
    .filter(entity => entity.slug !== excludeSlug)
    .slice()
    .sort((a, b) => a.frontmatter.title.localeCompare(b.frontmatter.title))
    .map(entity => `<option value="${encodeURIComponent(entity.slug)}">${entity.frontmatter.title}</option>`)
    .join("");
}

const MAX_BOARD_IMAGE_SIZE = 2 * 1024 * 1024;

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error instanceof Error ? reader.error : new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/** Mounts the `type: board` canvas into #board-canvas-container (already in the DOM from
 *  renderEntityView's innerHTML) and wires its toolbar. Board contents are kept in a local `data`
 *  variable updated via mountBoard's onChange callback, and only written to disk on "Save" — no
 *  autosave on drag, matching the rest of this app's explicit-save convention. */
/** `tabId` is set only for a multi-tab page's board tab — omitted, this is a whole-entity
 *  `type: board` page (the original, still-supported shape). Only the storage functions differ
 *  between the two; the canvas/toolbar mechanics are identical either way. */
function mountBoardView(slug: string, entity: WikiEntity, canEdit: boolean, tabId?: string): void {
  const container = el<HTMLElement>("board-canvas-container");
  let data: BoardData = tabId ? extractBoardDataForTab(entity.body, tabId) : extractBoardData(entity.body);

  const handle = mountBoard(container, data, {
    editable: canEdit,
    resolvePage(pageSlug) {
      const target = byslug(pageSlug);
      return target
        ? { title: target.frontmatter.title, href: `#/entity/${encodeURIComponent(target.slug)}` }
        : undefined;
    },
    onChange(next) {
      data = next;
    }
  });
  activeBoardHandle = handle;

  if (!canEdit) return;

  el<HTMLButtonElement>("board-add-image-btn").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_BOARD_IMAGE_SIZE) {
        window.alert(`Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 2 MB.`);
        return;
      }
      void fileToDataUri(file).then(dataUri => handle.addImage(dataUri));
    });
    input.click();
  });

  el<HTMLButtonElement>("board-add-text-btn").addEventListener("click", () => {
    const text = window.prompt("Card text:");
    if (text?.trim()) handle.addText(text.trim());
  });

  el<HTMLButtonElement>("board-add-page-btn").addEventListener("click", () => {
    const picked = el<HTMLSelectElement>("board-page-picker").value;
    if (picked) handle.addPage(decodeURIComponent(picked));
  });

  el<HTMLButtonElement>("board-connect-btn").addEventListener("click", () => handle.startConnectMode());
  el<HTMLButtonElement>("board-delete-btn").addEventListener("click", () => handle.deleteSelected());

  el<HTMLButtonElement>("board-save-btn").addEventListener("click", async () => {
    const fileHandle = handles.get(slug);
    const raw = rawContents.get(slug);
    if (!fileHandle || raw === undefined) return;
    const newRaw = tabId ? replaceBoardBlockForTabInRaw(raw, tabId, data) : replaceBoardBlockInRaw(raw, data);
    await saveEntity(fileHandle, newRaw);
    await reloadFromDirectory();
    renderEntityView(slug, tabId);
  });
}

function escapeForTextarea(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Trailing-edge debounce: fires `ms` after the last call, not on the first one — right for a
 *  "update once typing pauses" preview, unlike a leading-edge/cooldown debounce */
function debounceTrailing<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer = 0;
  return ((...args: never[]) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  }) as T;
}

function renderEditorView(slug: string): void {
  teardownBoard();
  const entity = byslug(slug);
  const handle = handles.get(slug);
  if (!entity || !handle) {
    renderEntityView(slug);
    return;
  }

  const raw = rawContents.get(slug) ?? "";
  const content = el<HTMLElement>("content");
  content.innerHTML = `
    <header class="entity-header">
      <h1>Editing: ${entity.frontmatter.title}</h1>
      <div class="editor-toolbar">
        <label>Type: <select id="editor-type">${typeOptionsHtml(entity.frontmatter.type)}</select></label>
        <span id="editor-word-count" class="muted"></span>
        <label class="preview-toggle"><input type="checkbox" id="preview-toggle" checked /> Preview</label>
      </div>
    </header>
    <div id="editor-format-bar" class="editor-format-bar">
      <button type="button" data-command="bold" title="Bold (Ctrl+B)"><b>B</b></button>
      <button type="button" data-command="italic" title="Italic (Ctrl+I)"><i>I</i></button>
      <button type="button" data-command="heading" title="Heading">H</button>
      <button type="button" data-command="bulletList" title="Bullet list">•</button>
      <button type="button" data-command="numberedList" title="Numbered list">1.</button>
      <button type="button" data-command="quote" title="Quote">"</button>
      <button type="button" data-command="code" title="Inline code">&lt;/&gt;</button>
      <button type="button" data-command="codeBlock" title="Code block">{ }</button>
      <button type="button" data-command="link" title="Link (Ctrl+K)">🔗</button>
      <button type="button" data-command="wikilink" title="Wikilink">[[ ]]</button>
    </div>
    <div id="editor-split">
      <textarea id="editor-textarea" spellcheck="false">${escapeForTextarea(raw)}</textarea>
      <article id="editor-preview" class="entity-body"></article>
    </div>
    <div class="editor-actions">
      <button id="save-btn" type="button">Save</button>
      <button id="cancel-btn" type="button">Cancel</button>
      <button id="save-template-btn" type="button">Save as template…</button>
    </div>
  `;

  const textarea = el<HTMLTextAreaElement>("editor-textarea");
  const preview = el<HTMLElement>("editor-preview");
  const wordCountEl = el<HTMLElement>("editor-word-count");

  function updatePreview(): void {
    const { content: body } = parseFrontmatter(textarea.value);
    preview.innerHTML = renderMarkdown(body, resolveLink, autoLinkNames);
    const count = wordCount(body);
    wordCountEl.textContent = `${count} word${count === 1 ? "" : "s"}`;
  }
  updatePreview();
  textarea.addEventListener("input", debounceTrailing(updatePreview, 200));

  function applyFormatCommand(command: MarkdownCommand): void {
    const result = applyMarkdownCommand(command, {
      value: textarea.value,
      start: textarea.selectionStart,
      end: textarea.selectionEnd
    });
    textarea.value = result.value;
    textarea.selectionStart = result.start;
    textarea.selectionEnd = result.end;
    textarea.focus();
    updatePreview();
  }

  el<HTMLElement>("editor-format-bar").addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-command]");
    if (button) applyFormatCommand(button.dataset.command as MarkdownCommand);
  });

  // Standard editor conventions — the browser's own Ctrl/Cmd+B/I/K (bold/italic/bookmark-ish)
  // default actions don't apply inside a plain textarea, so preventDefault() here is harmless
  textarea.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const command = { b: "bold", i: "italic", k: "link" }[event.key] as MarkdownCommand | undefined;
    if (!command) return;
    event.preventDefault();
    applyFormatCommand(command);
  });

  el<HTMLInputElement>("preview-toggle").addEventListener("change", event => {
    el<HTMLElement>("editor-split").classList.toggle("preview-hidden", !(event.target as HTMLInputElement).checked);
  });

  el<HTMLButtonElement>("cancel-btn").addEventListener("click", () => renderEntityView(slug));
  el<HTMLButtonElement>("save-btn").addEventListener("click", async () => {
    const selectedType = el<HTMLSelectElement>("editor-type").value;
    await saveEntity(handle, patchFrontmatterType(textarea.value, selectedType));
    await reloadFromDirectory();
    renderEntityView(slug);
  });
  el<HTMLButtonElement>("save-template-btn").addEventListener("click", async () => {
    const name = window.prompt("Template name:");
    if (!name?.trim()) return;
    await saveTemplate(dirHandle!, name.trim(), textarea.value);
    templates = await loadTemplates(dirHandle!);
  });
}

function renderNewEntityView(title: string, mapRef?: MapRef): void {
  const content = el<HTMLElement>("content");
  const mapRefNote = mapRef ? `<p class="summary">Linking to map ${mapRef.kind} #${mapRef.id} once created.</p>` : "";

  if (!dirHandle) {
    content.innerHTML = `
      <h1>“${title}” doesn't have a page yet</h1>
      ${mapRefNote}
      <p>Open a wiki folder (top left) to create it here, or add a file by hand under
      <code>wiki/</code> following the schema in <code>wiki/SCHEMA.md</code>.</p>
    `;
    return;
  }

  content.innerHTML = `
    <h1>Create "${title}"</h1>
    ${mapRefNote}
    <label>Type:
      <select id="new-type">${typeOptionsHtml("place")}</select>
    </label>
    <label>Template:
      <select id="new-template"></select>
    </label>
    <button id="delete-template-btn" type="button" hidden>Delete template</button>
    <button id="create-btn" type="button">Create page</button>
  `;

  function refreshTemplateOptions(): void {
    const type = el<HTMLSelectElement>("new-type").value;
    const matching = templatesForType(type);
    el<HTMLSelectElement>("new-template").innerHTML =
      `<option value="">(blank)</option>${matching.map(t => `<option value="${t.name}">${t.name}</option>`).join("")}`;
    el<HTMLButtonElement>("delete-template-btn").hidden = true;
  }
  refreshTemplateOptions();

  el<HTMLSelectElement>("new-type").addEventListener("change", refreshTemplateOptions);
  el<HTMLSelectElement>("new-template").addEventListener("change", event => {
    el<HTMLButtonElement>("delete-template-btn").hidden = !(event.target as HTMLSelectElement).value;
  });
  el<HTMLButtonElement>("delete-template-btn").addEventListener("click", async () => {
    const name = el<HTMLSelectElement>("new-template").value;
    if (name) {
      await deleteTemplate(dirHandle!, name);
      templates = await loadTemplates(dirHandle!);
    }
    refreshTemplateOptions();
  });

  el<HTMLButtonElement>("create-btn").addEventListener("click", async () => {
    const type = el<HTMLSelectElement>("new-type").value;
    const templateName = el<HTMLSelectElement>("new-template").value;
    const templateRaw = templateName ? templates.find(t => t.name === templateName)?.raw : undefined;
    const { slug } = await createEntity(dirHandle!, title, type, mapRef, activeEra ?? DEFAULT_ERA, templateRaw);
    await reloadFromDirectory();
    location.hash = `#/entity/${encodeURIComponent(slug)}`;
  });
}

function renderHomeView(): void {
  el<HTMLElement>("content").innerHTML = `
    <h1>Mapweave Wiki</h1>
    <p>${entities.length} ${entities.length === 1 ? "entity" : "entities"}. Pick one from the sidebar.</p>
    <p>See <code>wiki/SCHEMA.md</code> for the file format.</p>
  `;
}

function visibleEntitiesOfType(type: string): WikiEntity[] {
  return entities.filter(
    entity =>
      entity.frontmatter.type === type &&
      (!activeEra || isEntityInEra(entity, activeEra)) &&
      (viewMode !== "player" || !entity.frontmatter.secret)
  );
}

function entityLink(entity: WikiEntity): string {
  return `<a href="#/entity/${encodeURIComponent(entity.slug)}">${entity.frontmatter.title}</a>`;
}

/** Quests grouped by status, in a fixed reading order (not alphabetical) — unrecognized status
 *  values still show up, grouped under "other" rather than being dropped */
function renderQuestBoardView(): void {
  const quests = visibleEntitiesOfType("quest");
  const groups = new Map<string, WikiEntity[]>();
  for (const quest of quests) {
    const status =
      quest.frontmatter.status && QUEST_STATUSES.includes(quest.frontmatter.status)
        ? quest.frontmatter.status
        : "other";
    const group = groups.get(status) ?? [];
    group.push(quest);
    groups.set(status, group);
  }

  const order = [...QUEST_STATUSES, "other"];
  const sections = order
    .filter(status => groups.has(status))
    .map(status => {
      const items = groups
        .get(status)!
        .map(
          quest =>
            `<li>${entityLink(quest)}${quest.frontmatter.hook ? ` — <span class="muted">${quest.frontmatter.hook}</span>` : ""}</li>`
        )
        .join("");
      return `<div class="entity-group"><h2>${status}</h2><ul>${items}</ul></div>`;
    })
    .join("");

  el<HTMLElement>("content").innerHTML = `
    <h1>Quests</h1>
    ${quests.length ? sections : `<p class="muted">No quests yet — create one via "${entities.length ? "New" : "Open a wiki folder, then New"}".</p>`}
  `;
}

/** Session log, chronological by `number` (entities without one sort last, by title) */
function renderSessionLogView(): void {
  const sessions = visibleEntitiesOfType("session-log").sort((a, b) => {
    const an = a.frontmatter.number;
    const bn = b.frontmatter.number;
    if (an !== undefined && bn !== undefined) return an - bn;
    if (an !== undefined) return -1;
    if (bn !== undefined) return 1;
    return a.frontmatter.title.localeCompare(b.frontmatter.title);
  });

  const items = sessions
    .map(session => {
      const number = session.frontmatter.number !== undefined ? `#${session.frontmatter.number} — ` : "";
      const date = session.frontmatter.date ? ` <span class="muted">(${session.frontmatter.date})</span>` : "";
      const summary = session.frontmatter.summary ? `<p class="summary">${session.frontmatter.summary}</p>` : "";
      return `<li>${number}${entityLink(session)}${date}${summary}</li>`;
    })
    .join("");

  el<HTMLElement>("content").innerHTML = `
    <h1>Session log</h1>
    ${sessions.length ? `<ul class="session-log">${items}</ul>` : `<p class="muted">No sessions logged yet.</p>`}
  `;
}

const OTHER_GROUP = "Other";

/** Chronological event timeline — `type: event` entities sorted by `order` (entities without one
 *  sort last, by title, same repli as renderSessionLogView), then grouped by `group` (see
 *  wiki/SCHEMA.md) for display. Groups are shown in the order each first appears in the sorted
 *  list, not alphabetically, so the sections themselves stay roughly chronological too. Not a real
 *  calendar — `date` is free-form display text, never parsed (see WikiFrontmatter.date). */
function renderTimelineView(): void {
  const events = visibleEntitiesOfType("event").sort((a, b) => {
    const ao = a.frontmatter.order;
    const bo = b.frontmatter.order;
    if (ao !== undefined && bo !== undefined) return ao - bo;
    if (ao !== undefined) return -1;
    if (bo !== undefined) return 1;
    return a.frontmatter.title.localeCompare(b.frontmatter.title);
  });

  const groups = new Map<string, WikiEntity[]>();
  for (const event of events) {
    const group = event.frontmatter.group?.trim() || OTHER_GROUP;
    const list = groups.get(group) ?? [];
    list.push(event);
    groups.set(group, list);
  }

  const sections = [...groups.entries()]
    .map(([group, items]) => {
      const rows = items
        .map(event => {
          const date = event.frontmatter.date ? ` <span class="muted">(${event.frontmatter.date})</span>` : "";
          const summary = event.frontmatter.summary
            ? `<p class="summary">${event.frontmatter.summary}</p>`
            : event.frontmatter.hook
              ? `<p class="hook">${event.frontmatter.hook}</p>`
              : "";
          return `<li>${entityLink(event)}${date}${summary}</li>`;
        })
        .join("");
      return `<div class="entity-group"><h2>${group}</h2><ul class="timeline">${rows}</ul></div>`;
    })
    .join("");

  el<HTMLElement>("content").innerHTML = `
    <h1>Timeline</h1>
    ${events.length ? sections : `<p class="muted">No events yet — create one with type "event".</p>`}
  `;
}

function render(): void {
  teardownBoard();
  const route = currentRoute();

  // choose-world is a landing screen, not a wiki page — picking or creating a world is the whole
  // point of being there, so the wiki's own sidebar (entity list, search, "+ New page", a second
  // world-switcher) is noise around it, not context. #app.landing drops the sidebar column entirely
  // (see wiki.css) rather than just hiding #sidebar, so #content actually gets the freed width back.
  el<HTMLElement>("app").classList.toggle("landing", route.view === "choose-world");
  if (route.view === "choose-world") {
    el<HTMLElement>("map-panel").setAttribute("hidden", "");
    renderChooseWorldView();
    return;
  }

  renderEraSelect();
  renderSidebar(el<HTMLInputElement>("search").value);

  // The map view is a full-screen overlay (#map-panel), not a #content swap — shown only for its
  // own route, hidden for every other one (mirrors teardownBoard()'s "always clean up first").
  if (route.view === "map") {
    void renderMapView(route.newWorld);
    return;
  }
  el<HTMLElement>("map-panel").setAttribute("hidden", "");

  if (route.view === "entity") renderEntityView(route.slug, route.tab);
  else if (route.view === "new") renderNewEntityView(route.title, route.mapRef);
  else if (route.view === "quests") renderQuestBoardView();
  else if (route.view === "sessions") renderSessionLogView();
  else if (route.view === "timeline") renderTimelineView();
  else renderHomeView();
}

interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  type: string;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  kind: EdgeKind;
}

const TYPE_COLORS: Record<string, string> = {
  place: "#4f8ef7",
  character: "#f76e6e",
  faction: "#f7c14f",
  event: "#8a4ff7",
  item: "#4ff7b8",
  era: "#f7f04f",
  quest: "#f78a4f",
  "encounter-table": "#4ff7e0",
  "session-log": "#a5a5f7"
};

function renderGraph(): void {
  const svgEl = el<SVGSVGElement & HTMLElement>("graph-svg");
  const width = svgEl.clientWidth || 800;
  const height = svgEl.clientHeight || 600;
  const svg = select(svgEl);
  svg.selectAll("*").remove();

  const visibleEntities = activeEra ? entities.filter(entity => isEntityInEra(entity, activeEra!)) : entities;
  const visibleSlugs = new Set(visibleEntities.map(entity => entity.slug));

  const nodes: GraphNode[] = visibleEntities.map(entity => ({
    id: entity.slug,
    title: entity.frontmatter.title,
    type: entity.frontmatter.type
  }));
  const links: GraphLink[] = graph.edges
    .filter(edge => visibleSlugs.has(edge.from) && visibleSlugs.has(edge.to))
    .map(edge => ({ source: edge.from, target: edge.to, kind: edge.kind }));

  forceSimulation(nodes)
    .force(
      "link",
      forceLink<GraphNode, GraphLink>(links)
        .id(node => node.id)
        .distance(90)
    )
    .force("charge", forceManyBody().strength(-200))
    .force("center", forceCenter(width / 2, height / 2))
    .on("tick", () => {
      lineSelection
        .attr("x1", link => (link.source as GraphNode).x ?? 0)
        .attr("y1", link => (link.source as GraphNode).y ?? 0)
        .attr("x2", link => (link.target as GraphNode).x ?? 0)
        .attr("y2", link => (link.target as GraphNode).y ?? 0);
      circleSelection.attr("cx", node => node.x ?? 0).attr("cy", node => node.y ?? 0);
      labelSelection.attr("x", node => node.x ?? 0).attr("y", node => node.y ?? 0);
    });

  const lineSelection = svg
    .append("g")
    .attr("stroke", "#666")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke-width", 1);

  const circleSelection = svg
    .append("g")
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("r", 8)
    .attr("fill", node => TYPE_COLORS[node.type] ?? "#999")
    .style("cursor", "pointer")
    .on("click", (_event, node) => {
      location.hash = `#/entity/${encodeURIComponent(node.id)}`;
    });

  const labelSelection = svg
    .append("g")
    .selectAll("text")
    .data(nodes)
    .join("text")
    .text(node => node.title)
    .attr("font-size", 10)
    .attr("dx", 10)
    .attr("dy", 4);
}

function sendToMapEngine(message: PlacementMessage): void {
  wikiToMapBus.dispatchEvent(new CustomEvent(message.type, { detail: message }));
}

/** Shows the full-screen map view and ensures the engine is booted and mounted (see
 *  services/map-engine-host.ts — boots once, reused afterward). Shared by the `#/map` route
 *  (render()) and the "place on map" flow (requestPlacement), which opens the map view directly
 *  without necessarily changing the route, matching its pre-merge behavior.
 *
 * Known gap, deferred on purpose (see MAPWEAVE.md's Phase 6 "Phase 3" entry): doesn't yet pass a
 * DB-connected world's seed/width/height into the engine, so a connected world doesn't auto-load
 * here the way the old iframe's `mapFrameSrc()` made it do — it falls back to whatever the engine
 * itself defaults to (last locally-saved map, or waiting for the user to generate one).
 *
 * `newWorld` is the "create a new world" landing choice (renderChooseWorldView): land on the
 * engine's generation-settings tab instead of the default idle-state "no map yet" prompt. */
async function renderMapView(newWorld?: boolean): Promise<void> {
  el<HTMLElement>("map-panel").removeAttribute("hidden");
  // Dynamic, not static, import: map-engine-host.ts bundles map.html's raw markup (see its `?raw`
  // import) — a static import here would pull that into the wiki's own eager entry chunk, shipping
  // it to every visitor whether or not they ever open the map. Confirmed by actually building both
  // ways: the wiki chunk was ~40KB with a dynamic import, 838KB with a static one.
  const { mountMapEngine, openGenerationSettings } = await import("@/services/map-engine-host");
  await mountMapEngine(el<HTMLElement>("map-panel-mount"));
  if (newWorld) await openGenerationSettings();
}

/** A page's "map" tab (Phase 6 "Phase 5" — cross-tab integration, see MAPWEAVE.md): embeds the same
 *  live map-engine singleton `renderMapView` uses, inline in the tab's own content area instead of
 *  the full-screen overlay — resolves the "full inline map embedding lands in Phase 3" placeholder
 *  Phase 2 left behind, now that Phase 3 actually built mountMapEngine() to accept any container.
 *
 *  Same known gap as renderMapView, doubly relevant here: a tab's own `mapId` isn't used to load
 *  that specific database world into the engine (still needs the deferred seed/width/height wiring)
 *  — this always shows whichever world the engine currently has loaded, with a mismatch notice in
 *  the template above when that differs from the tab's declared `mapId`. */
async function mountMapTabView(): Promise<void> {
  const mount = el<HTMLElement>("map-tab-mount");
  if (!mount) return; // the user navigated away before this resolved — nothing to mount into
  const { mountMapEngine } = await import("@/services/map-engine-host");
  await mountMapEngine(mount);
}

function cancelPendingPlacement(): void {
  if (!pendingPlacement) return;
  sendToMapEngine({ type: PLACEMENT_CANCEL, requestId: pendingPlacement.requestId });
  pendingPlacement = undefined;
}

async function requestPlacement(slug: string, kind: PlacementKind): Promise<void> {
  const entity = byslug(slug);
  if (!entity || !canPlaceOnMap(entity)) return;

  const requestId = crypto.randomUUID();
  pendingPlacement = { requestId, slug, era: activeEra ?? DEFAULT_ERA, kind };
  renderEntityView(slug);
  await renderMapView();
  sendToMapEngine({ type: PLACEMENT_REQUEST, requestId, kind });
}

/** The map reports either a completed placement (write map_ref, close the panel) or a cancel
 *  (Escape / toggled off on the map side — leave the panel open so the user can just try again). */
async function handlePlacementMessage(message: PlacementMessage): Promise<void> {
  if (!pendingPlacement || message.requestId !== pendingPlacement.requestId) return;

  const { slug, era } = pendingPlacement;
  pendingPlacement = undefined;

  if (message.type === PLACEMENT_RESULT) {
    const handle = handles.get(slug);
    const raw = rawContents.get(slug);
    if (handle && raw !== undefined) {
      const mapRef: MapRef = { kind: message.kind, id: message.id, name: message.name, cell: message.cell };
      await saveEntity(handle, insertMapRefBlock(raw, era, mapRef));
      await reloadFromDirectory();
    }
    el<HTMLElement>("map-panel").setAttribute("hidden", "");
  }

  renderEntityView(slug);
}

function updateViewModeButton(): void {
  const button = el<HTMLButtonElement>("view-mode-btn");
  button.textContent = viewMode === "gm" ? "GM view" : "Player view";
  button.classList.toggle("player-view-active", viewMode === "player");
}

function initToolbar(): void {
  updateViewModeButton();
  el<HTMLButtonElement>("view-mode-btn").addEventListener("click", () => {
    viewMode = viewMode === "gm" ? "player" : "gm";
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    updateViewModeButton();
    render();
  });

  el<HTMLInputElement>("search").addEventListener(
    "input",
    debounceTrailing(event => {
      renderSidebar((event.target as HTMLInputElement).value);
    }, 150)
  );

  el<HTMLButtonElement>("new-page-btn").addEventListener("click", () => {
    const title = window.prompt("Title for the new page:");
    if (title?.trim()) location.hash = `#/new?title=${encodeURIComponent(title.trim())}`;
  });

  el<HTMLSelectElement>("era-select").addEventListener("change", event => {
    activeEra = (event.target as HTMLSelectElement).value || undefined;
    renderSidebar(el<HTMLInputElement>("search").value);
    render();
  });

  const openFolderBtn = el<HTMLButtonElement>("open-folder-btn");
  if (!isFileSystemAccessSupported()) {
    openFolderBtn.disabled = true;
    openFolderBtn.title = "Only supported in Chromium-based browsers";
  }
  openFolderBtn.addEventListener("click", async () => {
    const dir = await pickWikiDirectory();
    if (!dir) return;
    dirHandle = dir;
    await reloadFromDirectory();
    el<HTMLElement>("live-indicator").textContent = `Editing: ${dir.name}/`;
    render();
  });

  el<HTMLButtonElement>("world-switcher-btn").addEventListener("click", () => void toggleWorldMenu());
  document.addEventListener("click", event => {
    const menu = el<HTMLElement>("world-menu");
    const switcher = el<HTMLElement>("world-switcher");
    if (!menu.hasAttribute("hidden") && !switcher.contains(event.target as Node)) menu.setAttribute("hidden", "");
  });

  el<HTMLButtonElement>("toggle-graph-btn").addEventListener("click", () => {
    const panel = el<HTMLElement>("graph-panel");
    if (panel.hasAttribute("hidden")) {
      panel.removeAttribute("hidden");
      renderGraph();
    } else {
      panel.setAttribute("hidden", "");
    }
  });

  el<HTMLElement>("graph-panel").addEventListener("click", event => {
    if (event.target === el<HTMLElement>("graph-panel")) el<HTMLElement>("graph-panel").setAttribute("hidden", "");
  });

  el<HTMLButtonElement>("toggle-map-btn").addEventListener("click", () => {
    location.hash = "map";
  });
  el<HTMLButtonElement>("map-panel-close").addEventListener("click", () => {
    if (pendingPlacement) {
      const slug = pendingPlacement.slug;
      cancelPendingPlacement();
      el<HTMLElement>("map-panel").setAttribute("hidden", "");
      renderEntityView(slug);
      return;
    }
    // On the #/map route: navigate back, which hides the panel via render()'s own route-based
    // show/hide. Opened directly by the placement flow instead (hash untouched): just hide it.
    if (currentRoute().view === "map") location.hash = "";
    else el<HTMLElement>("map-panel").setAttribute("hidden", "");
  });
}

window.addEventListener("hashchange", () => {
  cancelPendingPlacement();
  render();
});
mapToWikiBus.addEventListener(PLACEMENT_RESULT, event => {
  void handlePlacementMessage((event as CustomEvent<PlacementMessage>).detail);
});
mapToWikiBus.addEventListener(PLACEMENT_CANCEL, event => {
  void handlePlacementMessage((event as CustomEvent<PlacementMessage>).detail);
});
initToolbar();
render();
void connectToPersistedWorld();
