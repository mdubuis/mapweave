// Mapweave — forked from Azgaar's Fantasy Map Generator (2017-2024). MIT License.
// https://github.com/mdubuis/mapweave

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
