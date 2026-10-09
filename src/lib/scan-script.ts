/**
 * What the AI bubble says while photos are matched and analysed: lines built
 * from what the app already knows, then the analysis's own findings.
 *
 * Pure functions with no React or Expo imports, so they run under `bun test`.
 */
import type { GuideStyle } from "./guide-art";
import {
  elapsedDays,
  type Photo,
  type ScalpAnalysis,
  type ScalpView,
  type Treatment,
} from "./model";

/** A line, and the area it is about when the outlines should point at one. */
export type Said = { text: string; area?: string };

const LANDMARKS: Record<ScalpView, string> = {
  top: "the whorl, ears and hairline",
  crown: "the whorl and the outline of your head",
  hairline: "your hairline and brows",
  left_temple: "your temple and sideburn",
  right_temple: "your temple and sideburn",
};

/** While a photo is being matched to another, pixel by pixel or by Claude. */
export function matchLines(
  view: ScalpView,
  style: GuideStyle,
  against: string | null,
  ai: boolean,
): string[] {
  const landmarks =
    style === "closeup" ? "the whorl and how the hair swirls" : LANDMARKS[view];
  if (ai)
    return [
      "Claude is looking at both photos…",
      `Finding ${landmarks} in each…`,
      "Pointing out the same spots in both…",
      "Working out the turn and size…",
    ];
  return [
    `Looking for ${landmarks}…`,
    against ? `Comparing with ${against}…` : "Comparing with the guide…",
    "Trying every angle…",
    "Fine-tuning the fit…",
  ];
}

function day(photo: Photo) {
  return new Date(`${photo.taken_at.slice(0, 10)}T12:00:00`).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric" },
  );
}

/**
 * While an analysis runs: the pair's dates, conditions that change how hair
 * looks, treatments in between, and the texture map once it is ready.
 */
export function contextLines(input: {
  before: Photo;
  after: Photo;
  treatments: Pick<Treatment, "name" | "started_on" | "ended_on">[];
  texture?: { gained: number; lost: number } | null;
}): Said[] {
  const { before, after, treatments, texture } = input;
  const lines: Said[] = [
    {
      text: `Comparing ${day(before)} with ${day(after)}: ${elapsedDays(before.taken_at, after.taken_at)} days apart.`,
    },
  ];
  if (before.hair_wet !== after.hair_wet)
    lines.push({
      text: `Your hair was wet on ${day(before.hair_wet ? before : after)}. Wet hair shows more scalp, so I'll allow for that.`,
    });
  if (
    before.hair_length &&
    after.hair_length &&
    before.hair_length !== after.hair_length
  )
    lines.push({
      text: `Hair went from ${before.hair_length} to ${after.hair_length}. Length changes how much scalp shows.`,
    });
  const from = before.taken_at.slice(0, 10);
  const to = after.taken_at.slice(0, 10);
  for (const t of treatments) {
    if (t.started_on > to || (t.ended_on && t.ended_on < from)) continue;
    const start = t.started_on > from ? t.started_on : from;
    const end = t.ended_on && t.ended_on < to ? t.ended_on : to;
    lines.push({
      text: `${t.name} ran for ${elapsedDays(start, end)} of those days.`,
    });
  }
  if (texture)
    lines.push({
      text:
        texture.lost > 0.05 || texture.gained > 0.05
          ? `Texture map: ${Math.round(texture.lost * 100)}% of the scalp shows less texture, ${Math.round(texture.gained * 100)}% more.`
          : "Texture map: about the same texture all over.",
    });
  lines.push({ text: "Asking Claude for a closer look…" });
  return lines;
}

/** The first sentence, so a bubble stays short; the full text is in the analysis card. */
export function firstSentence(text: string, max = 160) {
  const sentence = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  return sentence.length > max
    ? `${sentence.slice(0, max - 1).trimEnd()}…`
    : sentence;
}

const VERDICT: Record<string, string> = {
  improved: "Looks better",
  stable: "Looks about the same",
  worse: "Looks thinner",
  uncertain: "Too close to call",
};

/** The finished analysis, read out: the verdict, each region, then the summary. */
export function resultLines(result: ScalpAnalysis): Said[] {
  const change = result.change_since_previous;
  const lines: Said[] = [];
  if (change.assessment !== "no_previous")
    lines.push({
      text: `${VERDICT[change.assessment] ?? change.assessment}. ${firstSentence(change.explanation)}`,
    });
  for (const region of result.regions)
    if (region.box || region.outline)
      lines.push({
        text: `${region.area.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())}, ${region.severity}: ${firstSentence(region.observation)}`,
        area: region.area,
      });
  lines.push({ text: firstSentence(result.summary) });
  return lines;
}
