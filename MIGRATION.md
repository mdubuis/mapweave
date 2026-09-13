# Migration Postgres/PostGIS + Génération serveur + Leaflet + Wiki unifié

Approuvé le 2026-09-13. Voir `MAPWEAVE.md` pour l'historique des phases précédentes (1-4 : nettoyage,
wiki, liens map↔wiki, timeline) que ce document ne remplace pas — il s'agit d'une migration
ultérieure et bien plus large, avec son propre suivi de phases ci-dessous.

## Contexte

Mapweave tourne aujourd'hui entièrement côté client : moteur de génération procédurale FMG (Voronoi/climat/hydrologie/cultures, ~150 fichiers TS), rendu 100% SVG/D3, wiki Markdown séparé (`wiki.html`) relié à la carte (`index.html`) par un `map_ref` et une iframe. Zéro backend, site statique.

L'utilisateur souhaite migrer vers : un backend PostgreSQL + PostGIS (local, mono-utilisateur, sans authentification), une génération procédurale qui tourne côté serveur plutôt que dans le navigateur, un rendu de carte basé sur Leaflet (couches vectorielles GeoJSON, pas un pipeline de tuiles complet), une vue carte intégrée *dans* le wiki (plus de page séparée), toutes les entités générées navigables dans une arborescence claire du wiki, et une génération déclenchée manuellement plutôt qu'automatique au chargement.

Trois recherches approfondies (rendu SVG, persistance/génération, dépendances navigateur du moteur) ont confirmé la faisabilité et localisé précisément les risques : le moteur de génération est étonnamment portable côté Node (un seul vrai blocage), mais le rendu Leaflet est un chantier majeur (~85-90 fichiers touchent des API SVG directement). Ce document découpe le travail en phases indépendamment livrables, en gardant l'app fonctionnelle à chaque étape plutôt qu'une réécriture big-bang.

**Comment utiliser ce plan** : chaque phase est un jalon validable séparément, dans l'esprit des phases précédentes du projet (voir `MAPWEAVE.md`). Rien n'empêche de s'arrêter après la Phase 0 ou la Phase 3 si le reste s'avère ne pas valoir le coût une fois vécu.

---

## Décisions de conception

**Arborescence wiki = vue live sur la base, pas des fichiers générés.** Avec des centaines à quelques milliers d'entités par carte (burgs, states, etc.), générer un fichier Markdown par entité produirait un dépôt dominé par du bruit généré, en conflit avec l'usage actuel (fichiers `wiki/*.md` = lore écrit à la main, versionné proprement). La solution : le wiki charge deux sources fusionnées — les fichiers Markdown existants (inchangé) + les entités interrogées en direct depuis l'API Postgres, normalisées dans la même forme `WikiEntity`. Une action "développer en fiche de lore" sur n'importe quel nœud généré crée alors un vrai fichier `.md`, réutilisant le flux de création déjà construit en Phase 3 du projet (`#/new?mapKind=...`).

**CRS = SRID 0 (Cartésien), jamais EPSG:4326.** Il n'existe aujourd'hui aucune projection géographique réelle — `pack.cells.p`/`grid.points` sont des `[x,y]` plats dans l'espace `options.map.graph.{width,height}`. C'est exactement le cas d'usage de **`L.CRS.Simple`** dans Leaflet (cartes "à plat", jeux, images). Traiter ces coordonnées comme des degrés de latitude/longitude serait faux.

**Renderer Leaflet = `L.svg()`, pas `L.canvas()`.** Beaucoup de code actuel lit la géométrie DOM directement (`getBBox`, `getTotalLength`, `getPointAtLength` — placement de labels/emblèmes, outil règle, migration de fichiers anciens). `L.svg()` garde de vrais éléments `<path>` par entité, donc ce code s'adapte (`layer.getElement()` au lieu d'une sélection d3 brute) plutôt que d'être totalement réécrit. `L.canvas()` n'a aucun nœud DOM — casserait ce code *et* la délégation de clics simultanément. Un layer Canvas ciblé reste possible plus tard pour la maille brute de cellules (10-100K polygones) si le profilage le justifie.

**Identifiants d'entités = ceux du moteur FMG, pas des clés auto-incrémentées fraîches.** Les tables Postgres doivent être clées `(map_id, id)` où `id` réutilise l'id numérique déjà assigné par le générateur (burg.i, state.i, etc.). Sinon, tous les `map_ref` déjà écrits à la main dans le wiki existant (Phases 3-4 précédentes) cassent silencieusement.

**Pas de synchronisation offline.** Déploiement local mono-utilisateur explicitement choisi → `options.app`/`options.generation` restent en `localStorage` comme aujourd'hui ; IndexedDB ne garde que de l'état UI transitoire. Aucune file d'attente/résolution de conflits à construire.

---

## Phases

