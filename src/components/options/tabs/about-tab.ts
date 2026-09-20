// About tab: what the app is and where to find its source
import { ensureEl } from "@/utils/nodeUtils";

const TEMPLATE = /* html */ `
  <div class="aboutActions">
    <button
      id="startTourButton"
      onclick="window.Services.UiTour.start()"
      data-tip="Take an interactive tour of the map generator"
      style="flex: 1; border: 1px solid var(--header);"
    >
      Interactive Tour
    </button>
  </div>
  <p>
    <b>Mapweave</b> is a worldbuilding platform: a generated fantasy map and a cross-linked lore wiki,
    all in one app. The created maps can be used freely, even for commercial purposes.
  </p>
  <p>
    <a href="https://github.com/mdubuis/mapweave" target="_blank">GitHub repository</a> ·
    <a href="https://github.com/mdubuis/mapweave/blob/main/LICENSE" target="_blank">License</a> ·
    Please report bugs <a href="https://github.com/mdubuis/mapweave/issues" target="_blank">here</a>.
  </p>
  <div style="display: flex; justify-content: center; padding: 0.4em; font-family: cursive">
    <a href="https://u24.gov.ua/" style="width: 80%" data-tip="Support Ukraine" target="_blank">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200">
        <rect width="100%" height="100%" fill="#005bbb"></rect>
        <rect y="50%" width="100%" height="50%" fill="#ffd500"></rect>
        <text x="50%" text-anchor="middle" font-size="6em" y="32%" fill="#f5f5f5">Support Ukraine</text>
        <text x="50%" text-anchor="middle" font-size="4em" y="78%" fill="#005bdd">u24.gov.ua</text>
      </svg>
    </a>
  </div>
`;

ensureEl("aboutContent").innerHTML = TEMPLATE;
