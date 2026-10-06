/** Deterministic synthetic scalp images for alignment tests. */
import { createImage, type GrayImage } from "./image";

export function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

/** Head-shaped blob with patchy "hair" and a few distinctive features. */
export function syntheticScalp(
  width: number,
  height: number,
  seed = 1,
): GrayImage {
  const rand = rng(seed);
  const img = createImage(width, height);
  const blobs = Array.from({ length: 14 }, () => ({
    x: (rand() - 0.5) * 0.6,
    y: (rand() - 0.5) * 0.8,
    r: 0.03 + rand() * 0.08,
    v: rand() * 0.5 - 0.25,
  }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x - (width - 1) / 2) / width;
      const v = (y - (height - 1) / 2) / width;
      let value = 0.15 + 0.1 * (y / height);
      if ((u / 0.38) ** 2 + (v / 0.5) ** 2 < 1) {
        value = 0.55 + 0.15 * Math.sin(u * 30) * Math.cos(v * 22);
        for (const b of blobs) {
          const d2 = (u - b.x) ** 2 + (v - b.y) ** 2;
          value += b.v * Math.exp(-d2 / (b.r * b.r));
        }
      }
      img.data[y * width + x] = value + (rand() - 0.5) * 0.04;
    }
  }
  return img;
}

export function relight(
  img: GrayImage,
  gain: number,
  offset: number,
  noise: number,
  seed: number,
): GrayImage {
  const rand = rng(seed);
  const out = createImage(img.width, img.height);
  for (let i = 0; i < img.data.length; i++) {
    out.data[i] = img.data[i] * gain + offset + (rand() - 0.5) * noise;
  }
  return out;
}
