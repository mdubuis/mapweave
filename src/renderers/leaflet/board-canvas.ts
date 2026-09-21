// A second, independent Leaflet.CRS.Simple instance for `type: board` pages — a blank infinite
// pan/zoom canvas, not tied to the world map's singleton (components/leaflet-map.ts). Reuses that
// module's LinearSimpleCRS (same y-down, 1:1-scale convention) but owns its own L.Map so a board
// can be opened while the world map iframe is elsewhere/absent. Item drag/positioning mirrors
// marker-layer.ts's divIcon approach; resize is per-item (not zoom-driven) via a corner handle.
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LinearSimpleCRS } from "@/components/leaflet-map";
import { escapeHtml } from "@/utils/stringUtils";
import type { BoardConnector, BoardData, BoardItem } from "@/wiki/board";

export interface PageCardInfo {
  title: string;
  href: string;
}

export interface BoardCallbacks {
  /** Resolves a "page" item's slug to what to show on its card; undefined for a broken/unknown slug */
  resolvePage(slug: string): PageCardInfo | undefined;
  /** Fires after any change to items/connectors (drag, resize, add, delete, connect, edit text) */
  onChange(data: BoardData): void;
  /** Whether cards can be dragged/resized/edited/deleted at all — false for a board with no file
   *  handle to save back to (mirrors the rest of the app's canEdit gate) */
  editable: boolean;
}

export interface BoardHandle {
  addImage(dataUri: string): void;
  addText(text: string): void;
  addPage(slug: string): void;
  /** Arms "click two cards to connect them"; auto-disarms after the second click */
  startConnectMode(): void;
  cancelConnectMode(): void;
  deleteSelected(): void;
  hasSelection(): boolean;
  destroy(): void;
}

const MIN_SIZE = 60;

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function cardHtml(item: BoardItem, page: PageCardInfo | undefined): string {
  const inner =
    item.kind === "image"
      ? `<img src="${item.content}" alt="" draggable="false" />`
      : item.kind === "page"
        ? `<a href="${page?.href ?? "#"}" class="board-card-page-link">${escapeHtml(page?.title ?? "(missing page)")}</a>`
        : `<div class="board-card-text-content">${escapeHtml(item.content)}</div>`;
  return `<div class="board-card board-card-${item.kind}">${inner}<div class="board-resize-handle" title="Resize"></div></div>`;
}

function buildIcon(item: BoardItem, page: PageCardInfo | undefined): L.DivIcon {
  return L.divIcon({
    html: cardHtml(item, page),
    className: "board-card-icon",
    iconSize: [item.width, item.height],
    iconAnchor: [0, 0]
  });
}

