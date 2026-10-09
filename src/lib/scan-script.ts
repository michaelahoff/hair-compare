/**
 * What the AI bubble says while photos are matched and analysed: lines built
 * from what the app already knows, then the analysis's own findings.
 *
 * Pure functions with no React or Expo imports, so they run under `bun test`.
 */
import { guideLandmarks, type GuideStyle } from "./guide-art";
import {
  elapsedDays,
  shortDate,
  type Photo,
  type ScalpAnalysis,
  type ScalpArea,
  type ScalpView,
  type Treatment,
} from "./model";

/** What the bubble says, and the area it's about when the outlines should point at one. */
export type BubbleLine = { text: string; area?: ScalpArea };

/** While a photo is being matched to another, pixel by pixel or by Claude. */
export function matchLines(
  view: ScalpView,
  style: GuideStyle,
  against: string | null,
  ai: boolean,
): string[] {
  const landmarks = guideLandmarks(view, style);
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

const day = (photo: Photo) => shortDate(photo.taken_at);

/**
 * While an analysis runs: the pair's dates, conditions that change how hair
 * looks, treatments in between, and the texture map once it is ready.
 */
export function contextLines(input: {
  before: Photo;
  after: Photo;
  treatments: Pick<Treatment, "name" | "started_on" | "ended_on">[];
  texture?: { gained: number; lost: number } | null;
}): BubbleLine[] {
  const { before, after, treatments, texture } = input;
  const lines: BubbleLine[] = [
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

type Change = ScalpAnalysis["change_since_previous"]["assessment"];

const VERDICT: Record<Change, string> = {
  improved: "Looks better",
  stable: "Looks about the same",
  worse: "Looks thinner",
  uncertain: "Too close to call",
  no_previous: "Nothing earlier to compare with",
};

/** The analysis's call on the change, in a few words. */
export const verdictText = (change: Change) => VERDICT[change];

/** The finished analysis, read out: the verdict, each region, then the summary. */
export function resultLines(result: ScalpAnalysis): BubbleLine[] {
  const change = result.change_since_previous;
  const lines: BubbleLine[] = [];
  if (change.assessment !== "no_previous")
    lines.push({
      text: `${verdictText(change.assessment)}. ${firstSentence(change.explanation)}`,
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
