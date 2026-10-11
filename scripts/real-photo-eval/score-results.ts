/**
 * Score a results.json (from align-baseline or align-next) against the hand
 * landmarks: how many accepted matches are right, how many wrong, and how
 * many right matches were rejected.
 *
 *   bun run scripts/real-photo-eval/score-results.ts .model-eval/hoff .model-eval/hoff/baseline/results.json
 */
import { readFileSync } from "node:fs";
import { isRight, loadTruth, pairError } from "./ground-truth";

const root = process.argv[2] ?? ".model-eval/hoff";
const file = process.argv[3] ?? `${root}/baseline/results.json`;
const rows = JSON.parse(readFileSync(file, "utf8")) as {
  ref: string; target: string; score: number; accepted: boolean;
  rotationDeg: number; scale: number; tx: number; ty: number;
}[];
const { marks, sizes, poses } = loadTruth(root);
let acceptedRight = 0, acceptedWrong = 0, rejectedRight = 0, rejectedWrong = 0;
const wrong: string[] = [];
const missedRight: string[] = [];
for (const r of rows) {
  const a = poses[r.ref];
  const b = poses[r.target];
  if (!a || !b) continue;
  const est = { tx: r.tx, ty: r.ty, rotation: (r.rotationDeg * Math.PI) / 180, scale: r.scale };
  const e = pairError(est, a, b, marks[r.ref], marks[r.target], sizes);
  const right = isRight(e);
  const line = `${r.ref.slice(9, 15)}->${r.target.slice(9, 15)} score ${r.score} miss ${(e.patchMiss * 100).toFixed(0)}% rot ${e.rotationErr.toFixed(0)}° scale ${(2 ** e.scaleErr).toFixed(2)}x`;
  if (r.accepted && right) acceptedRight++;
  else if (r.accepted) { acceptedWrong++; wrong.push(line); }
  else if (right) { rejectedRight++; missedRight.push(line); }
  else rejectedWrong++;
}
console.log(`accepted & right: ${acceptedRight}`);
console.log(`accepted & WRONG: ${acceptedWrong}`);
console.log(`rejected but right: ${rejectedRight}`);
console.log(`rejected & wrong: ${rejectedWrong}`);
console.log(`precision of accepted: ${(acceptedRight / Math.max(1, acceptedRight + acceptedWrong) * 100).toFixed(0)}%  recall of right: ${(acceptedRight / Math.max(1, acceptedRight + rejectedRight) * 100).toFixed(0)}%`);
if (process.argv.includes("--wrong")) { console.log("\nAccepted but wrong:"); for (const w of wrong) console.log("  " + w); }
if (process.argv.includes("--missed")) { console.log("\nRejected but right:"); for (const w of missedRight) console.log("  " + w); }
