# What the app can read from real crown photos

Findings from one person's 24 phone photos (20 crown, 2 hairline, 2 temple;
Galaxy S25 Ultra; 2026-08-14 to 2026-10-03; long wavy hair until 2026-09-16,
buzzed from 2026-09-18), plus ten open-licensed photos from Wikimedia
Commons. The photos stay out of git in `.model-eval/`; the scripts under
`scripts/real-photo-eval/` rerun everything below against them.

## 1. Could the plain matcher line these up?

Not reliably. The matcher in `src/lib/alignment/register.ts` correlates
edge maps of whole 96-px photos. In a bathroom crown shot most edges are
floor tiles, a mirror cabinet and a collar, so it locked onto those.

Hand landmarks (thin-patch centre, neck direction, head edges) were marked
on every crown photo and every one of the 190 crown pairs was scored.

| Plain matcher, 190 pairs | |
| --- | --- |
| Accepted by its score gate | 73 |
| Accepted and right (patch within 12% of head width, turn within 15°, scale within 20%) | 33 |
| Accepted and wrong | 40 (turn errors up to 139°, scale errors up to 2×) |
| Rejected but right | 13 |
| Head's turn right, any pair | 115 (61%) |

Two photos taken 18 seconds apart, same hair, same shirt, were accepted
with a high score and lined up on the cabinet behind the head, not the head.

## 2. The head-aware matcher

`src/lib/alignment/head-align.ts` first finds the head
(`src/lib/scalp/head-mask.ts`: finely textured pixels that are dark,
reddish through stubble, or grey, plus skin enclosed by them; the thickest
central blob, holes filled, clipped to a disc about its thickest point).
It then matches two channels inside the head only: the smoothed skin map
(where scalp shows) and the fine edges, with the same coarse-to-fine search
as before. Because a round head and a roundish patch give almost no
front/back cue, it also refines the best transform in each quarter-turn
basin and reports the runner-up.

| Head-aware matcher, 190 pairs | |
| --- | --- |
| Head's turn right | 155 (82%) |
| Turn right within the best two basins | 162 (85%) |
| Flagged ambiguous (runner-up basin within 0.08) | 90, of which 30 wrong |
| Not flagged | 100, of which 95 right (95%) |
| Same hair length only (139 pairs), turn right | 119 (86%) |
| Strict landmark check passed | 72 (38%; the landmarks themselves are only good to about 10% of head width on cut-off heads) |
| Patch-centre miss, right-turn pairs | median 10% of head width |
| Time per pair, bun on a desktop | about 0.65 s at 192 px (expect several seconds on a phone) |

What this means in the app: a match comes back as a framing plus its
other turns. When the runner-up is close, Line up and Compare say the
matcher wasn't sure which way the head faces and offer **Turn it the other
way**, which snaps to the next basin. The AI match on the developer server
remains for the hard cases.

What was tried and did not work: a body-direction detector (collar skin
and smooth fabric next to the head) pointed at the shoulders rather than the
neck and got 4 of 20 photos right. Hair length changes (long to buzzed)
cost about 10 points of turn accuracy; scale between those cohorts is
genuinely undefined, since hair volume is part of the outline.

## 3. Can regrowth be read?

### 3.1 Seeing fine and light hairs

Yes, for short hair. A multi-scale ridge filter (`src/lib/scalp/ridge.ts`,
Hessian ridge response at about 0.8 to 1.8 hair widths) resolves single
buzzed hairs across the whole head at the photo's native resolution
(about 130 px per cm on these photos; one hair is about one pixel wide).
Plain sharpening does not: it raises noise as much as hair. Local contrast
normalisation plus a light unsharp mask (`src/lib/scalp/reveal.ts`) makes
the thin crown pattern legible without inventing structure.

Grey hairs: a chroma channel (red minus luma) was tried for light hairs on
pink skin. JPEG chroma subsampling turns it into an 8-px block pattern, so
it was dropped from counting. Grey hairs on this person are still caught by
the luma ridge where they are darker than the skin between them.

Long hair: strands overlap, so lines cannot be counted; only the exposed
patch can be measured, and it moves with styling and wetness.

