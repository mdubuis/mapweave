import { type LayerId, Layers } from "@/components/layers";
import { getPrimaryMountRoot } from "@/services/shadow-dom-bridge";
import { parseSections, type TemplateLookup } from "@/utils/schemaUtils";
import defaultStyles from "./default-styles.json";
import { type StyleLayerId, type Styles as StylesData, stylesSchema } from "./styles-schema";

const DEFAULT_STYLES: DeepReadonly<StylesData> = stylesSchema.parse(defaultStyles);
globalThis.styles = structuredClone(DEFAULT_STYLES);

function parse(json: unknown): StylesData {
  return parseSections<StylesData>(stylesSchema, DEFAULT_STYLES, json, "Styles.parse", sourceValueFor);
}

// custom group names don't exist in the defaults, so any stock group of the same record stands in as template
const sourceValueFor: TemplateLookup = (source, key, parentKey) => {
  if (typeof source !== "object" || source === null) return undefined;
  const record = source as Record<PropertyKey, unknown>;
  const value = record[key];
  if (value !== undefined || parentKey !== "groups") return value;
  return Object.values(record)[0];
};

function set(data: StylesData): void {
  globalThis.styles = data;
}

// attrs go onto the DOM by data-layer/data-group; options never do (renderers read the store)
function write(...ids: StyleLayerId[]): void {
  for (const id of ids) {
    // getPrimaryMountRoot(), not document: real bug found by actually generating a map, not by
    // reading the code — [data-layer="..."] is an attribute selector, and the shadow-DOM bridge's
    // document.querySelector fallback only covers bare #id selectors (see its own doc comment: a
    // general/compound selector can't unambiguously combine light+shadow results). Every one of
    // these lookups silently found nothing once the map moved into a shadow root (Phase 1), so no
    // style attribute — landmass's fill included — was ever written to the DOM again.
    // getPrimaryMountRoot() resolves to the registered shadow root when the map is shadow-hosted, or
    // document.body otherwise (same fallback leaflet-map.ts's ensureContainer() already relies on),
    // so this searches the right single tree instead of trying to search both.
    const root = getPrimaryMountRoot().querySelector(`[data-layer="${id}"]`);
    if (!root) continue;
    writeNode(root, styles[id]);
  }
}

function apply(...ids: StyleLayerId[]): void {
  write(...ids);
  Layers.draw(...ids.filter((id): id is StyleLayerId & LayerId => id !== "map"));
}

// CSS properties with the same meaning as their SVG presentation-attribute namesakes — the only
// ones worth writing onto a Leaflet pane (a plain <div>, not an SVGElement): setAttribute("opacity",
// ...) on an HTMLElement is a silent no-op, unlike on an SVG group. "fill" matters for rivers
// specifically: every river shares one color via inheritance from its container rather than a
// per-feature color, same as it always did — an explicit per-feature fill (states/provinces/etc.
// all set one) still overrides an inherited one, so this is safe for every other layer too
const CSS_COMPATIBLE_ATTRS = new Set(["opacity", "filter", "mask", "fill"]);

function writeNode(el: Element, node: object): void {
  const isHtmlElement = !(el instanceof SVGElement);
  for (const [key, value] of Object.entries(node)) {
    if (key === "options") continue;
    if (key === "attrs") {
      for (const [name, v] of Object.entries(value as object)) {
        if (isHtmlElement && CSS_COMPATIBLE_ATTRS.has(name)) {
          if (v === null || v === undefined) (el as HTMLElement).style.removeProperty(name);
          else (el as HTMLElement).style.setProperty(name, String(v));
          continue;
        }
        if (v === null || v === undefined) el.removeAttribute(name);
        else el.setAttribute(name, String(v));
      }
    } else {
      // a named subgroup (roads, statesHalo, ...) or a groups record of them
      const entries = key === "groups" ? Object.entries(value as object) : [[key, value] as const];
      for (const [group, groupNode] of entries) {
        const child = el.querySelector(`[data-group="${CSS.escape(group)}"]`);
        if (child) writeNode(child, groupNode as object);
      }
    }
  }
}

type DeepReadonly<T> = T extends (...args: any[]) => any
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export const Styles = { defaults: DEFAULT_STYLES, parse, set, write, apply };

type StylesApi = typeof Styles;

declare global {
  /** the live style record, read bare across every layer and replaced wholesale on load */
  var styles: import("./styles-schema").Styles;
  // biome-ignore lint/suspicious/noRedeclare: the bridge registered just below
  var Styles: StylesApi;
}

globalThis.Styles = Styles;
