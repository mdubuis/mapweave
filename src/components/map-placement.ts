import { select } from "d3";
import { ensureEl } from "@/utils";
import { clearMainTip, tip } from "./tooltips";
import { applyDefaultViewboxEvents, clickSurface } from "./viewbox-events";

let cleanupActivePlacement: (() => void) | undefined;

/** Toggle a map-placement tool, replacing any other active placement tool. */
export function toggleMapPlacement(
  buttonId: string,
  onClick: (event: MouseEvent) => void,
  message: string,
  type?: "warn",
  onStop?: () => void
): boolean {
  const button = ensureEl(buttonId);
  if (button.classList.contains("pressed")) {
    stopMapPlacement();
    return false;
  }

  stopMapPlacement();
  button.classList.add("pressed");
  cleanupActivePlacement = onStop;
  // The placement callback binds to #viewbox, not the Leaflet click surface: every placement
  // callback uses d3's pointer(event, event.currentTarget) to convert the click into world
  // coordinates via #viewbox's own SVG CTM — moving this to a plain HTML container would break that
  // math. The tradeoff: a click that lands exactly on a Leaflet-rendered feature (a burg/marker/
  // river/route icon) while a placement tool is active won't reach this listener at all (different
  // DOM subtree) and no-ops, rather than placing the new item there — a narrow, low-impact gap, not
  // the general click-to-open-an-editor regression viewbox-events.ts's onClick fixes.
  //
  // Since the two listeners now live on different nodes (#viewbox here, the Leaflet map container
  // for the default click-to-edit handler), they no longer replace one another the way same-node
  // d3 .on() calls used to — the default handler must be explicitly suspended, or a click during
  // placement would both place the new item *and* open an unrelated editor.
  clickSurface().on("click", null);
  select<SVGGElement, unknown>("#viewbox").style("cursor", "crosshair").on("click", onClick);
  tip(message, true, type);
  return true;
}

/** Exit the active map-placement tool and restore default map interaction. */
export function stopMapPlacement(): void {
  cleanupActivePlacement?.();
  cleanupActivePlacement = undefined;
  ensureEl("addFeature")
    .querySelectorAll("button.pressed")
    .forEach(button => {
      button.classList.remove("pressed");
    });
  applyDefaultViewboxEvents();
  clearMainTip();
}
