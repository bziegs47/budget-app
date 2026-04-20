/**
 * Rasterize wordmark SVGs to PNG for general use (slides, docs, email).
 * SVG sources stay authoritative for edits and future app-icon work.
 */
import sharp from "sharp";
import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const [W, H] = [360, 112];
const aspect = H / W;

/** @type {{ out: string; svg: string; width: number }[]} */
const jobs = [
  {
    svg: join(root, "public", "logo-wordmark.svg"),
    out: join(root, "public", "logo-wordmark.png"),
    width: 1440,
  },
  {
    svg: join(root, "public", "logo-wordmark-on-dark.svg"),
    out: join(root, "public", "logo-wordmark-on-dark.png"),
    width: 1440,
  },
  {
    svg: join(root, "public", "logo-wordmark-mimo.svg"),
    out: join(root, "public", "logo-wordmark-mimo.png"),
    width: 1440,
  },
  {
    svg: join(root, "public", "logo-wordmark-mimo-on-dark.svg"),
    out: join(root, "public", "logo-wordmark-mimo-on-dark.png"),
    width: 1440,
  },
];

for (const { svg, out, width } of jobs) {
  const buf = await readFile(svg);
  const height = Math.round(width * aspect);
  await sharp(buf)
    .resize(width, height)
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`Wrote ${out} (${width}×${height})`);
}