| # | Portée | Dépend de | Risque | Casse l'existant si mal fait | Statut |
|---|---|---|---|---|---|
| 0 | Génération manuelle au chargement | rien | Faible | Non — un seul branchement isolé | **Fait** |
| 1 | Schéma Postgres/PostGIS + ETL one-way (CLI), rien de branché à l'app | Docker | Faible | Non — l'ancien flux `.map` reste intact | **Fait** |
| 2 | Serveur API Node, lecture seule sur Postgres | Phase 1 | Moyen | Non — purement additif | **Fait** |
| 3 | Génération portée sur Node, `POST /api/maps` génère côté serveur | Phase 2 | **Élevé** | Seulement si la parité seed-à-seed n'est pas validée | **Fait*** |
| 4 | Le wiki devient la coquille hôte ; carte intégrée (encore en SVG) ; arborescence live | Phase 2 | Moyen | Oui, au système d'ères et aux `map_ref` — voir plus bas | **Fait*** (*jumelage ères/`map_id` volontairement reporté, voir plus bas) |
| 5 | Migration Leaflet, incrémentale, couche par couche | Phase 3 + Phase 4 | **Le plus élevé** (~85-90 fichiers) | Outils interactifs (règle, minimap, labels) les plus exposés | **En cours** (caméra + `biomes` faits ; provinces/cultures/religions/states/rivers/routes/burgs/marqueurs pas encore) |
| 6 | Retrait du format legacy pour les *nouvelles* cartes seulement | Phase 3 | Faible | Non si bien scopé | À faire |

### Phase 0 — Génération manuelle (à faire en premier, indépendamment de tout le reste) — **Fait**

Le seul point d'auto-génération sans intention explicite est le fallback inconditionnel dans `checkLoadParameters()` (`src/services/url-params.ts:57-58`) — remplacé par un état vide/idle avec un bouton "Générer" (`src/components/idle-state.ts`, nouveau). L'infrastructure de déclenchement manuel existait déjà et est réutilisée telle quelle : le bouton appelle exactement `generateMapOnLoad(size)`, la même fonction que les chemins `?seed=`/`?maplink=` utilisent déjà, juste différée à un clic au lieu d'auto-invoquée. Zéro changement dans le pipeline de génération lui-même.

