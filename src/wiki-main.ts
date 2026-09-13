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
  createEntity,
  isFileSystemAccessSupported,
  loadFromDirectory,
  pickWikiDirectory,
  saveEntity
} from "@/wiki/editor";
import { buildSlugIndex, loadEntities, resolveTarget } from "@/wiki/entities";
import { type Era, isEntityInEra, loadEras, resolveEntityForEra } from "@/wiki/eras";
import { buildGraph } from "@/wiki/graph";
import { renderMarkdown } from "@/wiki/markdown";
import {
  DEFAULT_ERA,
  type EdgeKind,
  type MapRef,
  type MapRefKind,
  type WikiEntity,
  type WikiGraph
} from "@/wiki/types";

let entities: WikiEntity[] = loadEntities();
let graph: WikiGraph = buildGraph(entities);
let slugIndex = buildSlugIndex(entities);
let eras: Era[] = loadEras(entities);
let handles = new Map<string, FileSystemFileHandle>();
let rawContents = new Map<string, string>();
let dirHandle: FileSystemDirectoryHandle | undefined;

/** Sticky UI state, not solely URL-derived: browsing via wikilinks shouldn't reset the chosen era */
let activeEra: string | undefined = new URL(location.href).searchParams.get("era") ?? undefined;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const byslug = (slug: string) => entities.find(e => e.slug === slug);
const resolveLink = (target: string) => resolveTarget(slugIndex, target);

const MAP_REF_KINDS: MapRefKind[] = ["burg", "state", "province", "religion", "culture", "marker", "river"];

type Route = { view: "list" } | { view: "entity"; slug: string } | { view: "new"; title: string; mapRef?: MapRef };

function currentRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("entity/")) return { view: "entity", slug: decodeURIComponent(hash.slice("entity/".length)) };
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
  entities = source.entities;
  handles = source.handles;
  rawContents = source.raw;
  graph = buildGraph(entities);
  slugIndex = buildSlugIndex(entities);
  eras = loadEras(entities);
  renderEraSelect();
  renderSidebar(el<HTMLInputElement>("search").value);
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

  for (const entity of entities) {
    if (activeEra && !isEntityInEra(entity, activeEra)) continue;
    const haystack = `${entity.frontmatter.title} ${(entity.frontmatter.tags ?? []).join(" ")}`.toLowerCase();
    if (needle && !haystack.includes(needle)) continue;
    const group = grouped.get(entity.frontmatter.type) ?? [];
    group.push(entity);
    grouped.set(entity.frontmatter.type, group);
  }

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

/** FMG's `?burg=<id>` / `?cell=<id>` URL params already focus the map — see docs/wiki/URL-parameters.md */
function mapViewHref(mapRef: MapRef | undefined): string | undefined {
  if (!mapRef) return undefined;
  if (mapRef.kind === "burg") return `./index.html?burg=${mapRef.id}&scale=8`;
  if (mapRef.cell !== undefined) return `./index.html?cell=${mapRef.cell}&scale=8`;
  return undefined;
}

function renderEntityView(slug: string): void {
  const content = el<HTMLElement>("content");
  const entity = byslug(slug);
  if (!entity) {
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

  content.innerHTML = `
    <header class="entity-header">
      <h1>${frontmatter.title}</h1>
      <div class="entity-meta">
        <span class="type-badge">${frontmatter.type}</span>
        ${mapRefBadge}
        ${tags}
      </div>
      ${frontmatter.summary ? `<p class="summary">${frontmatter.summary}</p>` : ""}
      <div class="entity-actions">
        ${mapHref ? `<a href="${mapHref}" target="_blank" rel="noopener">View on map ↗</a>` : ""}
        ${canEdit ? `<button id="edit-btn" type="button">Edit</button>` : ""}
      </div>
    </header>
    ${renderRelations(frontmatter.relations)}
    <article class="entity-body">${renderMarkdown(entity.body, resolveLink)}</article>
  `;

  el<HTMLButtonElement>("edit-btn")?.addEventListener("click", () => renderEditorView(slug));
}

function escapeForTextarea(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
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
    <header class="entity-header"><h1>Editing: ${entity.frontmatter.title}</h1></header>
    <textarea id="editor-textarea" spellcheck="false">${escapeForTextarea(raw)}</textarea>
    <div class="editor-actions">
      <button id="save-btn" type="button">Save</button>
      <button id="cancel-btn" type="button">Cancel</button>
    </div>
  `;

  el<HTMLButtonElement>("cancel-btn").addEventListener("click", () => renderEntityView(slug));
  el<HTMLButtonElement>("save-btn").addEventListener("click", async () => {
    await saveEntity(handle, el<HTMLTextAreaElement>("editor-textarea").value);
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
      <select id="new-type">
        <option value="place">place</option>
        <option value="character">character</option>
        <option value="faction">faction</option>
        <option value="event">event</option>
        <option value="item">item</option>
      </select>
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

function render(): void {
  const route = currentRoute();
  renderEraSelect();
  renderSidebar(el<HTMLInputElement>("search").value);
  if (route.view === "entity") renderEntityView(route.slug);
  else if (route.view === "new") renderNewEntityView(route.title, route.mapRef);
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
  era: "#f7f04f"
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

function initToolbar(): void {
  el<HTMLInputElement>("search").addEventListener("input", event => {
    renderSidebar((event.target as HTMLInputElement).value);
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
}

window.addEventListener("hashchange", render);
initToolbar();
render();
