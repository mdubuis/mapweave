/**
 * Minimal browser-API shim so the real client generator modules (src/generators/**) can run
 * unmodified under Node — same approach the project's own src/test-setup.ts already proves works
 * (1000+ unit tests exercise this exact code path today, in plain Node, no jsdom/Playwright). This
 * is not a copy of that file: it's a smaller, server-specific set of stubs, since a generation run
 * doesn't need every DOM affordance a UI unit test might.
 *
 * Import this BEFORE anything from src/, and only once per process.
 */
const g = globalThis as Record<string, unknown>;

if (typeof g.window === "undefined") g.window = globalThis; // src/components/globals.ts etc. read/write window.X

// No real URL server-side: a fixed, param-less location means the "pinned options" (?options=
// default) and similar URL-driven behavior stay off, which is the right default for a generation
// request that arrives as a plain API payload, not a page load.
if (typeof g.location === "undefined") g.location = new URL("http://localhost/");

if (typeof g.document === "undefined") {
  g.document = {
    readyState: "complete",
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} })
  };
}

if (typeof g.Node === "undefined") {
  g.Node = { prototype: { addEventListener: () => {}, removeEventListener: () => {} } };
}

if (typeof g.localStorage === "undefined") {
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  };
}

for (const flag of ["INFO", "TIME", "ERROR", "WARN", "DEBUG"]) {
  if (typeof g[flag] === "undefined") g[flag] = false;
}

if (typeof (g.window as Record<string, unknown>).tip === "undefined") (g.window as Record<string, unknown>).tip = () => {};
if (typeof (g.window as Record<string, unknown>).clearMainTip === "undefined") {
  (g.window as Record<string, unknown>).clearMainTip = () => {};
}
if (typeof (g.window as Record<string, unknown>).dispatchEvent === "undefined") {
  (g.window as Record<string, unknown>).dispatchEvent = () => true;
}

export async function loadGenerationEngine(): Promise<void> {
  // aleaPRNG is normally window.aleaPRNG from the vendored public/libs/alea.min.js <script> tag
  // (a classic script, outside the ES module graph — an import can't pick it up). The npm `alea`
  // package several generators already import directly (e.g. src/generators/grid-generator.ts) is
  // the same algorithm, so it stands in here.
  if (typeof g.aleaPRNG === "undefined") {
    const { default: Alea } = await import("alea");
    g.aleaPRNG = Alea;
  }

  // FlatQueue (a priority queue used by cultures/states expansion) is the same kind of vendored
  // <script> global as aleaPRNG above — but this one is UMD and detects CommonJS, so the exact
  // file the browser uses loads here unmodified instead of needing a substitute package.
  if (typeof g.FlatQueue === "undefined") {
    const { default: FlatQueue } = await import("../../../public/libs/flatqueue.js");
    g.FlatQueue = FlatQueue;
  }

  await import("@/components/globals"); // globalThis.grid/pack/customization
  const { Options } = await import("@/components/options-model");
  g.options ??= Options.getDefaultOptions();
  await import("@/utils"); // registers shared helpers (rn, gauss, ...) some generators call as bare globals
  await import("@/generators"); // registers every generator (Grid, Pack, Cultures, ...) as window.X

  // The one generator with real browser-API usage on the pipeline path (Canvas/Image, for
  // precreated heightmap PNGs) — swap in the sharp-based loader. See heightmap-image-loader.ts.
  const { setHeightmapImageLoader } = await import("@/generators/heightmap-generator");
  const { sharpHeightmapImageLoader } = await import("./heightmap-image-loader.ts");
  setHeightmapImageLoader(sharpHeightmapImageLoader);
}
