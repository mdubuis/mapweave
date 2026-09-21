import { createRegistry } from "@/utils/registry";
import "./platform";
import "./autosave";
import "./era-switcher";
import "./fonts";
import "./placement-bridge";
import "./url-params";
import "./versioning";
import "./wiki-panel";

export const Services = createRegistry({
  ExportJson: () => import("@/services/io/export-json").then(m => m.ExportJson),
  ExportMap: () => import("@/services/io/export").then(m => m.ExportMap),
  Load: () => import("@/services/io/load").then(m => m.Load),
  Save: () => import("@/services/io/save").then(m => m.Save),
  UiTour: () => import("@/services/ui-tour").then(m => m.UiTour)
});

type ServicesRegistry = typeof Services;
declare global {
  // biome-ignore lint/suspicious/noRedeclare: exposed on window for legacy JS
  var Services: ServicesRegistry;
}
window.Services = Services;