**Vérification** : ouvrir l'app sans paramètre d'URL et sans carte sauvegardée → écran vide avec bouton, pas de génération auto. `?seed=...`, `?maplink=...`, et "charger la dernière carte" continuent de fonctionner sans changement (ce sont des intentions explicites, elles restent automatiques). Confirmé : `tsc --noEmit`, lint, build, 1018/1018 tests, chargement de la page en local (200, pas d'erreur).

### Phase 1 — Schéma Postgres/PostGIS + validation ETL — **Fait**

`docker-compose.yml` : un service Postgres+PostGIS local (`docker.io/postgis/postgis:16-3.4`), volume nommé local, pas d'authentification au-delà des identifiants par défaut. Schéma dans `server/db/schema.sql`, appliqué automatiquement au premier démarrage du conteneur. Script d'import `server/scripts/import-map.mjs` (package Node isolé sous `server/`, dépendance `pg` uniquement — aucun impact sur le bundle client).

**Ajustement fait pendant cette phase, comme prévu** : la piste initiale ("réutiliser directement les 4 exporteurs GeoJSON de `export.ts`") s'est révélée impraticable telle quelle — ces fonctions lisent les globales navigateur (`pack`/`grid`/`options`), importent des modules DOM (tooltips, viewport, fonts) et projettent les coordonnées en pseudo-lon/lat via `toGeoCoordinates`, incompatible avec la décision SRID 0/Cartésien du schéma. La vraie source exploitée à la place : l'export **"Pack Cells" JSON** déjà existant dans le menu Export de l'app (`getPackDataJson()`/`getPackCellsData()` dans `src/services/io/export-json.ts`) — il expose `cells` (avec `v`, l'anneau d'indices de vertex) et `vertices` (coordonnées `[x,y]` brutes, non projetées) plus tous les tableaux d'entités (burgs/states/provinces/cultures/religions/rivers/routes/markers), sans aucune dépendance navigateur. Zéro changement de code source nécessaire pour produire cet export — la fonctionnalité existe déjà.

**Décision tranchée** : PostGIS fusionne les géométries de territoire lui-même. Le script importe la géométrie brute par cellule dans `map_cells`, puis `UPDATE ... SET geom = ST_Multi(ST_UnaryUnion(ST_Collect(geom))) ... GROUP BY state_id` (idem province/culture/religion) — aucun portage de la logique de traçage de trous de `connectVertices` n'a été nécessaire.

**Validé de bout en bout** avec une fixture synthétique (`server/scripts/fixtures/PackCells.sample.json`, 3 cellules dont 2 adjacentes partageant un état) : les deux cellules adjacentes fusionnent en un seul polygone 2×1 propre (arête interne partagée dissoute), la cellule isolée reste séparée, et une requête `ST_AsGeoJSON` renvoie un `FeatureCollection` directement consommable par `L.geoJSON()` — exactement la mécanique que la Phase 2 exposera via HTTP. Détails et commandes de vérification dans `server/README.md`.

**Piège rencontré et documenté** : sous podman rootless (Fedora), le montage du volume `schema.sql` nécessite le flag SELinux `:Z` (`docker-compose.yml`) — sans lui, Postgres échoue silencieusement à lire le fichier ("Permission denied" visible seulement dans `docker logs`, pas une erreur SQL).

**Reporté sciemment, pas oublié** : les zones (traçage de trous le plus complexe, pas nécessaire pour valider le reste), le meandering des rivières (`Rivers.addMeandering`, rendu en segments droits pour l'instant), et `map_topology.grid` (aucun export de grille utilisé dans ce script).

### Phase 2 — Serveur API Node, lecture seule — **Fait**

Fastify (`server/src/server.mjs`), pas d'authentification (local mono-utilisateur). La logique d'import de la Phase 1 a été extraite dans `server/src/import.mjs` (fonction pure `importPack(client, {...})`, transaction gérée par l'appelant) partagée par le script CLI (`scripts/import-map.mjs`, maintenant un simple wrapper) et le nouvel endpoint `POST /api/maps/import` — aucune logique dupliquée entre les deux chemins.

Endpoints (voir `server/README.md` pour le détail) : `GET /api/maps`, `POST /api/maps/import`, `GET /api/maps/:id`, `GET /api/maps/:id/layers/:layer` (GeoJSON par couche), `GET /api/maps/:id/entities/tree`, `GET /api/maps/:id/entities/:kind/:id`, `DELETE /api/maps/:id` (cascade vérifiée).

**Vérification faite** : chaque endpoint testé manuellement contre la fixture de la Phase 1 (liste, détail, GeoJSON par couche avec un cas de couche inconnue → 400, arborescence, détail d'entité, import via l'API en plus du CLI, suppression avec cascade confirmée sur `map_cells`). Le GeoJSON renvoyé par `/layers/:layer` est directement dans la forme qu'attend `L.geoJSON()`.

**Bug réel trouvé et corrigé pendant la vérification** : l'arborescence d'entités groupait un burg via `province_id ?? state_id` (coalescence nulle) tout en *choisissant* le groupe via un test de vérité (`province_id ? ... : ...`) — comme FMG utilise `0` comme sentinelle "pas de province" (pas `null`), un burg avec `province_id: 0` choisissait le bon groupe (état) mais était ensuite indexé par `0` au lieu de l'id d'état réel, disparaissant silencieusement de l'arborescence. Corrigé pour utiliser un seul test de vérité cohérent pour le choix du groupe et la clé.

### Phase 3 — Portage de la génération sur Node — **Fait*** (*une vérification reste à faire par un humain, voir plus bas)

Confirmé exactement comme prévu : sur 46 fichiers dans `src/generators/`, un seul point d'API navigateur était réellement sur le chemin du pipeline (`heightmap-generator.ts`'s `fromPrecreated()`), et le reste tourne **sans aucune modification** — le vrai moteur de génération client, pas une réécriture. Une carte complète (8462 cellules, 1117 burgs, 13 états, simulation économique complète) se génère en ~2 secondes sous Node.

**Le seul changement réel apporté à `src/`** : `fromPrecreated()` utilisait `<canvas>`/`Image`, absents sous Node. Rendu le chargeur d'image remplaçable (`setHeightmapImageLoader`, comportement navigateur par défaut inchangé) avec une implémentation serveur basée sur `sharp` (`server/src/generation/heightmap-image-loader.ts`). **Mise en garde documentée, pas cachée** : l'algorithme de redimensionnement de sharp/libvips n'est pas garanti identique pixel-à-pixel à celui du Canvas navigateur — seuls les templates de heightmap **pré-créés** (à base d'image) portent ce risque de divergence marginale ; les templates procéduraux (calcul pur) sont inchangés et identiques bit-à-bit.

**Deux dépendances non-évidentes découvertes seulement en exécutant réellement le code** (invisibles à la simple lecture des imports) :
- `aleaPRNG` (le PRNG à seed) n'est PAS un export ES module — c'est `window.aleaPRNG` posé par un **`<script>` classique vendorisé** (`public/libs/alea.min.js`), invisible à toute analyse par imports. Résolu en utilisant le paquet npm `alea` (même algorithme, déjà une dépendance utilisée directement par plusieurs générateurs).
- `FlatQueue` (utilisé par l'expansion des cultures/états) est le même genre de global vendorisé (`public/libs/flatqueue.js`) — mais ce fichier est UMD et détecte CommonJS, donc le fichier exact utilisé par le navigateur se charge ici sans modification via un simple import relatif.

`src/generators/pipeline.ts`'s `Pipeline<Id, TContext>` s'est révélé portable tel quel. L'équivalent serveur mince à `generate()` (`server/src/generation/generate.ts`) résout une requête en seed/taille/densité, lance le pipeline, puis `packToJson()` (`server/src/generation/pack-to-json.ts`) convertit le `pack` vivant dans la même forme que consomme déjà `importPack()` de la Phase 1 — aucune logique dupliquée.

**Concurrence** : la génération mute des globales partagées (`pack`/`grid`/`options`) — deux générations ne peuvent pas tourner en parallèle dans le même process sans se corrompre. L'endpoint API sérialise via une file de promesses (`server/src/routes/maps.mjs`) plutôt que d'exécuter en parallèle — suffisant en local mono-utilisateur.

**Vérifié directement** :
- **Déterminisme** : la même seed générée deux fois côté serveur produit une sortie identique bit-à-bit.
- **Bout en bout réel** : `npm run generate` sur une carte pleine taille, importée proprement et interrogeable via chaque endpoint de la Phase 2, géométries de territoire et de routes valides.
- **Un second bug réel**, trouvé uniquement en testant avec de vraies données générées (pas la fixture synthétique) : les entrées `points` des rivières/routes de FMG sont des triplets `[x, y, cellId]` (un id de cellule embarqué, pas une coordonnée Z) — GeoJSON lit une coordonnée à 3 éléments comme XYZ, ce que les colonnes PostGIS 2D rejetaient ("Geometry has Z dimension but column does not"). Corrigé en tronquant à `[x, y]`.
- **Requêtes concurrentes** : deux appels `POST /api/maps/generate` simultanés avec des seeds différentes se terminent avec des résultats corrects et indépendants — la file de sérialisation fonctionne.

**Ce qui reste à faire par un humain** (le projet ne lance jamais de vrai navigateur automatiquement) : `server/scripts/compare-with-browser.ts` compare une génération serveur à un export réel du navigateur pour la même seed/taille — c'est la seule étape de vérification du plan qui nécessite un navigateur réel. Voir `server/README.md` pour la commande exacte. Tout le reste ci-dessus a été vérifié directement.

### Phase 4 — Le wiki devient la coquille hôte ; arborescence live — **Fait***

Deux étapes, délibérément séparées de la Phase 5 pour ne jamais avoir "intégration à moitié cassée ET rendu à moitié cassé" en même temps :

1. **Bascule de coquille, même moteur de rendu — fait.** Plutôt que fusionner les deux bundles Vite (risque réel : deux applications complexes partageant un seul DOM, collisions d'id quasi garanties sur un monolithe de 9K lignes), le wiki héberge la carte en iframe — exactement le même mécanisme que `wiki-panel.ts` utilisait déjà pour l'inverse (carte héberge le wiki), simplement inversé. Bouton "View Map" dans la barre latérale du wiki (`src/wiki.html`, `wiki-main.ts`, `wiki.css`) ouvrant `./index.html` en plein écran. Garde anti-imbrication ajoutée à `wiki-panel.ts` (`if (window.self !== window.top) return`) pour qu'`index.html`, une fois chargé À L'INTÉRIEUR de ce panneau, n'essaie pas d'injecter son propre bouton wiki qui ouvrirait un wiki imbriqué à l'infini si on cliquait dessus. Le rendu de la carte elle-même reste inchangé (SVG classique) — seule la coquille change, exactement comme prévu, pour ne pas bloquer sur la Phase 5.
2. **Arborescence live — fait.** `src/wiki/db-entities.ts` (nouveau) normalise `GET /api/maps/:id/entities/tree` en `WikiEntity[]`, avec un slug synthétique déterministe `db-{mapId}-{kind}-{id}` (ex. `db-9-burg-42`) — stable tant que l'id FMG et le `mapId` ne changent pas, donc ciblable par wikilink à la main avant même qu'une fiche `.md` existe. `wiki-main.ts` garde deux tableaux d'entités séparés (`fileEntities`, chargé au build comme avant ; `dbEntities`, chargé à la demande via un nouveau bouton "Connect to map database…") fusionnés par `mergeEntitySources()` avant `buildGraph`/`buildSlugIndex`/`loadEras` — aucun changement nécessaire dans ces trois fonctions ni dans le rendu, comme prévu, puisqu'ils opèrent déjà sur un `WikiEntity[]` plat agnostique de la source. Chaque entité générée affiche un badge "from map #N" et un lien "Write a lore page for this ↗" vers `#/new?title=...`, qui crée une vraie fiche `.md` réutilisant le flux de création déjà existant.

**Décision prise, pas un oubli** : le jumelage ères/`map_id` évoqué comme risque de rupture ci-dessous n'a **pas** été fait dans cette passe. `dbRef` (le pointeur `{mapId, kind, id}` sur une entité générée) est un mécanisme séparé du système d'ères existant (`Era.mapFile`/`map_file`/`?maplink=`), pas branché dessus — documenté explicitement en commentaire dans `db-entities.ts`. Unifier les deux (une ère = une ligne `maps`, avec migration des `map_file:` existants vers `map_id:`) reste un vrai travail, à faire quand la Phase 5 (Leaflet) rendra le rendu de carte lui-même dépendant de Postgres plutôt que du fichier `.map` legacy — prématuré avant ça.

**Vérification faite** : `tsc --noEmit`, lint (biome, 0 erreur), build Vite (OK), 49/49 tests wiki (dont les nouveaux tests unitaires de `flattenTree`/`dbRefOf` dans `db-entities.test.ts`, couvrant l'imbrication état→province→burg, le fallback de titre pour une entité sans nom, et la composition du résumé parent/population/capitale).

**Reste à faire par un humain** (le projet ne lance jamais de vrai navigateur automatiquement) : cliquer "Connect to map database…" dans le wiki, choisir une carte importée en Phase 1/3, vérifier que l'arborescence se peuple et que "Write a lore page for this" crée bien une fiche pré-remplie.

### Phase 5 — Migration Leaflet, incrémentale, par ordre de risque croissant — **en cours**

Deux décisions de scope prises **pendant** cette phase, avant d'écrire du code de rendu, parce que creuser l'implémentation réelle a révélé deux problèmes que le plan initial n'avait pas anticipés :

**1. Pas de gain d'efficacité mémoire/tuiles dans cette phase, et c'est assumé.** Convertir uniquement les couches d'affichage (biomes/états/provinces/etc.) en GeoJSON servi par Postgres ne réduit PAS l'empreinte mémoire navigateur : `pack`/`grid` doivent rester intégralement en mémoire de toute façon, parce que tous les éditeurs (states-editor, burg-editor, provinces-editor, etc.) et toutes les autres couches continuent de muter cet objet directement et de redessiner en local, exactement comme aujourd'hui. Un vrai gain d'efficacité demanderait de rendre les éditeurs eux-mêmes pilotés par l'API (fetch/mutate/save en HTTP au lieu de muter un objet partagé en mémoire) — un chantier bien plus large que "Phase 5", hors scope ici. Cette phase est donc une **migration de moteur de rendu** (Leaflet réel : caméra, gestes, couches vectorielles natives), pas un chantier de performance. Décision validée explicitement avec l'utilisateur avant d'écrire du code.

**2. De vraies couches Leaflet (`L.geoJSON()`, clics natifs par-feature) exigent que le SVG existant partage le même arbre DOM que Leaflet, pas un arbre séparé empilé en CSS.** Deux arbres DOM superposés (un `<div>` Leaflet et un `<svg id="map">` à côté) ne peuvent pas être interactifs tous les deux à la fois : un point de l'écran ne reçoit les événements que d'UN SEUL des deux arbres. La seule architecture qui marche : `<svg id="map">` (avec ses 24 couches non converties, structure interne inchangée) devient l'contenu d'un **pane Leaflet dédié**, lui-même un enfant du même conteneur que les futures couches GeoJSON natives — pour que les clics/drags de l'un et les gestes de pan/zoom de Leaflet coexistent par la bulle d'événements DOM normale, exactement comme d3-zoom et d3-drag coexistaient déjà avant.

**Ce qui est fait, vérifié, et committé dans cette passe** — la fondation caméra, sans laquelle rien d'autre n'a de sens :
- `leaflet` + `@types/leaflet` ajoutés (`package.json`), aucune nouvelle vulnérabilité (`npm audit` ne signale que des CVE pré-existantes sans rapport, vitest/quill).
- `src/components/leaflet-map.ts` (nouveau) : instance `L.Map` unique, `L.CRS.Simple` avec une **échelle linéaire** (`scale(zoom) = zoom`, pas la puissance de 2 par défaut de Leaflet) pour que `map.getZoom()` reste numériquement identique à l'ancien facteur d'échelle `[1, 20]` de `viewport.scale`. `<svg id="map">` est déplacé (au premier appel) dans un pane Leaflet dédié (`legacySvg`), créé comme enfant direct du conteneur Leaflet plutôt que du pane interne `_mapPane` — pour ne PAS hériter de la transformation CSS automatique de Leaflet pendant les animations de pan (qui aurait doublé la transformation avec celle, manuelle, que `zoom.ts` continue d'écrire sur `#viewbox`).
- `src/components/zoom.ts` réécrit pour piloter cette instance Leaflet au lieu de d3-zoom, **signature publique inchangée à 100%** (`zoomTo`, `resetZoom`, `panMap`, `setMapZoom`, `changeMapZoom`, `setZoomExtent`, `constrainZoom`, `setTranslateExtent`, `applyZoomBehavior`, `invokeActiveZooming`) — aucun des ~35 points d'appel dans le reste de l'app n'a changé. Chaque fonction d3 a un équivalent Leaflet direct sur son API publique stable (`map.flyTo`/`setView` pour les transitions, `map.panBy`, `map.setZoom`, `map.setMinZoom`/`setMaxZoom`, `map.setMaxBounds`) — aucun accès aux internes de Leaflet nécessaire. Le mécanisme de synchronisation par frame (écrire `translate/scale` sur `#viewbox`, redessiner `scaleBar`/`coordinates`, notifier la minimap) est **inchangé**, juste réalimenté par `map.latLngToContainerPoint(L.latLng(0,0))`/`map.getZoom()` au lieu de l'event `D3ZoomEvent`.
- **Bug de test réel trouvé et corrigé** : `leaflet`'s propre code (`Browser.js`) lit `document.documentElement.style` à l'import, ce qui plante sous l'environnement de test `node` minimal du projet (`src/test-setup.ts`, sans DOM réel, choisi pour la vitesse). Corrigé en mockant `leaflet` dans `heightmap-editor.test.ts` (le seul autre fichier de test qui importait `zoom.ts` transitivement sans avoir besoin de son comportement réel).
- `zoom.test.ts` (qui, lui, teste vraiment `zoom.ts`) réécrit avec un **faux Leaflet déterministe** (`vi.mock("@/components/leaflet-map", ...)`) plutôt que le vrai Leaflet sous jsdom — jsdom n'a pas de vraie mise en page (taille de conteneur, timing d'animation), ce qui rendait le comportement d'un vrai `L.Map` non déterministe en test. Les 4 tests couvrent le même comportement qu'avant (mise à jour de `viewport`, écriture de la transformation sur `#viewbox`, planification du culling par frame vs. à la fin du geste).
- **Vérifié** : `tsc --noEmit` propre, lint propre, 1024/1024 tests passent, build Vite complet (CSS de Leaflet correctement empaqueté dans le bundle principal — confirmé par grep sur le CSS de sortie).

**Couche `biomes` convertie et vérifiée** — la première vraie couche `L.geoJSON()` de la migration, et un gabarit réutilisable pour les suivantes :
- `src/renderers/leaflet/territory-geojson.ts` (nouveau) : `buildTerritoryFeatureCollection(getType)` — réutilise `getIsolines(pack, getType, { polygons: true })` telle quelle (déjà exactement les anneaux `[x,y]` nécessaires, zéro nouveau code de géométrie) et les enveloppe en `MultiPolygon` GeoJSON, coordonnées brutes (pas `toGeoCoordinates`, cohérent avec la décision SRID 0). Compromis documenté : pas d'équivalent au "water gap" (bordure partielle uniquement côté terre) — les couches converties n'ont pas de bordure du tout pour l'instant.
- `src/renderers/leaflet/territory-layer.ts` (nouveau) : `createTerritoryLayer(paneName, zIndex, idPrefix)` — un `L.geoJSON` persistant, recréé/rafraîchi via `clearLayers()` + `addData()` à chaque `update()` plutôt que reconstruit de zéro (évite de perdre l'instance à chaque redraw). Après chaque rendu, **retague chaque `<path>` Leaflet avec `id="{idPrefix}{featureId}"`** (via `layer.getElement()` sur chaque sous-couche, une fois `addData` retourné — pas via `onEachFeature`, appelé trop tôt, avant que Leaflet ait créé l'élément DOM) — exactement pour que l'ancien code d'éditeur qui cible un territoire par id continue de le trouver — à condition qu'il le cherche comme descendant plutôt que comme enfant direct du conteneur (`#provs > #province5` ne marche plus ; `#province5` seul suffit, l'id étant déjà unique).
- **`src/components/leaflet-map.ts`** : ajout de `getFeaturePane(name, zIndex)` — un pane Leaflet standard (enfant du pane interne de Leaflet, donc pleinement animé/reprojeté par Leaflet lui-même), par opposition au pane `legacySvg` (délibérément un enfant direct du conteneur, sans transformation automatique). Comme `legacySvg` a été ajouté au conteneur *après* le pane interne de Leaflet, il peint par-dessus tout pane créé ici, quel que soit son `zIndex` — `zIndex` n'ordonne les couches converties qu'entre elles.
- **`src/components/layers.ts`** : `LayerParams.parent` gagne une 3ᵉ valeur, `"leaflet"` ; `Layer.getEl()` est élargi à `HTMLElement | SVGElement` (un pane est un `<div>`, pas un `<g>`). `LayersRegistry.init()` ne crée plus de `<g>`/ne réattache rien pour ces couches — il appelle un nouveau hook `LayerParams.ensurePane?.()` puis se contente de la visibilité. **Bug réel trouvé et corrigé pendant cette passe** : `ensurePane` doit tourner dès `init()` (au boot), pas seulement au premier `draw()` — sinon la toute première fois qu'un utilisateur active la couche (`Layers.show("biomes")`), `change()` appelle `setVisible(layer.getEl(), true)` *avant* `draw()`, et `getEl()` ne trouve rien puisque le pane n'a encore jamais été créé → `element.style.display = ...` plante sur `null`.
- `src/renderers/draw-biomes.ts` : `drawBiomes()`/`eraseBiomes()`/`ensureBiomesPane()` réécrits sur `createTerritoryLayer`, plus de manipulation SVG directe.
- `src/controllers/biomes-editor.ts` : les 2 lookups de surlignage au survol (`#biomes > #biome{id}`, combinateur enfant direct) simplifiés en `#biome{id}` — l'id est déjà unique, pas besoin de l'ancêtre. `biomeChangeColor` n'a pas eu besoin de changer : il passe déjà par un `Layers.draw("biomes")` complet, pas par un patch DOM direct — c'est justement pourquoi biomes a été choisi en premier (provinces/cultures/religions font, eux, du patch direct pour la recoloration en direct, d'où le report ci-dessous).
- **Bug systémique de test découvert et corrigé** : dès que `layers.ts` importe une couche qui touche Leaflet (même indirectement), *tout* fichier de test import ant `layers.ts`, même transitivement, hérite du crash `document.documentElement.style` sous l'environnement de test `node` minimal — 7 fichiers supplémentaires touchés cette fois (`biomes-editor.test.ts`, `label-spread-*.test.ts` ×3, `route-editor.test.ts`, `styles.test.ts`, `styles-legacy.test.ts`), aucun ne testant quoi que ce soit lié au rendu. Corrigés avec le même mock ciblé que `heightmap-editor.test.ts` (`vi.mock("leaflet", () => ({ extend: Object.assign, CRS: { Simple: {} } }))`) — mais ce motif va probablement se répéter à chaque nouvelle couche convertie ; un helper de mock partagé serait plus soutenable qu'un copier-coller par fichier, pas fait faute de temps.
- **Vérifié** : `tsc --noEmit` propre, lint propre, 1024/1024 tests passent, build Vite complet.
- **Reste à vérifier par un humain** : biomes se dessine et se surligne correctement dans un vrai navigateur — rien de tout ceci n'a été vu s'afficher réellement.

**Ce qui reste, explicitement pas encore fait** :
1. `provinces`/`cultures`/`religions`/`states` — même gabarit que `biomes`, mais chacun couplé à son éditeur : `provinces-editor.ts`, `cultures-editor.ts`, `religions-editor.ts` requêtent les tracés individuels par id pour la recoloration en direct (patch `.attr("fill", ...)` sur l'élément existant, pas un `Layers.draw()` complet) et le nettoyage à la suppression, en plus du survol — ces trois-là demandent d'adapter l'éditeur en même temps que le rendu, pas juste le rendu. `states-editor.ts`/`draw-states.ts` a en plus son propre effet de halo (`<clipPath>` + `<use href="#state{id}">`) sans équivalent Leaflet direct, non revalidé.
2. `rivers`/`routes`/`burgs`/`marqueurs` : pas de simple portage — `draw-rivers.ts` a son propre polygone en ruban à largeur variable (pas une simple `LineString`), la coloration par bassin, le culling `ViewportLayers`, et le re-rendu incrémental d'une seule rivière en cours d'édition ; à budgéter comme des réécritures, pas des conversions mécaniques.
3. La délégation de clics (`viewbox-events.ts`) pour `rivers`/`routes`/`burgIcons`/`markers` vers des clics natifs par-feature Leaflet, une fois ces couches converties.
4. La reconstruction de la minimap (`src/controllers/minimap.ts`) : sa technique actuelle (`<use href="#viewbox">`) ne reflèterait plus les couches converties, puisqu'elles ne vivraient plus dans `#viewbox`.
5. `measurers-editor.ts`/`draw-coordinates.ts` (règle, graticule) : **pas d'impact prévu** — leur maths passe par le CTM de `#viewbox`, qui reste valide puisque `#viewbox` continue d'exister et d'être transformé par `zoom.ts`, inchangé.
6. `viewport-renderer.ts` (culling maison) : **pas de suppression prévue** contrairement à l'idée initiale du plan — il reste nécessaire pour les couches qui restent dans `#viewbox`, puisque Leaflet ne peut pas nativement culler un sous-arbre SVG géré à la main qu'il ne connaît pas.
7. `label-spread.ts` : à ajuster une fois `burgIcons` converti (ses calculs de bornes d'icônes visent aujourd'hui `#viewbox`).
8. `services/io/auto-update.ts` : à vérifier une fois `rivers`/`routes` convertis — si leur rendu ne passe plus du tout par `<path id="river{i}">` dans `#viewbox`, ses 4 blocs de migration legacy (qui lisent ces éléments) auront besoin d'un rendu de secours isolé, hors-écran.

**Vérification** : chaque couche migrée comparée visuellement à l'ancien rendu SVG sur la même carte ; chaque outil interactif (règle, minimap, placement de labels) testé manuellement pour retrouver son comportement — c'est la phase où une vérification humaine en navigateur est la plus indispensable, aucune suite automatisée ne couvre ce niveau de détail visuel/interactif.

### Phase 6 — Retrait du format legacy (nouvelles cartes seulement)

Une fois la Phase 3 validée, les nouvelles cartes n'ont plus besoin du format positionnel `\r\n` de `save.ts` comme vérité — reformuler l'export `.map` comme une fonctionnalité "télécharger une sauvegarde/un instantané partageable" généré depuis Postgres à la demande, pas la source de vérité. Les anciens fichiers `.map` restent chargeables pour toujours via `load.ts` et sa logique de réparation existante — ne jamais tenter de faire disparaître ce chemin, c'est le seul accès aux données des utilisateurs existants.

---

## Schéma Postgres/PostGIS (concret)

Toutes les colonnes géométrie : SRID 0, indexées GiST. Tables d'entités clées `(map_id, id)` où `id` réutilise l'id assigné par FMG lui-même.

- **`maps`** — `id` PK, `name`, `seed`, `meta` (jsonb), `facts` (jsonb — graph size, geography, climate, cultures.set, lore, units, style preset, coastline, etc. — tout le bloc `facts` de `future-data-model.md`), `layers` (jsonb), `style` (jsonb), `created_at`, `updated_at`.
- **`map_cells`** — `(map_id, cell_id)` PK, `geom geometry(Polygon,0)`, `height`, `biome_id`, `state_id`, `province_id`, `culture_id`, `religion_id`, `population`, `neighbors int[]`.
- **`map_states`** — `(map_id, state_id)` PK, `name`, `color`, `culture_id`, `capital_burg_id`, `form`, `geom geometry(MultiPolygon,0)`.
- **`map_provinces`** — `(map_id, province_id)` PK, `state_id` FK, `name`, `color`, `geom geometry(MultiPolygon,0)`.
- **`map_cultures`** — `(map_id, culture_id)` PK, `name`, `color`, `geom geometry(MultiPolygon,0)`.
- **`map_religions`** — `(map_id, religion_id)` PK, `name`, `type`, `color`, `geom geometry(MultiPolygon,0)`.
- **`map_burgs`** — `(map_id, burg_id)` PK, `name`, `cell_id`, `state_id`, `province_id`, `culture_id`, `religion_id`, `population`, `type`, `capital bool`, `port bool`, `geom geometry(Point,0)`.
- **`map_rivers`** — `(map_id, river_id)` PK, `name`, `type`, `discharge`, `width`, `geom geometry(LineString,0)`.
- **`map_routes`** — `(map_id, route_id)` PK, `group_name`, `geom geometry(LineString,0)`.
- **`map_markers`** — `(map_id, marker_id)` PK, `type`, `name`, `icon`, `geom geometry(Point,0)`.
- **`map_zones`** — `(map_id, zone_id)` PK, `type`, `geom geometry(MultiPolygon,0)`.
- **`map_annotations`** — `(map_id, id)` PK, `kind` (`note`|`ruler`), `data jsonb`.
- **`map_topology`** — `(map_id)` PK, `grid jsonb`, `pack jsonb` — tableaux bruts d'adjacence/vertex non capturés par la géométrie de `map_cells`, conservés pour fidélité exacte (les chemins Keep/Risk/Resample de l'éditeur de heightmap mutent ceci hors pipeline — ne pas supposer que c'est reproductible depuis seed+facts seuls).

## Surface API

- `GET /api/maps` — liste (id, name, seed, createdAt).
- `POST /api/maps` — génère (corps calqué sur `options.generation`), tourne le pipeline côté serveur, réponse synchrone (pas de file d'attente nécessaire en local mono-utilisateur, sauf si le temps de génération l'impose).
- `GET /api/maps/:id` — `meta`/`facts`/`layers`/`style`.
- `GET /api/maps/:id/layers/:layer.geojson` — un `FeatureCollection` par couche.
- `GET /api/maps/:id/entities/tree` — hiérarchie imbriquée pour la barre latérale du wiki.
- `GET /api/maps/:id/entities/:kind/:id` — détail d'une entité (vue wiki + préremplissage `map_ref`).
- `PATCH /api/maps/:id/entities/:kind/:id` — édition manuelle post-génération.
- `DELETE /api/maps/:id`.

---

## Fichiers critiques

- `src/generators/pipeline.ts`, `src/generators/generation-pipeline.ts` — le runner à invoquer côté serveur (Phase 3).
- `src/services/io/export.ts` — les exporteurs GeoJSON à porter dans l'ETL Postgres (Phase 1).
- `docs/architecture/future-data-model.md`, `docs/architecture/configuration.md` — les contrats de schéma/scope de config à refléter dans les tables et payloads API.
- `src/wiki-main.ts`, `src/wiki/entities.ts`, `src/wiki/eras.ts` — logique de chargement/routage/ères à rendre asynchrone et hybride (Phase 4).
- `src/components/layers.ts`, `src/components/zoom.ts`, `src/components/viewbox-events.ts` — API publiques à réimplémenter contre Leaflet (Phase 5).
- `src/services/url-params.ts`, `src/components/idle-state.ts`, `src/components/lifecycle.ts` (`regeneratePrompt`/`regenerateMap`) — le changement de la Phase 0 (fait).
- `vite.config.ts` — les deux points d'entrée à fusionner en Phase 4.
- `docker-compose.yml`, `server/db/schema.sql`, `server/scripts/import-map.mjs`, `server/README.md` — la Phase 1 (fait).
- `server/src/import.mjs`, `server/src/db.mjs`, `server/src/routes/maps.mjs`, `server/src/server.mjs` — la Phase 2 (fait).
- `src/services/io/export-json.ts`'s `getPackDataJson()`/`getPackCellsData()` — la source de données réellement utilisée par l'ETL (voir Phase 1), pas les exporteurs GeoJSON de `export.ts`.
- `server/src/generation/browser-shim.ts`, `generate.ts`, `pack-to-json.ts`, `heightmap-image-loader.ts`, `server/scripts/generate-map.ts`, `compare-with-browser.ts` — la Phase 3 (fait).
- `src/generators/heightmap-generator.ts` — seul fichier de `src/` modifié pour la Phase 3 (chargeur d'image rendu remplaçable, comportement navigateur inchangé).

## Notes de risque global

- Le plus gros poste de risque et d'effort est de loin la **Phase 5 (Leaflet)** — environ 85-90 fichiers touchent des API SVG directement, contre un seul vrai blocage pour le portage serveur de la génération. À budgéter en conséquence : c'est réalistement le chantier le plus long du plan, largement devant la mise en place de Postgres elle-même.
- Chaque phase a une vérification qui lui est propre ; à partir de la Phase 5, une vérification manuelle en navigateur devient indispensable (le projet a pour règle de ne jamais lancer Playwright automatiquement) — prévoir des passes de test manuel dédiées, pas seulement `tsc`/lint/build/tests unitaires.
