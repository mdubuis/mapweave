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
import { buildGraph } from "@/wiki/graph";
import { renderMarkdown } from "@/wiki/markdown";
import type { EdgeKind, WikiEntity, WikiGraph } from "@/wiki/types";

let entities: WikiEntity[] = loadEntities();
let graph: WikiGraph = buildGraph(entities);
let slugIndex = buildSlugIndex(entities);
let handles = new Map<string, FileSystemFileHandle>();
let rawContents = new Map<string, string>();
let dirHandle: FileSystemDirectoryHandle | undefined;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const byslug = (slug: string) => entities.find(e => e.slug === slug);
const resolveLink = (target: string) => resolveTarget(slugIndex, target);

type Route = { view: "list" } | { view: "entity"; slug: string } | { view: "new"; title: string };

function currentRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("entity/")) return { view: "entity", slug: decodeURIComponent(hash.slice("entity/".length)) };
  if (hash.startsWith("new")) {
    const params = new URLSearchParams(hash.split("?")[1] ?? "");
    return { view: "new", title: params.get("title") ?? "" };
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
  renderSidebar(el<HTMLInputElement>("search").value);
}

function renderSidebar(filter = ""): void {
  const list = el<HTMLElement>("entity-list");
  const grouped = new Map<string, WikiEntity[]>();
  const needle = filter.toLowerCase();

  for (const entity of entities) {
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

function renderRelations(entity: WikiEntity): string {
  const relations = Object.entries(entity.frontmatter.relations ?? {});
  if (!relations.length) return "";

  const items = relations
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

function renderEntityView(slug: string): void {
  const content = el<HTMLElement>("content");
  const entity = byslug(slug);
  if (!entity) {
    content.innerHTML = `<p>No such page: <code>${slug}</code></p>`;
    return;
  }

  const mapRef = entity.frontmatter.map_ref;
  const mapRefBadge = mapRef
    ? `<span class="map-ref-badge">map: ${mapRef.kind} #${mapRef.id} (${mapRef.name})</span>`
    : "";
  const tags = (entity.frontmatter.tags ?? []).map(tag => `<span class="tag">${tag}</span>`).join(" ");
  const canEdit = dirHandle && handles.has(slug);

  content.innerHTML = `
    <header class="entity-header">
      <h1>${entity.frontmatter.title}</h1>
      <div class="entity-meta">
        <span class="type-badge">${entity.frontmatter.type}</span>
        ${mapRefBadge}
        ${tags}
      </div>
      ${entity.frontmatter.summary ? `<p class="summary">${entity.frontmatter.summary}</p>` : ""}
      ${canEdit ? `<button id="edit-btn" type="button">Edit</button>` : ""}
    </header>
    ${renderRelations(entity)}
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

function renderNewEntityView(title: string): void {
  const content = el<HTMLElement>("content");

  if (!dirHandle) {
    content.innerHTML = `
      <h1>“${title}” doesn't have a page yet</h1>
      <p>Open a wiki folder (top left) to create it here, or add a file by hand under
      <code>wiki/</code> following the schema in <code>wiki/SCHEMA.md</code>.</p>
    `;
    return;
  }

  content.innerHTML = `
    <h1>Create "${title}"</h1>
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
    const { slug } = await createEntity(dirHandle!, title, type);
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
  if (route.view === "entity") renderEntityView(route.slug);
  else if (route.view === "new") renderNewEntityView(route.title);
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
  item: "#4ff7b8"
};

function renderGraph(): void {
  const svgEl = el<SVGSVGElement & HTMLElement>("graph-svg");
  const width = svgEl.clientWidth || 800;
  const height = svgEl.clientHeight || 600;
  const svg = select(svgEl);
  svg.selectAll("*").remove();

  const nodes: GraphNode[] = entities.map(entity => ({
    id: entity.slug,
    title: entity.frontmatter.title,
    type: entity.frontmatter.type
  }));
  const links: GraphLink[] = graph.edges.map(edge => ({ source: edge.from, target: edge.to, kind: edge.kind }));

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
renderSidebar();
render();
