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
| 4 | Le wiki devient la coquille hôte ; carte intégrée (encore en SVG) ; arborescence live | Phase 2 | Moyen | Oui, au système d'ères et aux `map_ref` — voir plus bas | À faire |
| 5 | Migration Leaflet, incrémentale, couche par couche | Phase 3 + Phase 4 | **Le plus élevé** (~85-90 fichiers) | Outils interactifs (règle, minimap, labels) les plus exposés | À faire |
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

### Phase 4 — Le wiki devient la coquille hôte ; arborescence live

Deux étapes, délibérément séparées de la Phase 5 pour ne jamais avoir "intégration à moitié cassée ET rendu à moitié cassé" en même temps :

1. **Bascule de coquille, même moteur de rendu.** `vite.config.ts` déclare aujourd'hui deux points d'entrée Rollup indépendants (`index.html`/`wiki.html`) sans runtime partagé — confirmé, `src/wiki/map-link.ts` le dit lui-même en commentaire. `wiki.html`/`wiki-main.ts` devient le point d'entrée unique ; la vue carte devient un panneau/une route à l'intérieur plutôt qu'`index.html` séparé. Le bundle de rendu SVG existant n'a pas besoin d'être réécrit à cette étape — il peut rester hébergé tel quel (même en iframe si besoin, juste inversé : wiki dehors, carte dedans), pendant que les *données* qu'il lit viennent progressivement de l'API plutôt que (ou en plus de) la génération client. Ça découple "la carte est dans la coquille wiki" de "la carte est rendue en Leaflet" — un retard sur la Phase 5 ne bloque jamais la livraison de l'intégration.
2. **Arborescence live** : `src/wiki/entities.ts`'s `loadEntities()` (synchrone, au build) reste pour les fichiers Markdown ; ajouter une source async `loadGeneratedEntities(mapId)` qui normalise les réponses API (burgs/states/provinces/religions/cultures/rivers/markers) dans la même forme `WikiEntity`, avec un slug synthétique déterministe (ex. `burg-142`) pour que les wikilinks à la main puissent cibler une entité générée avant même qu'elle ait un fichier. `wiki-main.ts`'s bootstrap synchrone devient async, fusionnant les deux sources avant le premier `render()` — bonne nouvelle : `buildGraph`, `buildSlugIndex`, le filtrage par ère, et les fonctions de rendu n'ont besoin d'aucun changement, ils opèrent déjà sur un `WikiEntity[]` plat, agnostique de la source une fois fusionné. L'arborescence elle-même vient d'un endpoint imbriqué (`GET /api/maps/:id/entities/tree`), pas de N+1 requêtes, avec expansion paresseuse dans la barre latérale (des centaines de burgs ne doivent pas se rendre d'un coup).

**Risque de rupture à traiter explicitement, pas en aparté** : le système d'ères (`src/wiki/eras.ts`) est aujourd'hui clé sur `Era.mapFile`/`WikiFrontmatter.map_file`, comparé à `?maplink=` (un nom de fichier) dans `currentEraSlug()`. Une fois qu'une ère vit dans Postgres comme ligne `maps`, il faut un champ jumeau `map_id`. Les fichiers wiki existants avec `map_file:` en frontmatter ont besoin soit d'une migration (ajouter `map_id:` une fois chaque ère legacy importée), soit d'une compatibilité acceptant les deux dans `currentEraSlug()`/`resolveEntityForEra()`. C'est une vraie surface de rupture, pas hypothétique — le système d'ères a été construit contre le modèle fichier et cette migration change ce qu'"une ère" *est*.

**Vérification** : les deux ères de démonstration (`wiki/eras/founding.md`, `post-war.md`) continuent de fonctionner après migration du champ ; une entité générée sans fichier apparaît dans l'arborescence, est cliquable, et l'action "développer en fiche" crée un vrai fichier `.md` pré-rempli.

### Phase 5 — Migration Leaflet, incrémentale, par ordre de risque croissant

1. **Couches d'affichage géométrique uniquement**, alimentées par les endpoints GeoJSON de la Phase 3 : biomes, états, provinces, cultures, religions, rivières, routes, burgs, marqueurs — via `L.geoJSON()` sur `L.svg()`. L'API publique de `src/components/layers.ts`'s `LayersRegistry` (show/hide/toggle/move/state/restore) est déjà agnostique du moteur de rendu dans sa forme — réimplémenter `Layer.getEl()`/`init()`/`move()` contre des panes Leaflet au lieu de l'ordre DOM `<g>`, en gardant les ~20 points d'appel dans toute l'app inchangés. Même chose pour `zoomTo(x,y,zoom,duration)` dans `src/components/zoom.ts` — sa signature publique est déjà basée sur des coordonnées, réimplémentable sur `map.setView`/`flyTo` sans toucher ses ~20 points d'appel.
2. **Délégation de clics** (`src/components/viewbox-events.ts`) : à réécrire, pas à porter — de "remonter 5 niveaux d'ancêtres DOM fixes" vers les événements de clic natifs par-feature de Leaflet (`layer.on('click', ...)`).
3. **Retrait du système de culling maison** (`src/renderers/viewport/viewport-renderer.ts`) — Leaflet fait ça nativement ; suppression, pas portage, une fois ses consommateurs migrés.
4. **Le cluster à plus haut risque, budgété comme réécritures complètes, pas comme portages** : `src/controllers/measurers-editor.ts` (règle), `src/controllers/minimap.ts`, `src/controllers/label-spread.ts` (le plus gros — tout un sous-système de conversion écran↔carte), `src/renderers/draw-coordinates.ts` (graticule décoratif — à question ouverte : a-t-il seulement besoin de survivre une fois les conventions natives de Leaflet en place ?). Aucun équivalent à `getScreenCTM()`/`matrixTransform` n'existe dans Leaflet — à réécrire depuis zéro contre `containerPointToLatLng`/`project`/`unproject`. Garder les anciennes versions SVG accessibles derrière un flag jusqu'à parité fonctionnelle de chacune.
5. `src/services/io/auto-update.ts` (migration des anciens fichiers `.map`, 4 usages de `getTotalLength`/`getPointAtLength`) : cas à part, ne tourne que lors du chargement d'un ancien fichier — peut garder un élément SVG caché/hors-écran juste pour ce calcul même après que le rendu live soit passé à Leaflet. Ne pas porter, isoler.

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
