/**
 * Runs the TypeScript head mask (src/lib/scalp/head-mask.ts) on every photo in
 * a manifest and writes a contact sheet to compare with the Python prototype's
 * masksheet.py. Each tile is the photo at 200 px wide, outlined in green with
 * the patch centre marked in red. Prints one line per photo.
 *
 *   bun run scripts/real-photo-eval/mask-sheet.ts .model-eval/hoff
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { headMask, patchCentre } from "../../src/lib/scalp/head-mask";
import { resizeRgb, type RgbImage } from "../../src/lib/scalp/rgb";
import type { Mask } from "../../src/lib/scalp/image-ops";
import { hstack, readRgb, vstack, writeJpeg } from "./images";

const root = process.argv[2] ?? ".model-eval/hoff";
/** Same width as masksheet.py, so the two sheets are comparable. */
const WORK = 200;
const PER_ROW = 6;
const GREEN = [0, 255, 0];
const RED = [255, 0, 0];

/** Mask pixels with a 4-neighbour outside the mask; beyond the frame counts as outside. */
function outlineOf(mask: Mask): Uint8Array {
  const { width: w, height: h, data } = mask;
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i] === 0) continue;
      const onFrameEdge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const touchesOutside =
        data[i - 1] === 0 || data[i + 1] === 0 || data[i - w] === 0 || data[i + w] === 0;
      if (onFrameEdge || touchesOutside) edge[i] = 1;
    }
  }
  return edge;
}

/** Paints one pixel if it lies inside the image. */
function paint(img: RgbImage, x: number, y: number, colour: number[]): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data.set(colour, (y * img.width + x) * 3);
}

/** A 2-px green outline, and a 4-px red square at the patch centre. */
function drawTile(
  photo: RgbImage,
  mask: Mask,
  centre: { x: number; y: number } | null,
): RgbImage {
  const tile: RgbImage = { ...photo, data: new Uint8Array(photo.data) };
  const edge = outlineOf(mask);
  for (let y = 0; y < tile.height; y++) {
    for (let x = 0; x < tile.width; x++) {
      if (!edge[y * tile.width + x]) continue;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        paint(tile, x + dx, y + dy, GREEN);
      }
    }
  }
  if (centre) {
    const cx = Math.round(centre.x);
    const cy = Math.round(centre.y);
    for (let dy = -2; dy < 2; dy++) {
      for (let dx = -2; dx < 2; dx++) paint(tile, cx + dx, cy + dy, RED);
    }
  }
  return tile;
}

type Entry = { file: string; view: string };
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const photos: Entry[] = manifest.photos;
const tiles: RgbImage[] = [];

for (const photo of photos) {
  const full = readRgb(join(root, "images", photo.file));
  const rgb = resizeRgb(full, WORK);
  const { mask, skin } = headMask(rgb);
  const centre = patchCentre(skin, mask, 4);
  let inside = 0;
  for (const v of mask.data) inside += v;
  const area = (100 * inside) / mask.data.length;
  const patch = centre
    ? `patch ${((100 * centre.x) / rgb.width).toFixed(1)}% of width, ${((100 * centre.y) / rgb.height).toFixed(1)}% of height`
    : "patch none";
  console.log(`${photo.file}  mask ${area.toFixed(1)}% of frame  ${patch}`);
  tiles.push(drawTile(rgb, mask, centre));
}

const rows: RgbImage[] = [];
for (let i = 0; i < tiles.length; i += PER_ROW) {
  rows.push(hstack(tiles.slice(i, i + PER_ROW)));
}
const sheet = vstack(rows);
const outDir = join(root, "proto");
mkdirSync(outDir, { recursive: true });
writeJpeg(join(outDir, "mask-sheet-ts.jpg"), sheet, 82);
console.log(`wrote ${join(outDir, "mask-sheet-ts.jpg")}`);
