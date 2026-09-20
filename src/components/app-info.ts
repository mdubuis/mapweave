// The "About" dialog: what the app is and where to find its source
import { ensureEl, link } from "@/utils";

const LINKS = [
  link("https://github.com/mdubuis/mapweave", "GitHub repository"),
  link("https://github.com/mdubuis/mapweave/blob/main/LICENSE", "License")
];

function render(): string {
  return /* html */ `<b>Mapweave</b> is a worldbuilding platform: a generated fantasy map and a cross-linked lore wiki, all in one app.

    <ul style="columns:2">${LINKS.map(item => `<li>${item}</li>`).join("")}</ul>`;
}

/** Show info about the app in a popup */
export function showInfo(): void {
  ensureEl("alertMessage").innerHTML = render();

  $("#alert").dialog({
    resizable: false,
    title: document.title,
    width: "28em",
    buttons: {
      OK: function (this: HTMLElement) {
        $(this).dialog("close");
      }
    },
    position: { my: "center", at: "center", of: "svg" }
  });
}

export const AppInfo = { open: showInfo };
