import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectReachable, extractIds, resolveImportSpecifier, runAudit } from "./audit-id-collisions.mjs";

function makeProject(files) {
  // Directory name includes accented characters on purpose: this repo lives under a path
  // containing them (/home/.../Téléchargements/...), and an earlier version of this script's
  // CLI-entry check silently broke under exactly that condition (file:// URL vs. raw argv[1]
  // string mismatch on non-ASCII paths) — caught only by actually running the CLI, not by tests
  // against an ASCII temp dir. Keeping a non-ASCII fixture path guards against that regressing.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-idé-"));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

test("extractIds finds ids via every known access pattern", () => {
  const content = `
    const a = '<div id="from-html"></div>';
    el.id = "from-assignment";
    document.getElementById("from-getElementById");
    ensureEl("from-ensureEl");
    ensureEl<HTMLButtonElement>("from-ensureEl-generic");
    findEl("from-findEl");
    document.querySelector("#from-querySelector");
    $("#from-jquery");
  `;
  assert.deepEqual(
    [...extractIds(content)].sort(),
    [
      "from-assignment",
      "from-ensureEl",
      "from-ensureEl-generic",
      "from-findEl",
      "from-getElementById",
      "from-html",
      "from-jquery",
      "from-querySelector"
    ].sort()
  );
});

test("resolveImportSpecifier resolves the @/ alias against the given root", () => {
  const root = makeProject({ "src/utils/thing.ts": "export const x = 1;" });
  const resolved = resolveImportSpecifier("@/utils/thing", path.join(root, "src/main.ts"), path.join(root, "src"));
  assert.equal(resolved, path.join(root, "src/utils/thing.ts"));
});

test("resolveImportSpecifier resolves a relative import against the importing file's directory", () => {
  const root = makeProject({ "src/a/one.ts": "", "src/a/two.ts": "" });
  const resolved = resolveImportSpecifier("./two", path.join(root, "src/a/one.ts"), path.join(root, "src"));
  assert.equal(resolved, path.join(root, "src/a/two.ts"));
});

test("resolveImportSpecifier returns null for a bare npm package specifier", () => {
  const root = makeProject({});
  assert.equal(resolveImportSpecifier("d3", path.join(root, "src/main.ts"), path.join(root, "src")), null);
});

test("collectReachable follows imports transitively but stops at bare specifiers", () => {
  const root = makeProject({
    "src/main.ts": 'import { b } from "./b";\nimport "d3";',
    "src/b.ts": 'import { c } from "@/c";',
    "src/c.ts": "export const c = 1;"
  });
  const reachable = collectReachable(path.join(root, "src/main.ts"), path.join(root, "src"));
  assert.deepEqual(
    [...reachable].map(f => path.relative(root, f)).sort(),
    ["src/b.ts", "src/c.ts", "src/main.ts"]
  );
});

test("runAudit reports zero collisions when the two entries share no ids", () => {
  const root = makeProject({
    "src/main.ts": "",
    "src/map.html": '<button id="map-only"></button>',
    "src/wiki-main.ts": "",
    "src/index.html": '<div id="wiki-only"></div>'
  });
  const { collisions, mapIds, wikiIds } = runAudit(root);
  assert.deepEqual(collisions, []);
  assert.ok(mapIds.has("map-only"));
  assert.ok(wikiIds.has("wiki-only"));
});

test("runAudit reports a real collision when both entries use the same literal id", () => {
  const root = makeProject({
    "src/main.ts": "",
    "src/map.html": '<div id="shared"></div>',
    "src/wiki-main.ts": "",
    "src/index.html": '<div id="shared"></div>'
  });
  const { collisions } = runAudit(root);
  assert.deepEqual(collisions, ["shared"]);
});

test("runAudit follows each entry's own import graph, not the other's", () => {
  const root = makeProject({
    "src/main.ts": 'import "./map-only-module";',
    "src/map-only-module.ts": 'ensureEl("only-in-map-graph");',
    "src/map.html": "",
    "src/wiki-main.ts": "",
    "src/index.html": ""
  });
  const { mapIds, wikiIds, collisions } = runAudit(root);
  assert.ok(mapIds.has("only-in-map-graph"));
  assert.ok(!wikiIds.has("only-in-map-graph"));
  assert.deepEqual(collisions, []);
});
