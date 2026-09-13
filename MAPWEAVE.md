# Mapweave — vision & roadmap

This fork of Azgaar's Fantasy Map Generator is being extended into a worldbuilding platform. FMG's own conventions (CONTEXT.md, CLAUDE.md/AGENTS.md, docs/) still apply to everything under `src/` — this file only adds the layer above them. Three pillars:

1. **Map** — the existing FMG procedural engine (Voronoi, hydrology, climate, cultures), kept as a reliable black box. Do not rewrite the generation pipeline; build on top of it.
2. **Lore wiki** — Markdown files with YAML frontmatter, wikilink-style cross-references (`[[entity]]`), and a resolved link graph for navigation.
3. **Bidirectional link** — map entities (burgs, states, markers) link to their wiki page; wiki pages link back to their map location.
4. *(later)* **Timeline** — multiple eras of the same world, with entities/borders/settlements changing between eras without duplicating everything.

## Gating rule

Phases run in order. As of 2026-09-13 the user has authorized working through phases autonomously without stopping for per-phase or per-step confirmation — proceed and log decisions here as they're made, report progress at natural checkpoints, but don't block on approval. The one exception: the Phase 4 temporal data model is flagged as the most structurally significant decision in the project (per the original brief) and deserves a clear callout even under this autonomy grant, so a bad call there doesn't get compounded silently.

## Phases

- **Phase 0 — Setup** (this file, `.claude/` config, workflow). Status: **done.**
- **Phase 1 — Repo cleanup**: classify what's essential to generation/rendering vs. optional (Electron build, Nix, misc scripts/docs) vs. dead; delete and verify `npm run build` + local run still work. Status: **done** — see decisions log for what was removed/kept.
- **Phase 2 — Wiki engine**: Markdown schema for lore entities + frontmatter (reserves a `map_ref` field for phase 3), wikilink resolution, relation graph, minimal read/edit UI. **Present the file schema for approval before writing the engine.**
- **Phase 3 — Map ↔ wiki linking**: extend map popups (burgs/states/markers) with a link to the matching wiki page via `map_ref`; reverse link from wiki to map (check FMG's URL params first — may already support centering/zooming). Missing wiki page → offer to create one, never crash.
- **Phase 4 — Timeline**: propose a temporal-validity data model (map side and wiki side) for approval before implementing — this is the most structural decision in the project. Then handle entity changes between eras (destroyed city, moved border, faction appearing/disappearing) without needless duplication, and an era-selector UI that filters both map and wiki.

## End-of-phase reporting

Each phase closes with: what changed, what was validated (build/lint/tests run and their result), open questions, and an explicit request to proceed. No phase is silently continued.

## Decisions log

- 2026-09-13 — Project setup: added `.claude/settings.json` permission allowlist for `npm run dev/build/lint/test` (not `test:e2e`, per CONTEXT.md's "never run Playwright automatically"); added `.claude/agents/repo-archaeologist.md` for Phase 1 classification; added `.claude/commands/phase-checkpoint.md` for end-of-phase reports.
- 2026-09-13 — User dropped the per-phase approval gate: proceed autonomously through phases, report progress, don't block on confirmation. Flagged exception: still surface the Phase 4 temporal model clearly rather than silently deciding it.
- 2026-09-13 — Initialized git (repo had none) with a baseline commit before any deletion, so cleanup is reversible. Added remote `origin` → `git@github.com:mdubuis/mapweave.git`; pushing periodically going forward.
- 2026-09-13 — **Phase 1 cleanup done.** Removed via `repo-archaeologist` audit + judgment: Electron desktop packaging (`electron/`, `electron-builder.yml`, `build/icon.png`, related scripts/workflows/deps) and Nix packaging (`nix/`, `flake.*`, its workflow) — out of scope for a web-only map+wiki tool; Docker/Netlify alternate deploy paths (unused, GH Pages `deploy.yml` is the real one); upstream-only automation that can't run on a fork (`board-reconcile`, `theme-classify`, `sync-wiki` scripts+workflows); OSS community boilerplate (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/discussion templates, `FUNDING.yml`, `copilot-instructions.md`); dead files (`.serena/`, `pw.q.config.ts`, `scripts/convert-style-presets.mjs`); historical changelogs (`docs/updates/`); the "Ask FMG" desktop-app download offer (`src/services/app-offer.ts` + its wiring in `about-tab.ts`/`versioning.ts`/`services/index.ts`) since it pointed at Azgaar's own release feed and installer artifacts that no longer exist for this fork.
  - **Kept deliberately**: actual FMG editing features named as removal candidates in the audit (battle simulator, GIS export, Ollama text generation, military forces/journeys) — removing them cleanly would require touching the 9K-line `src/index.html` monolith that CONTEXT.md explicitly flags as risky to restructure, and they're not clearly out of scope for a worldbuilding tool. Also kept `docs/wiki/*.md` (pure reference docs, zero build/bundle cost). Also left the internal `isElectron()`/`window.electron` runtime feature-detection in `platform.ts`/`shell.ts`/`assistant.ts`/`io/cloud.ts` alone — with no Electron shell anymore it deterministically returns false, which is correct web behavior, not a bug; ripping it out everywhere was judged as unnecessary refactor beyond cleanup scope.
  - **Verified**: `npm install` (lockfile resync), `npm run build`, `npm run lint`, `npm run test` (975/975 passing), and a local `npm run dev` smoke check all pass after cleanup.
  - **Not yet rebranded**: README.md, `about-tab.ts` community links (Discord/Reddit/Patreon/upstream changelog wiki) still describe upstream Azgaar/FMG — left untouched since that's a branding decision, not a cleanup one.
