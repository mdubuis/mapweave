import type { Route } from "@/generators/routes-generator";
import * as routeLayer from "@/renderers/leaflet/route-layer";

export function drawRoutes(): void {
  TIME && console.time("drawRoutes");
  routeLayer.update(pack.routes);
  TIME && console.timeEnd("drawRoutes");
}

export function removeRoutes(): void {
  routeLayer.clear();
}

export function ensureRoutesPane(): void {
  routeLayer.ensurePane();
}

/** Re-render a single edited route, keeping its neighbors' layers untouched */
export function redrawRoute(route: Route): void {
  routeLayer.redrawRoute(route);
}

/** No-op now that routes aren't viewport-culled — kept so callers (route-editor.ts) don't need to
 *  change; every route always renders regardless of the current view */
export function setEditedRoute(_routeId: number | null): void {}

/** Live preview while drawing a new route in the Route Creator */
export function setTempRoute(route: { group: string; points: number[][] } | null): void {
  routeLayer.setTempRoute(route);
}

/** Bounding box of the rendered route, in world-space coordinates */
export function getRouteBox(routeId: number): DOMRect | null {
  return routeLayer.getBounds(routeId) ?? null;
}