export function mountBoard(container: HTMLElement, initial: BoardData, callbacks: BoardCallbacks): BoardHandle {
  const items = new Map<string, BoardItem>();
  const connectors = new Map<string, BoardConnector>();
  const itemMarkers = new Map<string, L.Marker>();
  const connectorLines = new Map<string, L.Polyline>();
  let selectedItemId: string | undefined;
  let selectedConnectorId: string | undefined;
  let connectModeFirstClick: string | undefined;
  let connecting = false;

  const map = L.map(container, {
    crs: LinearSimpleCRS,
    zoomSnap: 0,
    zoomDelta: 1,
    inertia: false,
    attributionControl: false,
    zoomControl: true,
    minZoom: 0.25,
    maxZoom: 8
  });
  map.setView(L.latLng(0, 0), 1, { animate: false });

  const layer = L.layerGroup().addTo(map);
  const lineLayer = L.layerGroup().addTo(map);

  function centerOf(item: BoardItem): [number, number] {
    return [item.y + item.height / 2, item.x + item.width / 2];
  }

  function refreshConnectorsFor(itemId: string): void {
    for (const connector of connectors.values()) {
      if (connector.from !== itemId && connector.to !== itemId) continue;
      const line = connectorLines.get(connector.id);
      const from = items.get(connector.from);
      const to = items.get(connector.to);
      if (!line || !from || !to) continue;
      line.setLatLngs([centerOf(from), centerOf(to)]);
    }
  }

  function emitChange(): void {
    callbacks.onChange({ items: Array.from(items.values()), connectors: Array.from(connectors.values()) });
  }

  function applySelectionStyles(): void {
    for (const [id, marker] of itemMarkers) {
      marker
        .getElement()
        ?.querySelector(".board-card")
        ?.classList.toggle("board-card-selected", id === selectedItemId);
    }
    for (const [id, line] of connectorLines) {
      line.setStyle({
        color: id === selectedConnectorId ? "#4f8ef7" : "#888",
        weight: id === selectedConnectorId ? 3 : 2
      });
    }
  }

  function selectItem(id: string | undefined): void {
    selectedItemId = id;
    selectedConnectorId = undefined;
    applySelectionStyles();
  }

  function selectConnector(id: string | undefined): void {
    selectedConnectorId = id;
    selectedItemId = undefined;
    applySelectionStyles();
  }

  function wireResize(item: BoardItem, marker: L.Marker): void {
    marker.on("add", () => {
      const handle = marker.getElement()?.querySelector<HTMLElement>(".board-resize-handle");
      if (!handle) return;
      handle.addEventListener("pointerdown", event => {
        event.stopPropagation();
        event.preventDefault();
        map.dragging.disable();
        const startX = event.clientX;
        const startY = event.clientY;
        const startWidth = item.width;
        const startHeight = item.height;
        const zoom = map.getZoom();

        function onMove(moveEvent: PointerEvent): void {
          const dx = (moveEvent.clientX - startX) / zoom;
          const dy = (moveEvent.clientY - startY) / zoom;
          item.width = Math.max(MIN_SIZE, Math.round(startWidth + dx));
          item.height = Math.max(MIN_SIZE, Math.round(startHeight + dy));
          marker.setIcon(buildIcon(item, item.kind === "page" ? callbacks.resolvePage(item.content) : undefined));
          refreshConnectorsFor(item.id);
        }
        function onUp(): void {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          map.dragging.enable();
          emitChange();
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
    });
  }

  function addMarkerFor(item: BoardItem): void {
    items.set(item.id, item);
    const page = item.kind === "page" ? callbacks.resolvePage(item.content) : undefined;
    const marker = L.marker(centerOf(item), {
      icon: buildIcon(item, page),
      draggable: callbacks.editable
    });
    marker.on("drag", () => {
      const latlng = marker.getLatLng();
      item.x = Math.round(latlng.lng - item.width / 2);
      item.y = Math.round(latlng.lat - item.height / 2);
      refreshConnectorsFor(item.id);
    });
    marker.on("dragend", () => emitChange());
    marker.on("click", (event: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(event);
      if (!callbacks.editable) return;
      if (connecting) {
        if (!connectModeFirstClick) {
          connectModeFirstClick = item.id;
        } else if (connectModeFirstClick !== item.id) {
          addConnector(connectModeFirstClick, item.id);
          connecting = false;
          connectModeFirstClick = undefined;
        }
        return;
      }
      selectItem(item.id);
    });
    if (item.kind === "text" && callbacks.editable) {
      marker.on("dblclick", (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event);
        const next = window.prompt("Edit text:", item.content);
        if (next === null) return;
        item.content = next;
        marker.setIcon(buildIcon(item, undefined));
        emitChange();
      });
    }
    if (callbacks.editable) wireResize(item, marker);
    itemMarkers.set(item.id, marker);
    layer.addLayer(marker);
  }

  function addConnector(from: string, to: string): void {
    const connector: BoardConnector = { id: newId(), from, to };
    connectors.set(connector.id, connector);
    const fromItem = items.get(from);
    const toItem = items.get(to);
    if (!fromItem || !toItem) return;
    const line = L.polyline([centerOf(fromItem), centerOf(toItem)], { color: "#888", weight: 2 });
    line.on("click", (event: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(event);
      selectConnector(connector.id);
    });
    connectorLines.set(connector.id, line);
    lineLayer.addLayer(line);
    emitChange();
  }

  for (const item of initial.items) addMarkerFor(item);
  for (const connector of initial.connectors) {
    connectors.set(connector.id, connector);
    const fromItem = items.get(connector.from);
    const toItem = items.get(connector.to);
    if (!fromItem || !toItem) continue;
    const line = L.polyline([centerOf(fromItem), centerOf(toItem)], { color: "#888", weight: 2 });
    line.on("click", (event: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(event);
      selectConnector(connector.id);
    });
    connectorLines.set(connector.id, line);
    lineLayer.addLayer(line);
  }

  map.on("click", () => {
    if (connecting) return;
    selectItem(undefined);
    selectConnector(undefined);
  });

  function placeNewItem(kind: BoardItem["kind"], content: string, width: number, height: number): void {
    const center = map.getCenter();
    const item: BoardItem = {
      id: newId(),
      kind,
      x: Math.round(center.lng - width / 2),
      y: Math.round(center.lat - height / 2),
      width,
      height,
      content
    };
    addMarkerFor(item);
    emitChange();
  }

  return {
    addImage(dataUri: string): void {
      placeNewItem("image", dataUri, 220, 160);
    },
    addText(text: string): void {
      placeNewItem("text", text, 200, 100);
    },
    addPage(slug: string): void {
      placeNewItem("page", slug, 200, 70);
    },
    startConnectMode(): void {
      connecting = true;
      connectModeFirstClick = undefined;
      selectItem(undefined);
      selectConnector(undefined);
    },
    cancelConnectMode(): void {
      connecting = false;
      connectModeFirstClick = undefined;
    },
    deleteSelected(): void {
      if (selectedItemId) {
        const id = selectedItemId;
        itemMarkers.get(id) && layer.removeLayer(itemMarkers.get(id)!);
        itemMarkers.delete(id);
        items.delete(id);
        for (const connector of Array.from(connectors.values())) {
          if (connector.from !== id && connector.to !== id) continue;
          const line = connectorLines.get(connector.id);
          if (line) lineLayer.removeLayer(line);
          connectorLines.delete(connector.id);
          connectors.delete(connector.id);
        }
        selectedItemId = undefined;
        emitChange();
      } else if (selectedConnectorId) {
        const id = selectedConnectorId;
        const line = connectorLines.get(id);
        if (line) lineLayer.removeLayer(line);
        connectorLines.delete(id);
        connectors.delete(id);
        selectedConnectorId = undefined;
        emitChange();
      }
    },
    hasSelection(): boolean {
      return selectedItemId !== undefined || selectedConnectorId !== undefined;
    },
    destroy(): void {
      map.remove();
    }
  };
}
