import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import jpeg from "jpeg-js";

async function main() {
  const output = resolve(".model-eval/smoke");
  await mkdir(output, { recursive: true, mode: 0o700 });
  const width = 128, height = 128;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = x < 64 ? 30 : 200;
    data[i + 1] = y < 64 ? 180 : 30;
    data[i + 2] = 80;
    data[i + 3] = 255;
  }
  await writeFile(`${output}/non-scalp.jpg`, jpeg.encode({ data, width, height }, 90).data, { mode: 0o600 });
  const photo = { path: "non-scalp.jpg", view: "crown", taken_at: "2026-10-02T12:00:00.000Z", hair_length: null, hair_wet: false, notes: null };
  const manifest = {
    version: 1,
    cases: [
      { id: "non-scalp-single", tags: ["synthetic", "non-scalp", "no-baseline"], consent_confirmed: true, current: photo, expected: { usable: false, stages: ["indeterminate"], changes: ["no_previous"] } },
      { id: "non-scalp-pair", tags: ["synthetic", "non-scalp", "identical-pair"], consent_confirmed: true, previous: { ...photo, taken_at: "2026-09-02T12:00:00.000Z" }, current: photo, expected: { usable: false, stages: ["indeterminate"], changes: ["uncertain", "stable"] } },
    ],
  };
  await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(`Created synthetic connection fixtures: ${output}/manifest.json\nThese contain no people and cannot measure scalp-analysis accuracy.`);
}

main().catch(() => { console.error("Could not create smoke fixtures."); process.exitCode = 1; });
