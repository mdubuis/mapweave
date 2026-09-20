/**
 * postMessage protocol between the wiki (src/index.html, sender for requests) and the map
 * (src/map.html, sender for results) for "Place on map" — see src/wiki-main.ts's requestPlacement
 * and src/services/placement-bridge.ts. First cross-frame protocol in this repo: both bundles are
 * same-origin (dev server, GitHub Pages), so every listener checks event.origin === location.origin
 * and every post targets location.origin explicitly, never "*".
 */
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
