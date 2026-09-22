/**
 * Map-side half of the "Place on map" bridge — see src/wiki/map-bridge.ts for the protocol (now an
 * in-process event bus, not postMessage — both sides share one document since the Phase 6 single-
 * DOM merge) and src/wiki-main.ts for the wiki-side half. The wiki asks this module to arm a
 * placement tool; this module reports back the id/cell of whatever gets placed (or that placement
 * was cancelled).
 *
 * Only one request can be in flight — the wiki never issues a second one before the first resolves.
 */
import { Controllers } from "@/controllers";
import {
  mapToWikiBus,
  PLACEMENT_CANCEL,
  PLACEMENT_REQUEST,
  PLACEMENT_RESULT,
  type PlacementKind,
  type PlacementRequestMessage,
  type PlacementResultMessage,
  wikiToMapBus
} from "@/wiki/map-bridge";

let pending: { requestId: string; kind: PlacementKind } | undefined;

function sendToWiki(message: PlacementResultMessage | { type: typeof PLACEMENT_CANCEL; requestId: string }): void {
  mapToWikiBus.dispatchEvent(new CustomEvent(message.type, { detail: message }));
}

function stopActiveTool(kind: PlacementKind): void {
  if (kind === "burg") void Controllers.BurgCreator.stop();
  else void Controllers.MarkerCreator.stop();
}

function onCreated(kind: PlacementKind, detail: { id: number; name: string; cell?: number }): void {
  if (!pending || pending.kind !== kind) return;
  sendToWiki({
    type: PLACEMENT_RESULT,
    requestId: pending.requestId,
    kind,
    id: detail.id,
    name: detail.name,
    cell: detail.cell
  });
  pending = undefined;
  stopActiveTool(kind); // resolve on the first placement, even if the tool supports Shift-multi-place
}

wikiToMapBus.addEventListener(PLACEMENT_REQUEST, event => {
  const data = (event as CustomEvent<PlacementRequestMessage>).detail;
  pending = { requestId: data.requestId, kind: data.kind };
  if (data.kind === "burg") void Controllers.BurgCreator.toggle();
  else void Controllers.MarkerCreator.toggle();
});
wikiToMapBus.addEventListener(PLACEMENT_CANCEL, event => {
  const data = (event as CustomEvent<{ requestId: string }>).detail;
  if (data.requestId !== pending?.requestId) return;
  stopActiveTool(pending.kind);
  pending = undefined;
});

window.addEventListener("burg:created", event => {
  onCreated("burg", (event as CustomEvent).detail);
});
window.addEventListener("marker:created", event => {
  onCreated("marker", (event as CustomEvent).detail);
});
window.addEventListener("map:placement-stopped", () => {
  // Fires on every stop, including the one onCreated() just triggered via stopActiveTool() — only
  // still-pending here means it was a genuine cancel (Escape, toggled off without placing).
  if (pending) {
    sendToWiki({ type: PLACEMENT_CANCEL, requestId: pending.requestId });
    pending = undefined;
  }
});
