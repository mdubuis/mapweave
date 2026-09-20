import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  select
} from "d3";
import {
  type ConnectedMapInfo,
  dbRefOf,
  fetchAvailableMaps,
  fetchConnectedMapInfo,
  loadGeneratedEntities,
  type MapSummary
} from "@/wiki/db-entities";
import {
  createEntity,
  isFileSystemAccessSupported,
  loadFromDirectory,
  pickWikiDirectory,
  saveEntity
} from "@/wiki/editor";
import { type AutoLinkName, buildAutoLinkNames, buildSlugIndex, loadEntities, resolveTarget } from "@/wiki/entities";
import { type Era, isEntityInEra, loadEras, resolveEntityForEra } from "@/wiki/eras";
import { parseFrontmatter } from "@/wiki/frontmatter";
import { patchFrontmatterType } from "@/wiki/frontmatter-patch";
import { buildGraph } from "@/wiki/graph";
import {
  PLACEMENT_CANCEL,
  PLACEMENT_REQUEST,
  PLACEMENT_RESULT,
  type PlacementKind,
  type PlacementMessage
} from "@/wiki/map-bridge";
import { insertMapRefBlock } from "@/wiki/map-ref-patch";
import { renderMarkdown } from "@/wiki/markdown";
import { parseObjective, parseWeightedEntry, rollEncounter } from "@/wiki/scenario";
import { hasSecretContent, stripSecrets } from "@/wiki/secrets";
import {
  DEFAULT_ERA,
  type EdgeKind,
  type MapRef,
  type MapRefKind,
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
let mapFrameLoaded = false;
/** connectedMap.id the iframe was last loaded with (undefined = loaded with no DB map) — lets
 *  openMapPanel notice the connected map changed and reload, see mapFrameSrc. */
let mapFrameKey: number | undefined;
/** The DB-connected map's identity for the map panel — see loadDatabaseEntities/openMapPanel. */
let connectedMap: ConnectedMapInfo | undefined;
/** Cached result of the last fetchAvailableMaps() call — the world switcher and the "choose a
 *  world" view both need the full list; refetched whenever either is opened, not on every render. */
let availableWorlds: MapSummary[] = [];

const WORLD_STORAGE_KEY = "mapweave.lastMapId";
/** "Place on map" request in flight — see requestPlacement/the message listener in initToolbar().
 *  Only one at a time; the UI doesn't offer a second "Place on map" click while this is set. */
let pendingPlacement: { requestId: string; slug: string; era: string; kind: PlacementKind } | undefined;

const API_BASE = "http://127.0.0.1:3001";

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

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const byslug = (slug: string) => entities.find(e => e.slug === slug);
const resolveLink = (target: string) => resolveTarget(slugIndex, target);

const MAP_REF_KINDS: MapRefKind[] = ["burg", "state", "province", "religion", "culture", "marker", "river"];

const ENTITY_TYPES = ["place", "character", "faction", "event", "item", "quest", "encounter-table", "session-log"];

/** Current type first if it's not one of the standard ones (e.g. "era"), so the select never
 *  silently swaps a page to a different type just by opening the editor. */
function typeOptionsHtml(selected: string): string {
  const types = ENTITY_TYPES.includes(selected) ? ENTITY_TYPES : [selected, ...ENTITY_TYPES];
  return types.map(type => `<option value="${type}"${type === selected ? " selected" : ""}>${type}</option>`).join("");
}

type Route =
  | { view: "list" }
  | { view: "entity"; slug: string }
  | { view: "new"; title: string; mapRef?: MapRef }
  | { view: "quests" }
  | { view: "sessions" }
  | { view: "choose-world" };

function currentRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("entity/")) return { view: "entity", slug: decodeURIComponent(hash.slice("entity/".length)) };
  if (hash.startsWith("quests")) return { view: "quests" };
  if (hash.startsWith("sessions")) return { view: "sessions" };
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
  const source = await loadFromDirectory(dirHandle);
  fileEntities = source.entities;
  handles = source.handles;
  rawContents = source.raw;
  mergeEntitySources();
  renderEraSelect();
  renderSidebar(el<HTMLInputElement>("search").value);
}

async function loadDatabaseEntities(mapId: number): Promise<void> {
  const [entities, mapInfo] = await Promise.all([
    loadGeneratedEntities(API_BASE, mapId),
    fetchConnectedMapInfo(API_BASE, mapId)
  ]);
  dbEntities = entities;
  connectedMap = mapInfo;
  mergeEntitySources();
  localStorage.setItem(WORLD_STORAGE_KEY, String(mapId));
  updateWorldSwitcherLabel();
  renderEraSelect();
  renderSidebar(el<HTMLInputElement>("search").value);
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
 * way the old auto-connect did. No persisted world, or it no longer exists: sends a first-time
 * visitor (still on the plain landing route) to #/choose-world; leaves a direct deep link (e.g. a
 * bookmarked entity page) alone rather than yanking it away. Silent on any network failure — the
 * wiki must stay fully usable on file entities alone either way.
 */
