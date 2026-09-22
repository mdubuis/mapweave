import { fileURLToPath, URL } from "node:url";

/**
 * The desktop app ships the same renderer, minus the parts that only make sense on the web:
 * Google Analytics (a program that phones home on launch is a different bargain than a web page),
 * and the PWA plumbing, which `services/platform.ts` already skips under Electron
 */
const stripWebOnlyTags = {
  name: "strip-web-only-tags",
  transformIndexHtml: (html: string) =>
    html
      .replace(/<script async src="https:\/\/www\.googletagmanager\.com[^>]*><\/script>\s*/, "")
      .replace(/<script>\s*window\.dataLayer[\s\S]*?<\/script>\s*/, "")
      .replace(/<link rel="manifest"[^>]*>\s*/, "")
};

export default ({ mode }: { mode: string }) => ({
  root: "./src",
  base: mode === "electron" ? "./" : process.env.NETLIFY ? "/" : "/Fantasy-Map-Generator/",
  plugins: mode === "electron" ? [stripWebOnlyTags] : [],
  build: {
    outDir: mode === "electron" ? "../dist-electron/renderer" : "../dist",
    assetsDir: "./",
    emptyOutDir: true, // outDir sits outside root, so Vite would otherwise keep every past build's chunks
    rollupOptions: {
      input: {
        // index.html is the sole entry — the whole app (wiki + map + board), one shell, one
        // document. map.html is no longer a standalone page: its markup ships bundled instead
        // (see src/services/map-engine-host.ts's `?raw` import) and is hosted inside a Shadow DOM
        // element within this same page. See MAPWEAVE.md's Phase 6 "Phase 3" single-DOM-merge entry.
        wiki: fileURLToPath(new URL("./src/index.html", import.meta.url))
      }
    }
  },
  publicDir: "../public",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
