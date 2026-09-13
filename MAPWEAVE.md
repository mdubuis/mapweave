# Mapweave — vision & roadmap

This fork of Azgaar's Fantasy Map Generator is being extended into a worldbuilding platform. FMG's own conventions (CONTEXT.md, CLAUDE.md/AGENTS.md, docs/) still apply to everything under `src/` — this file only adds the layer above them. Three pillars:

1. **Map** — the existing FMG procedural engine (Voronoi, hydrology, climate, cultures), kept as a reliable black box. Do not rewrite the generation pipeline; build on top of it.
2. **Lore wiki** — Markdown files with YAML frontmatter, wikilink-style cross-references (`[[entity]]`), and a resolved link graph for navigation.
3. **Bidirectional link** — map entities (burgs, states, markers) link to their wiki page; wiki pages link back to their map location.
4. *(later)* **Timeline** — multiple eras of the same world, with entities/borders/settlements changing between eras without duplicating everything.

## Gating rule

Phases run in order. **Never start the next phase without the user's explicit go-ahead on the current one.** When an architecture choice is ambiguous, ask — don't decide unilaterally. Log decisions below as they're made so context survives across sessions.

## Phases

- **Phase 0 — Setup** (this file, `.claude/` config, workflow). Status: **in progress, awaiting validation.**
- **Phase 1 — Repo cleanup**: classify what's essential to generation/rendering vs. optional (Electron build, Nix, misc scripts/docs) vs. dead. Present the removal list with reasons; wait for approval; then delete and verify `npm run build` + local run still work.
- **Phase 2 — Wiki engine**: Markdown schema for lore entities + frontmatter (reserves a `map_ref` field for phase 3), wikilink resolution, relation graph, minimal read/edit UI. **Present the file schema for approval before writing the engine.**
- **Phase 3 — Map ↔ wiki linking**: extend map popups (burgs/states/markers) with a link to the matching wiki page via `map_ref`; reverse link from wiki to map (check FMG's URL params first — may already support centering/zooming). Missing wiki page → offer to create one, never crash.
- **Phase 4 — Timeline**: propose a temporal-validity data model (map side and wiki side) for approval before implementing — this is the most structural decision in the project. Then handle entity changes between eras (destroyed city, moved border, faction appearing/disappearing) without needless duplication, and an era-selector UI that filters both map and wiki.

## End-of-phase reporting

Each phase closes with: what changed, what was validated (build/lint/tests run and their result), open questions, and an explicit request to proceed. No phase is silently continued.

## Decisions log

- 2026-09-13 — Project setup: added `.claude/settings.json` permission allowlist for `npm run dev/build/lint/test` (not `test:e2e`, per CONTEXT.md's "never run Playwright automatically"); added `.claude/agents/repo-archaeologist.md` for Phase 1 classification; added `.claude/commands/phase-checkpoint.md` for end-of-phase reports.