### 3.2 Numbers the app shows

`src/lib/scalp/metrics.ts`, per photo, read at 900 px wide:

- **Scalp showing**: share of the head where the skin map exceeds 0.35.
- **Thin patch**: largest exposed area inside the head, in cm², scaled from
  a 15 cm head width (flagged as a guess when the head is cut off).
- **Crown ÷ ring** (short hair only): centimetres of detected hair line per
  cm² inside a 2.5 cm disc about the patch centre, divided by the same in a
  3.5 to 5.5 cm ring. The ring is the photo's own reference, so lighting,
  sharpness and scale cancel. This is the one figure meant to be compared
  across visits.

On the buzzed photos:

| Date | Scalp showing | Patch cm² | Crown lines | Ring lines | Crown ÷ ring |
| --- | --- | --- | --- | --- | --- |
| 2026-09-18 | 20% | 33 | 3.9 | 8.8 | 0.44 |
| 2026-10-01 | 21% | 26 | 6.6 | 10.5 | 0.63 |
| 2026-10-03 | 18% | 25 | 4.2 | 8.3 | 0.50 |

Two photos two days apart (10-01 and 10-03) differ by 0.13, so that is
about the noise of one photo: lighting, the exact angle and how the mask
lands all move it. Between 2026-09-18 and 2026-10-03 the crown-to-ring
ratio is unchanged within that noise. Two weeks is also too short for a
change this method could see; hair grows about 0.3 to 0.4 mm a day, so
what changes between these photos is length, which the ratio is designed
to ignore. Three or four buzzed photos a month apart, taken the same way,
would be the first set this figure could speak to.

On the long-hair photos the patch area swings from 6 to 31 cm² with
styling and wetness alone, so no trend is read from them.

Absolute density: the detected line length divided by a typical unbroken
piece length gives about 70 to 85 hairs per cm² on the buzzed head. That
is an estimate with large, unmeasured error (crossing hairs split pieces;
one-pixel hairs drop out when blurred) and is not shown in the app; clinic
trichoscopy norms for a Caucasian vertex are about 220 hairs per cm².

### 3.3 What the app says and does not say

Everything is phrased as what the photos show ("the crown shows 0.5× the
hair-line density of the ring around it"). The app does not say a treatment
is working: FDA general wellness guidance and FTC substantiation rules make
that a different kind of product, and the photos cannot support it anyway.

## 4. Photo advice that would make all of this better

- Keep one hair length. The ratio only works on buzzed or short hair, and
  alignment loses about 10 points across a haircut.
- Same spot, same light, same phone height; dry hair.
- Put the neck at the bottom of the frame every time. That removes the
  one failure the matcher has left.
- Get the whole head in the frame, so the scale is known.
- Monthly is plenty; compare at three-month gaps.

## 5. Open-licensed photos

Ten Wikimedia Commons files (`.model-eval/web/LICENSES.md`): a four-shot
rear-view series over seven years (CC BY-SA 3.0), two top-down crowns (CC
BY-SA 4.0), a transplant before/after portrait pair (public domain), an
alopecia areata patch and a postpartum temple (CC0). The head mask found the
head in both rear-view time points, both crowns and the areata patch; it
takes the face on front portraits, as expected. No open source offers a
fixed-camera crown series suitable for density work.

## 6. Reproducing

```sh
bun run scripts/real-photo-eval/align-baseline.ts .model-eval/hoff   # plain matcher
bun run scripts/real-photo-eval/align-next.ts .model-eval/hoff       # head-aware matcher
bun run scripts/real-photo-eval/score-results.ts .model-eval/hoff .model-eval/hoff/next/results.json
bun run scripts/real-photo-eval/mask-sheet.ts .model-eval/hoff       # head masks
bun run scripts/real-photo-eval/metrics-sheet.ts .model-eval/hoff    # per-photo metrics
```

Each needs `manifest.json` (file, view, hair_length, hair_wet), `exif.json`
(file, width, height) and `landmarks.json` (patch, neck, left, right in
percent) in the directory. The Python prototypes in
`scripts/real-photo-eval/proto/` are what the TypeScript was ported from.