async function connectToPersistedWorld(): Promise<void> {
  const persistedId = Number(localStorage.getItem(WORLD_STORAGE_KEY)) || undefined;
  try {
    availableWorlds = await fetchAvailableMaps(API_BASE);
    const match = persistedId && availableWorlds.find(map => map.id === persistedId);
    if (match) {
      await loadDatabaseEntities(match.id);
    } else if (currentRoute().view === "list") {
      location.hash = "#/choose-world";
      return;
    }
  } catch {
    // offline: file entities alone still work, same as before this existed
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

function renderChooseWorldView(): void {
  const content = el<HTMLElement>("content");
  content.innerHTML = `<h1>Choose a world</h1><p>Loading worlds…</p>`;

  fetchAvailableMaps(API_BASE)
    .then((maps: MapSummary[]) => {
      availableWorlds = maps;
      content.innerHTML = `<h1>Choose a world</h1>${renderWorldPicker(maps)}`;
      content.querySelectorAll<HTMLButtonElement>(".world-list-item").forEach(button => {
        button.addEventListener("click", async () => {
          await loadDatabaseEntities(Number(button.dataset.mapId));
          location.hash = "#/";
        });
      });
    })
    .catch((error: Error) => {
      content.innerHTML = `
        <h1>Choose a world</h1>
        <p class="wiki-link-broken">Could not reach the API at ${API_BASE} — is the server running?
        (<code>cd server && npm run start</code>)</p>
        <p class="summary">${error.message}</p>
      `;
    });
  renderSidebar(el<HTMLInputElement>("search").value);
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

function renderSidebar(filter = ""): void {
  const list = el<HTMLElement>("entity-list");
  const grouped = new Map<string, WikiEntity[]>();
  const needle = filter.toLowerCase();
  let matchCount = 0;

  for (const entity of entities) {
    if (activeEra && !isEntityInEra(entity, activeEra)) continue;
    if (viewMode === "player" && entity.frontmatter.secret) continue;
    const haystack = `${entity.frontmatter.title} ${(entity.frontmatter.tags ?? []).join(" ")}`.toLowerCase();
    if (needle && !haystack.includes(needle)) continue;
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

    const ul = document.createElement("ul");
    for (const item of items) {
      const brokenCount = graph.brokenLinks.get(item.slug)?.length ?? 0;
      const li = document.createElement("li");
      li.innerHTML = `<a href="#/entity/${encodeURIComponent(item.slug)}">${item.frontmatter.title}</a>${
        brokenCount ? ` <span class="badge-broken" title="${brokenCount} unresolved link(s)">${brokenCount}</span>` : ""
      }`;
      ul.appendChild(li);
    }
    section.appendChild(ul);
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

/** FMG's `?burg=<id>` / `?cell=<id>` URL params already focus the map — see docs/wiki/URL-parameters.md */
function mapViewHref(mapRef: MapRef | undefined): string | undefined {
  if (!mapRef) return undefined;
  if (mapRef.kind === "burg") return `./map.html?burg=${mapRef.id}&scale=8`;
  if (mapRef.cell !== undefined) return `./map.html?cell=${mapRef.cell}&scale=8`;
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

function renderEntityView(slug: string): void {
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

  const isEncounterTable = frontmatter.type === "encounter-table" && (frontmatter.table?.length ?? 0) > 0;
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
        ${mapHref ? `<a href="${mapHref}" target="_blank" rel="noopener">View on map ↗</a>` : ""}
        ${canEdit ? `<button id="edit-btn" type="button">Edit</button>` : ""}
        ${dbRef ? `<a href="#/new?title=${encodeURIComponent(frontmatter.title)}">Write a lore page for this ↗</a>` : ""}
      </div>
    </header>
    ${placeOnMapHtml}
    ${renderObjectives(frontmatter.objectives)}
    ${frontmatter.resolution ? `<section class="resolution"><h3>Resolution</h3><p>${frontmatter.resolution}</p></section>` : ""}
    ${renderStatsBlock(frontmatter.stats, frontmatter.statBlockSystem)}
    ${isEncounterTable ? `<section id="encounter-roller"></section>` : ""}
    ${renderRelations(frontmatter.relations)}
    <article class="entity-body">${renderMarkdown(body, resolveLink, autoLinkNames)}</article>
  `;

  el<HTMLButtonElement>("edit-btn")?.addEventListener("click", () => renderEditorView(slug));
  if (isEncounterTable) mountEncounterRoller(el<HTMLElement>("encounter-roller"), frontmatter.table!);

  el<HTMLButtonElement>("place-on-map-btn")?.addEventListener("click", () => {
    const kind = el<HTMLSelectElement>("place-kind").value as PlacementKind;
    void requestPlacement(slug, kind);
  });
  el<HTMLButtonElement>("place-cancel-btn")?.addEventListener("click", () => {
    cancelPendingPlacement();
    renderEntityView(slug);
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
    <div id="editor-split">
      <textarea id="editor-textarea" spellcheck="false">${escapeForTextarea(raw)}</textarea>
      <article id="editor-preview" class="entity-body"></article>
    </div>
    <div class="editor-actions">
      <button id="save-btn" type="button">Save</button>
      <button id="cancel-btn" type="button">Cancel</button>
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
    <button id="create-btn" type="button">Create page</button>
  `;

  el<HTMLButtonElement>("create-btn").addEventListener("click", async () => {
    const type = el<HTMLSelectElement>("new-type").value;
    const { slug } = await createEntity(dirHandle!, title, type, mapRef, activeEra ?? DEFAULT_ERA);
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
    entity => entity.frontmatter.type === type && (!activeEra || isEntityInEra(entity, activeEra))
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

function render(): void {
  const route = currentRoute();
  renderEraSelect();
  renderSidebar(el<HTMLInputElement>("search").value);
  if (route.view === "entity") renderEntityView(route.slug);
  else if (route.view === "new") renderNewEntityView(route.title, route.mapRef);
  else if (route.view === "quests") renderQuestBoardView();
  else if (route.view === "sessions") renderSessionLogView();
  else if (route.view === "choose-world") renderChooseWorldView();
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

function sendToMapFrame(message: PlacementMessage): void {
  el<HTMLIFrameElement>("map-panel-frame").contentWindow?.postMessage(message, location.origin);
}

/** `?seed=&width=&height=` for the currently connected map, so map.html regenerates the same map
 *  instead of whatever it would otherwise default to (last locally-saved map, or a fresh random
 *  one). Approximate, not exact: only reproduces the connected map if it was never hand-edited
 *  after generation — see fetchConnectedMapInfo's doc comment. No connected map: plain "./map.html",
 *  same as before this existed. */
function mapFrameSrc(): string {
  if (!connectedMap) return "./map.html";
  const params = new URLSearchParams({ seed: connectedMap.seed });
  if (connectedMap.width) params.set("width", String(connectedMap.width));
  if (connectedMap.height) params.set("height", String(connectedMap.height));
  return `./map.html?${params.toString()}`;
}

/** Opens the map panel, loading map.html into the iframe on first use, or reloading it if the
 *  connected map has changed since it was last loaded. `onReady` runs once the frame is actually
 *  able to receive postMessage calls — immediately if it's already loaded and current. */
function openMapPanel(onReady?: () => void): void {
  const mapFrame = el<HTMLIFrameElement>("map-panel-frame");
  const key = connectedMap?.id;
  if (!mapFrameLoaded || key !== mapFrameKey) {
    mapFrameLoaded = true;
    mapFrameKey = key;
    if (onReady) mapFrame.addEventListener("load", onReady, { once: true });
    mapFrame.src = mapFrameSrc();
  } else if (onReady) {
    onReady();
  }
  el<HTMLElement>("map-panel").removeAttribute("hidden");
}

function cancelPendingPlacement(): void {
  if (!pendingPlacement) return;
  sendToMapFrame({ type: PLACEMENT_CANCEL, requestId: pendingPlacement.requestId });
  pendingPlacement = undefined;
}

async function requestPlacement(slug: string, kind: PlacementKind): Promise<void> {
  const entity = byslug(slug);
  if (!entity || !canPlaceOnMap(entity)) return;

  const requestId = crypto.randomUUID();
  pendingPlacement = { requestId, slug, era: activeEra ?? DEFAULT_ERA, kind };
  renderEntityView(slug);
  openMapPanel(() => sendToMapFrame({ type: PLACEMENT_REQUEST, requestId, kind }));
}

/** The map reports either a completed placement (write map_ref, close the panel) or a cancel
 *  (Escape / toggled off on the map side — leave the panel open so the user can just try again). */
async function handlePlacementMessage(event: MessageEvent): Promise<void> {
  if (event.origin !== location.origin) return;
  if (event.source !== el<HTMLIFrameElement>("map-panel-frame").contentWindow) return;
  const data = event.data as PlacementMessage;
  if (!pendingPlacement || data?.requestId !== pendingPlacement.requestId) return;

  const { slug, era } = pendingPlacement;
  pendingPlacement = undefined;

  if (data.type === PLACEMENT_RESULT) {
    const handle = handles.get(slug);
    const raw = rawContents.get(slug);
    if (handle && raw !== undefined) {
      const mapRef: MapRef = { kind: data.kind, id: data.id, name: data.name, cell: data.cell };
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

  el<HTMLInputElement>("search").addEventListener("input", event => {
    renderSidebar((event.target as HTMLInputElement).value);
  });

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

  el<HTMLButtonElement>("toggle-map-btn").addEventListener("click", () => openMapPanel());
  el<HTMLButtonElement>("map-panel-close").addEventListener("click", () => {
    el<HTMLElement>("map-panel").setAttribute("hidden", "");
    if (pendingPlacement) {
      const slug = pendingPlacement.slug;
      cancelPendingPlacement();
      renderEntityView(slug);
    }
  });
}

window.addEventListener("hashchange", () => {
  cancelPendingPlacement();
  render();
});
window.addEventListener("message", event => void handlePlacementMessage(event));
initToolbar();
render();
void connectToPersistedWorld();
