/**
 * In-process event protocol between the wiki shell (src/wiki-main.ts, sender for requests) and the
 * map engine (src/services/map-engine-host.ts + src/services/placement-bridge.ts, sender for
 * results) for "Place on map". Both now run in the same document (Phase 6 "Phase 3" — see
 * MAPWEAVE.md; this used to cross a wiki<->map iframe boundary via postMessage, checking
 * event.origin/event.source, before the single-DOM merge).
 *
 * Two dedicated EventTarget buses, not `window` itself: PLACEMENT_CANCEL is bidirectional (wiki
 * asks the map to stop; the map also reports back that it stopped on its own, e.g. Escape) — on a
 * shared `window`, the wiki's own outgoing dispatch would immediately re-trigger its own incoming
 * listener, a same-window echo that never happened when this crossed a real window boundary.
 * Separate buses per direction rule that out structurally instead of by convention.
 */
export const wikiToMapBus = new EventTarget();
export const mapToWikiBus = new EventTarget();

export const PLACEMENT_REQUEST = "mapweave:placement-request";
export const PLACEMENT_RESULT = "mapweave:placement-result";
/** Bidirectional: wiki -> map means "stop the tool", map -> wiki means "the tool stopped" (Escape,
 *  toggled off) — same shape either way, see placement-bridge.ts and wiki-main.ts. */
export const PLACEMENT_CANCEL = "mapweave:placement-cancel";

export type PlacementKind = "burg" | "marker";

export interface PlacementRequestMessage {
  type: typeof PLACEMENT_REQUEST;
  requestId: string;
  kind: PlacementKind;
}

export interface PlacementResultMessage {
  type: typeof PLACEMENT_RESULT;
  requestId: string;
  kind: PlacementKind;
  id: number;
  name: string;
  /** Present for markers; burgs resolve via ?burg=<id> instead, see wiki-main.ts's mapViewHref */
  cell?: number;
}

export interface PlacementCancelMessage {
  type: typeof PLACEMENT_CANCEL;
  requestId: string;
}

export type PlacementMessage = PlacementRequestMessage | PlacementResultMessage | PlacementCancelMessage;
