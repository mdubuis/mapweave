/**
 * Timeline UI for the map engine: a small floating dropdown letting the user jump between eras,
 * each a full `.map` snapshot under public/maps/ (see wiki/SCHEMA.md). Reuses FMG's existing
 * `?maplink=` URL param to actually load the file — no new load path, just navigation. Renders
 * nothing when the wiki defines no "type: era" entities, so untouched projects see no change at
 * all. Explicitly invoked once by map-engine-host.ts right after the engine itself boots — not
 * self-bootstrapping from DOMContentLoaded anymore, since the map engine is no longer its own
 * document with its own load event (see MAPWEAVE.md's Phase 6 "Phase 3").
 */

import { showDataTip } from "@/components/tooltips";
import { getPrimaryMountRoot } from "@/services/shadow-dom-bridge";
import { debounce } from "@/utils";
import { loadEntities } from "@/wiki/entities";
import { type Era, loadEras } from "@/wiki/eras";

function absoluteMapUrl(mapFile: string): string {
  return new URL(`maps/${mapFile}`, location.href).href;
}

function selectedMaplink(): string | null {
  return new URL(location.href).searchParams.get("maplink");
}

// Global <head> styles don't reach into a shadow root at all (Shadow DOM CSS encapsulation), so
// this has to go wherever #eraSwitcher itself ends up — getPrimaryMountRoot(), same as the element.
function injectStyles(mountRoot: ParentNode): void {
  const style = document.createElement("style");
  style.textContent = /* css */ `
    #eraSwitcher {
      position: fixed;
      top: 0.5em;
      left: 50%;
      transform: translateX(-50%);
      z-index: 20;
      background: var(--bg-dialogs, rgba(20, 20, 20, 0.85));
      border: 1px solid var(--dark-solid, #555);
      border-radius: var(--radius, 6px);
      box-shadow: var(--shadow-sm, 0 1px 4px rgba(0, 0, 0, 0.2));
      padding: 0.25em 0.5em;
      transition: box-shadow var(--transition, 0.15s ease);
    }
    #eraSwitcher:hover {
      box-shadow: var(--shadow, 0 6px 20px rgba(0, 0, 0, 0.3));
    }
    #eraSwitcher select {
      background: transparent;
      color: inherit;
      border: none;
      font: inherit;
    }
  `;
  mountRoot.appendChild(style);
}

export function initEraSwitcher(): void {
  const eras: Era[] = loadEras(loadEntities()).filter(era => era.mapFile);
  if (!eras.length) return;

  const mountRoot = getPrimaryMountRoot();
  injectStyles(mountRoot);

  const current = selectedMaplink();
  const options = eras
    .map(era => {
      const url = absoluteMapUrl(era.mapFile!);
      return `<option value="${url}"${current === url ? " selected" : ""}>${era.label}</option>`;
    })
    .join("");

  const container = document.createElement("div");
  container.id = "eraSwitcher";
  container.innerHTML = `<select id="eraSwitcherSelect" data-tip="Load the map for a different era of this world">
    <option value=""${current ? "" : " selected"} disabled>Select an era…</option>${options}
  </select>`;
  mountRoot.appendChild(container);
  container.addEventListener("mousemove", debounce(showDataTip, 50));

  container.querySelector("select")!.addEventListener("change", event => {
    const url = (event.target as HTMLSelectElement).value;
    if (!url) return;
    const target = new URL(location.href);
    target.searchParams.set("maplink", url);
    location.href = target.toString();
  });
}
