# Lancer Mapweave

## Démarrage rapide

Trois terminaux, à lancer dans cet ordre.

**Terminal 1 — base de données** (reste lancée en arrière-plan)
```bash
docker compose up -d
```

**Terminal 2 — serveur API** (nécessaire pour que le wiki se connecte à une carte)
```bash
cd server
npm install   # première fois seulement
npm run start
```

**Terminal 3 — l'application**
```bash
npm install   # première fois seulement
npm run dev
```

Ouvre l'URL que Vite affiche (ex: `http://localhost:5173/Fantasy-Map-Generator/`). Tu arrives sur le
**wiki** — c'est le seul point d'entrée maintenant, la carte n'est plus un document séparé (`map.html`)
mais une vue à l'intérieur de la même app (Phase 6, voir `MAPWEAVE.md`). Première visite, aucun monde
choisi avant : tu atterris sur "Choose a world" — soit un monde déjà généré dans la base, soit
"+ Create a new world…", qui ouvre la carte directement sur l'onglet Options (réglages de génération :
seed, template, cultures, états…) plutôt que sur un état "no map yet". Une fois un monde choisi, l'app
s'y reconnecte automatiquement aux visites suivantes (persisté en local, pas "la dernière carte créée"
globalement). "View Map" dans la barre latérale ouvre la carte ; le bouton ✕ en haut à droite de la
carte revient au wiki.

Si le terminal 1 ou 2 n'est pas lancé, le wiki fonctionne quand même (juste sans les entités de la
base de données — les pages écrites à la main restent accessibles).

## Pas encore de carte dans la base ?

Carte de test minimale (aucune vraie carte requise) :
```bash
node scripts/import-map.mjs --pack scripts/fixtures/PackCells.sample.json --name "Test Map"
```

Pour importer une vraie carte : dans l'app, **Options → Export → JSON → Pack Cells**, puis :
```bash
node scripts/import-map.mjs --pack ~/Downloads/PackCells.json --name "My World"
```

## Avant de committer

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
```

`npm run test:e2e` (Playwright) existe mais n'est jamais lancé automatiquement — seulement à la main
si besoin d'une couverture bout-en-bout.

## Où regarder pour...

| Changer... | Fichiers |
|---|---|
| Le format des fiches wiki | `wiki/SCHEMA.md` + `src/wiki/entities.ts`, `frontmatter.ts` |
| Le rendu Markdown | `src/wiki/markdown.ts` |
| L'UI du wiki (navigation, édition) | `src/wiki-main.ts`, `src/index.html`, `src/wiki.css` |
| Le lien carte ↔ wiki (icône "wiki page" sur un burg/marker/état) | `src/wiki/map-link.ts` + `burg-editor.ts`, `markers-editor.ts`, `states-editor.ts` |
| La carte fusionnée dans le shell (moteur legacy en Shadow DOM), "Place on map", l'écran "Choose a world" | `src/services/map-engine-host.ts`, `src/services/shadow-dom-bridge.ts`, `src/wiki/map-bridge.ts`, `src/wiki-main.ts` (routes `#/map`, `#/choose-world`) — voir `MAPWEAVE.md`, section "Phase 6" |
| Les ères / la timeline | `src/wiki/eras.ts`, `src/services/era-switcher.ts` |
| Le contenu d'exemple | `wiki/**/*.md` |
| Le style partagé (dialogues, boutons) | `public/index.css` |
| La migration Postgres/Leaflet | `MIGRATION.md`, `server/README.md` |

Pour la checklist de test détaillée couche par couche de la migration Leaflet (Phase 5, en cours),
voir `MIGRATION.md`.
