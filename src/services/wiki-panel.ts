/**
 * "Wiki" entry point built into the map layer itself: a floating button that slides in the wiki
 * app (wiki.html) as an in-page panel, so browsing/editing lore never requires leaving the map or
 * knowing to swap the URL by hand. Pure JS injection, same approach as era-switcher.ts — no
 * index.html edits, and the iframe only loads wiki.html (a separate bundle) on first open.
 */

import { showDataTip } from "@/components/tooltips";
import { debounce } from "@/utils";

function injectStyles(): void {
  const style = document.createElement("style");
  style.textContent = /* css */ `
    #wikiMenuButton {
      position: fixed;
      top: 0.5em;
      right: 0.5em;
      z-index: 21;
      width: 2.4em;
      height: 2.4em;
      border-radius: 50%;
      border: 1px solid var(--dark-solid, #555);
      background: var(--bg-dialogs, rgba(20, 20, 20, 0.9));
      color: inherit;
      font-size: 1.2em;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow-sm, 0 1px 4px rgba(0, 0, 0, 0.2));
      transition:
        transform var(--transition, 0.15s ease),
        background-color var(--transition, 0.15s ease),
        box-shadow var(--transition, 0.15s ease);
    }
    #wikiMenuButton:hover {
      background: var(--header, #444);
      box-shadow: var(--shadow, 0 6px 20px rgba(0, 0, 0, 0.3));
      transform: scale(1.06);
    }
    #wikiMenuButton:active {
      transform: scale(0.97);
    }
    #wikiPanel {
      position: fixed;
      top: 0;
      right: 0;
      width: min(480px, 100vw);
      height: 100vh;
      background: var(--bg-dialogs, #1b1d22);
      box-shadow: var(--shadow, -4px 0 20px rgba(0, 0, 0, 0.4));
      z-index: 22;
      transform: translateX(100%);
      transition: transform var(--transition, 0.2s ease);
      display: flex;
      flex-direction: column;
    }
    #wikiPanel.open {
      transform: translateX(0);
    }
    #wikiPanelHeader {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5em 0.75em;
      border-bottom: 1px solid var(--dark-solid, #555);
      font-weight: bold;
      color: inherit;
    }
    #wikiPanelClose {
      background: none;
      border: none;
      font-size: 1.2em;
      cursor: pointer;
      color: inherit;
      border-radius: var(--radius-sm, 4px);
    }
    #wikiPanelClose:hover {
      background: var(--bg-light, rgba(255, 255, 255, 0.1));
    }
    #wikiPanelFrame {
      flex: 1;
      border: 0;
    }
  `;
  document.head.appendChild(style);
}

export function initWikiPanel(): void {
  injectStyles();

  const button = document.createElement("button");
  button.id = "wikiMenuButton";
  button.type = "button";
  button.className = "icon-sitemap";
  button.dataset.tip = "Open the world wiki";
  document.body.appendChild(button);
  button.addEventListener("mousemove", debounce(showDataTip, 50));

  const panel = document.createElement("div");
  panel.id = "wikiPanel";
  panel.innerHTML = /* html */ `
    <div id="wikiPanelHeader">
      <span>Wiki</span>
      <button id="wikiPanelClose" type="button" aria-label="Close">✕</button>
    </div>
    <iframe id="wikiPanelFrame" title="Mapweave Wiki"></iframe>
  `;
  document.body.appendChild(panel);

  const frame = panel.querySelector<HTMLIFrameElement>("#wikiPanelFrame")!;
  let loaded = false;

  function open(): void {
    if (!loaded) {
      frame.src = "./wiki.html";
      loaded = true;
    }
    panel.classList.add("open");
  }

  function close(): void {
    panel.classList.remove("open");
  }

  button.addEventListener("click", open);
  panel.querySelector<HTMLButtonElement>("#wikiPanelClose")!.addEventListener("click", close);
}

document.addEventListener("DOMContentLoaded", initWikiPanel);
