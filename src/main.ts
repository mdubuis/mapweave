// Mapweave — forked from Azgaar's Fantasy Map Generator (2017-2024). MIT License.
// https://github.com/mdubuis/mapweave
//
// No longer the live boot entry since the Phase 6 single-DOM merge (see MAPWEAVE.md) — map.html
// is no longer a document Vite serves, so this file's own <script> tag in it never runs. It stays
// as the canonical reference list of what the map engine needs on boot: services/map-engine-
// host.ts's bootEngine() replicates this exact import list (via dynamic import(), for lazy-
// loading) plus a DOMContentLoaded-safe call to boot() instead of this file's own listener, which
// would never fire there — the shell's own DOMContentLoaded has already happened by the time the
// map route is entered. scripts/audit-id-collisions.mjs also still traces reachability from here,
// since it's plain static imports (this regex-based audit doesn't follow dynamic import() calls).

import "@/services/logging";
import "@/components/globals";
import "@/components/options/tabs";

import "@/utils";
import "@/data/heightmap-templates";
import "@/data/precreated-heightmaps";
import "@/generators";
import "@/renderers";
import "@/components";
import "@/controllers";
import "@/services";
import "@/generators/styles-legacy";

import { boot } from "@/components/lifecycle";

document.addEventListener("DOMContentLoaded", boot);
