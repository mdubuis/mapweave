/**
 * Shown instead of auto-generating a map when there's no explicit intent (no `?seed=`, `?maplink=`,
 * or a stored "last saved" map) — see MAPWEAVE.md's migration plan, Phase 0. `onGenerate` is the
 * same entry point (`generateMapOnLoad`) the automatic paths already use, just deferred to a click.
 */
export function showGenerateIdleState(onGenerate: () => void): void {
  const style = document.createElement("style");
  style.textContent = /* css */ `
    #generateIdleState {
      position: fixed;
      inset: 0;
      z-index: 30;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg-main, rgba(20, 20, 24, 0.9));
    }
    #generateIdleCard {
      text-align: center;
      padding: 2em 3em;
      border-radius: var(--radius, 8px);
      box-shadow: var(--shadow, 0 6px 20px rgba(0, 0, 0, 0.3));
      background: var(--bg-dialogs, #1b1d22);
      color: inherit;
    }
    #generateIdleCard h1 {
      margin: 0 0 0.3em;
      font-family: var(--sans-serif);
    }
    #generateIdleCard p {
      margin: 0 0 1em;
      color: var(--dark-solid, #888);
    }
    #generateIdleButton {
      padding: 0.6em 1.4em;
      font-size: 1.1em;
      background: var(--header, #444);
      color: #fff;
      border: none;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "generateIdleState";
  overlay.innerHTML = /* html */ `
    <div id="generateIdleCard">
      <h1>Mapweave</h1>
      <p>No map loaded yet.</p>
      <button id="generateIdleButton" type="button">Generate a map</button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById("generateIdleButton")!.addEventListener("click", () => {
    overlay.remove();
    style.remove();
    onGenerate();
  });
}
