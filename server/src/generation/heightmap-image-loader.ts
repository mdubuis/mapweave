/**
 * Server-side substitute for heightmap-generator.ts's browser image loader (Canvas/Image, which
 * don't exist in Node) — see MIGRATION.md Phase 3 and setHeightmapImageLoader's own doc comment.
 *
 * Caveat worth keeping in mind, not hiding: sharp/libvips's resize algorithm is not guaranteed to
 * be pixel-identical to the browser Canvas's `drawImage` scaling. Procedural heightmap templates
 * (pure math, no image resampling) are unaffected and will match a browser run exactly for the same
 * seed; only the ~23 *precreated* (image-based) templates carry this narrow divergence risk.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { HeightmapImageLoader } from "../../../src/generators/heightmap-generator.ts";

const heightmapsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../public/heightmaps");

export const sharpHeightmapImageLoader: HeightmapImageLoader = async (id, cellsX, cellsY) => {
  const { data, info } = await sharp(join(heightmapsDir, `${id}.png`))
    .resize(cellsX, cellsY, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 4) throw new Error(`Expected 4 (RGBA) channels from sharp, got ${info.channels}`);
  return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
};
