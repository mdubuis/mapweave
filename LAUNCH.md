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
**wiki**, connecté automatiquement à la dernière carte créée. "View Map" dans la barre latérale ouvre
la carte ; le bouton en haut à droite de la carte revient au wiki.

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
| Le lien carte ↔ wiki | `src/wiki/map-link.ts` + `burg-editor.ts`, `markers-editor.ts`, `states-editor.ts` |
| Les ères / la timeline | `src/wiki/eras.ts`, `src/services/era-switcher.ts` |
| Le contenu d'exemple | `wiki/**/*.md` |
| Le style partagé (dialogues, boutons) | `public/index.css` |
| La migration Postgres/Leaflet | `MIGRATION.md`, `server/README.md` |

Pour la checklist de test détaillée couche par couche de la migration Leaflet (Phase 5, en cours),
voir `MIGRATION.md`.
