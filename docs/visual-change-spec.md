# Visual change features: implementation spec

Written 2026-10-09 for the team implementing the next round of Follicle features. It covers four product features and the developer-only AI route used to test them before a paid API key exists. Read the README first for how the app is structured; this document only describes what is new.

## 1. Goals and non-goals

**Goal.** Make the question "is anything changing?" answerable at a glance, using the two things the app already does better than competitors: every photo is lined up on a per-region guide, and treatment dates sit on the same timeline as photos.

**Non-goals.** The app does not measure hair density, count follicles, or prove that a treatment caused a change. Nothing in this spec may produce copy that claims otherwise. Every visual produced here is labelled as what it literally is (texture change, visible scalp area, an AI's approximate outline), never as "growth".

## 2. Building blocks already in the codebase

| Piece | Where | What it gives you |
| --- | --- | --- |
| Per-photo framing on the region guide | `src/lib/framing.ts`, `FramedPhoto` in `src/components/framed-photo.tsx` | A similarity transform (translate, rotate, uniform scale) placing a photo on its region's 100 × 100 guide. Two framed photos of one region are in the same coordinate space. |
| Greyscale image ops | `src/lib/alignment/image.ts` | `rgbaToGray`, `downsample`, `blur`, `gradientMagnitude`, `standardize`, `warpImage`, `sampleBilinear`. All on `GrayImage` (`Float32Array`). |
| Pixel access to a photo | `src/lib/photos.ts` (`grayCrop`, `alignPhotos`) | Renders a photo through `expo-image-manipulator`, decodes with `jpeg-js`, returns greyscale pixels. Currently 96 px wide for registration. |
| Comparison pair per region | `useComparison` in `src/hooks/use-comparison.ts` | The remembered before/after for each region, plus the guide turn. |
| Home head map | `src/components/home/head-map.tsx` | A tappable top-down head, one shape per region, coloured by freshness. |
| AI assessment | `supabase/functions/analyze-photo/index.ts`, schema in `supabase/functions/_shared/analysis.ts` | Claude vision call with structured output. Returns Norwood estimate, confidence, per-area severity, approximate boxes, change-since-previous. Stored in `analyses`. |
| Region overlay in the viewer | `src/components/comparison-viewer.tsx` (search `regions`) | Draws each analysis box over the after photo in the photo's own coordinates. |
| Model evaluation harness | `scripts/model-eval/` | Runs the assessment prompt across providers against fixtures and scores the results. Use it for any prompt or schema change in this spec. |

## 3. Feature A: texture-change heatmap (on device)

**What the user sees.** On Compare, a new mode next to grid and ghost: "Change". The after photo is shown with a translucent overlay: green where hair texture increased, amber where it decreased, nothing where it is unchanged. A slider sets overlay opacity. A one-line caption reads "Texture change, Feb 14 → Sep 22" with a small "what this is" link opening the explanation in section 3.5.

**Why on device.** It is instant, free, works offline for local journals, and it needs no new permissions or consent copy. Nothing leaves the phone.

### 3.1 Inputs

- The current region's `before` and `after` photos from `useComparison`, both with a framing (`framingOf(photo) !== null`). If either is unframed, the mode is disabled with the hint "Line up both photos to see change".
- The region's guide turn, so the overlay is drawn in the same orientation as the viewer.

### 3.2 Algorithm

Work at a fixed resolution in guide space so results are comparable across devices.

1. **Render both photos into guide space** at `S = 320` px square. Use the framing transform to warp each photo so the guide's 100 × 100 square maps to the S × S canvas (`warpImage` with the inverse of `framedTransform`, or render through `expo-image-manipulator` and then warp; pick whichever the existing `alignPhotos` path makes easiest). Pixels outside the photo are marked invalid in a mask.
2. **Normalise lighting.** Convert to greyscale. Apply local normalisation: subtract a heavy blur (`blur` with ~6 passes at this size) and divide by a local standard deviation estimated the same way. This removes the skin tone gradient and most lighting differences between sessions.
3. **Texture score per pixel.** Compute `gradientMagnitude` on the normalised image, then box-average it in `B = 16` px blocks (20 × 20 blocks). Hair on skin produces high gradient energy; bare scalp produces low. Call these `T_before` and `T_after`.
4. **Difference.** `D = T_after - T_before`, divided by `(T_after + T_before + ε)` so it is a relative change in `[-1, 1]`. Zero out blocks where either mask is invalid or where both textures are below a noise floor (set empirically from the fixtures in `src/lib/fixtures/`).
5. **Smooth and threshold.** Blur `D` once at block resolution. Values within `±0.12` are transparent. Map `+0.12 → +0.6` to green at 0.25 → 0.75 alpha and `−0.12 → −0.6` to amber the same way. Those numbers are starting points; expose them as constants and tune on fixtures.
6. **Output.** A 20 × 20 RGBA block grid plus a summary: `{ gained: fraction of valid blocks > +0.12, lost: fraction < −0.12, coverage: fraction of blocks valid, confidence: "low" | "ok" }`.

Confidence is `low` when any of: coverage below 0.6, the pair differs in `hair_wet`, the pair differs in `hair_length`, or the registration score between the two (via `ncc` in `register.ts`) is below `MIN_MATCH`. Low confidence still renders but the caption says "Low confidence: different hair length" or similar, using the existing "Different hair length and wetness" wording on Compare.

### 3.3 Where the code goes

- `src/lib/change-map.ts`: pure functions, `computeChangeMap(before: GrayImage, after: GrayImage, masks) => ChangeMap`. No React, no Expo imports, so it is testable with `bun test` like `register.test.ts`.
- `src/lib/photos.ts`: add `guideGray(photo, framing, size)` next to `grayCrop`, returning the warped greyscale image and mask.
- `src/hooks/use-change-map.ts`: runs the pipeline off the render path (`InteractionManager.runAfterInteractions` or a worklet), caches by `(beforeId, afterId, beforeFraming, afterFraming)` in memory, returns `{ map, summary, status }`.
- `src/components/change-overlay.tsx`: renders the block grid as an SVG of rects over `FramedPhoto` in guide coordinates, honouring the turn. Mounted inside `ComparisonViewer` in the "Change" mode.

### 3.4 Performance

Two 320 × 320 warps and a handful of blurs is well under 100 ms on a mid-range phone in JS; if it is not, downsample to 256 before step 2. Never block first paint of Compare on it: show the photos, then fade the overlay in when ready.

### 3.5 Copy

Explanation sheet, verbatim:

> This compares hair texture between the two photos after lining them up. Green means more texture in the later photo, amber means less. It reacts to haircuts, wet hair, lighting and how well the photos are lined up, so treat it as a pointer to look closer, not a measurement.

### 3.6 Acceptance

- Unit tests in `src/lib/change-map.test.ts`: identical inputs produce an all-transparent map; a synthetic "added strokes" region produces positive blocks there and nowhere else; a brightness shift alone produces no blocks.
- Fixture test using `src/lib/fixtures/turned-frame.json`: a 90° turn with matching framings still yields a near-empty map.
- Compare renders the overlay within one second of mode switch on the sample journal on a 2022 mid-range Android.

## 4. Feature B: region trend on the head map

**What the user sees.** On the Photos tab the head map already colours regions by how recently they were photographed. Add a second layer: a small trend glyph per region in the legend chips (▲ gaining, ▼ losing, – stable, blank unknown) and a sentence under the selected region, e.g. "Top: more texture than in February. Based on 7 photos." Tapping it opens Compare in Change mode for that region.

### 4.1 Data

Derived at read time, no new tables. For each region with at least two framed photos:

1. Take the region's photos oldest to newest and compute the change-map summary (section 3.2) for each consecutive framed pair, reusing the cache from `use-change-map`.
2. `trend = Σ (gained − lost)` over pairs, each pair weighted by its confidence (1.0 for ok, 0.4 for low).
3. Classify: `> +0.08` gaining, `< −0.08` losing, otherwise stable. Fewer than two framed photos or every pair low-confidence: unknown.

If an AI assessment exists for the region's latest photo and its `change_since_previous.assessment` is `improved` or `worse`, show it as a second line: "The AI assessment on Sep 22 read it as improved." It never overrides the texture trend; both are shown.

### 4.2 Rendering

- Trend glyph and colour in the legend chip after the region name. Colours: gaining uses `colors.accent`, losing uses `colors.rust`, stable uses `colors.muted`.
- Keep the head map's fill meaning as freshness. Do not encode two things in one fill.
- Computing summaries for every region on first load is too slow; compute lazily per region when it becomes selected, and show the glyphs as they resolve.

### 4.3 Acceptance

- Sample journal: Top shows a trend after selection within two seconds; regions with one photo show no glyph.
- Changing a photo's framing on Line up invalidates that region's cached trend.

## 5. Feature C: AI outlines instead of boxes

**What the user sees.** When the comparison has an assessment, regions are drawn as soft polygon outlines that fit the area instead of rectangles. In Change mode with an assessment, toggling the outline on morphs the before photo's outline to the after photo's.

### 5.1 Schema

In `supabase/functions/_shared/analysis.ts`, add to each region an optional `outline: { x: number; y: number }[] | null` (4 to 12 points, fractions of image width and height, clockwise). Keep `box` for backward compatibility; the function fills `box` from the outline's bounds when the model returns an outline, so old clients keep working. Bump `ASSESSMENT_PROMPT_VERSION` to `scalp-v2` and add this to the prompt's guidelines:

> For each region you describe, give an outline: 4 to 12 points, clockwise, as fractions of image width and height, tracing the visible extent of the thinning or recession. Give null when the region is not visible.

### 5.2 Validation

Run `scripts/model-eval` against the smoke fixtures and the private dataset with the new prompt before deploying. Reject the change if the usable-photo rate or the agreement scores drop. Add a scorer that checks outlines are inside the image and have at least 4 points.

### 5.3 Rendering

- Replace the box `View`s in `comparison-viewer.tsx` with an SVG `Path` per region, fill at 12% alpha in `colors.loupe`, 2 px stroke, label at the polygon's centroid.
- Morph: both outlines resampled to 24 points; animate with Reanimated by interpolating point positions over 600 ms. Only morph when the before photo also has an assessment; otherwise fade.
- The "approximate" label stays in the analysis card.

## 6. Feature D: scalp coverage (deferred)

Segmenting hair versus visible scalp per region and charting "visible scalp area" over time is the only feature here that yields a number, and it needs either a hosted segmentation model or one trained on consented photos. Do not start it until features A to C ship and a validation set with ground truth exists. When it does, present it as "visible scalp area", never density, and gate it behind the same account and consent flow as the assessment.

## 7. AI access for development and testing

### 7.1 Where things stand

The production path is the Supabase edge function with `ANTHROPIC_API_KEY`, billed per call at about three to six cents (see `docs/pricing-recommendation.md`). Today the app refuses to analyse a local journal (`analyzePhoto` throws for `owner === "local"`), so testing needs a Supabase project, a confirmed account, and a deployed function with a key. That is the right shape for production and the wrong shape for a developer wanting to iterate on prompts tonight.

### 7.2 The rules on using a subscription

- **Claude.** Anthropic's Agent SDK documentation states that, unless previously approved, third-party developers may not offer claude.ai login or rate limits for their products, including agents built on the Agent SDK, and should use API keys. Using your own Claude Code login on your own machine to run your own photos through your own prototype is ordinary individual use. The moment a build goes to a tester, or the server serves anyone but you, it has to run on an API key. Community reports in April 2026 indicate OAuth-token SDK usage began drawing on the plan's additional-usage allowance rather than the base quota, so watch the usage meter.
- **Codex.** `codex login` with a ChatGPT plan is the documented way the CLI and `codex exec` are billed, and `codex exec` is a documented non-interactive mode for scripts. The same individual-use reading applies.

### 7.3 Developer analysis server

A small Node process on the developer's machine that implements the same request and response contract as the edge function and chooses a provider by flag. The app talks to it only in development builds.

**App side.**

- New env var `EXPO_PUBLIC_ANALYSIS_URL`. When set and `__DEV__` is true, `analyzePhoto` posts to `${EXPO_PUBLIC_ANALYSIS_URL}/analyze` instead of the edge function, for local and cloud journals alike. In production builds the variable is ignored.
- Request body: `{ photo: { base64, media_type, view, taken_at, hair_length, hair_wet, notes }, previous: same shape or null, treatments: [{ name, dosage, started_on, ended_on }] }`. The app reads the file with `expo-file-system` on native and from the data URI on web. Previous photo and treatments are resolved on the client from the journal.
- Response: `{ result: ScalpAnalysis, model: string }`, validated with `ScalpAnalysisSchema`. For local journals the result is stored in the local `analyses` array with the same shape as a cloud row.

**Server side**, `scripts/dev-analysis-server/`:

- `server.ts`: Fastify or `node:http`, binds `127.0.0.1` only, reads `--provider claude|codex|api`.
- `providers/claude-agent.ts`: uses `@anthropic-ai/claude-agent-sdk`. Build the prompt exactly as the edge function does (same `SYSTEM_PROMPT`, same text blocks), pass the photos as base64 `image` content blocks in `message.content`, set `outputFormat: { type: "json_schema", schema: z.toJSONSchema(ScalpAnalysisSchema, { target: "draft-7" }) }`, `tools: []`, `maxTurns: 1`, `model: "opus"`. Read `message.structured_output` from the result message. Authentication comes from the developer's Claude Code login; if the SDK does not pick it up, run `claude setup-token` and export `CLAUDE_CODE_OAUTH_TOKEN`.
- `providers/codex.ts`: spawn `codex exec --ephemeral --json -i before.jpg -i after.jpg --output-schema schema.json -m <model> "<prompt>"`, write the images and schema to a temp dir first, parse the final JSON event. Authentication comes from `codex login` (currently "Logged in using ChatGPT" on the author's machine).
- `providers/api.ts`: the existing `@anthropic-ai/sdk` call lifted from the edge function, for parity testing with a key.
- Log model, latency, and whether the schema validated, one line per request, to `.model-eval/dev-server.log` (already git-ignored).

**Why this shape.** The prompt, schema, and parsing stay identical between the dev server and the edge function, so what you learn transfers. Swapping `--provider` makes the Claude-versus-Codex comparison a one-flag A/B, and the existing `scripts/model-eval` scorers can read the log.

### 7.4 Recommendation

Start with `--provider claude`. The prompt, the Zod schema, and the evaluation harness were all written against Claude, and the Agent SDK supports the exact combination needed (images in, schema-validated JSON out). Use `--provider codex` as the comparison once the pipeline works. Move to `--provider api` with a real key before any build leaves the developer's machine.

### 7.5 What the developer needs today

| Route | Needed | Already present on the author's machine |
| --- | --- | --- |
| Claude via subscription | Claude Code installed and logged in; `npm install @anthropic-ai/claude-agent-sdk` in `scripts/dev-analysis-server` | Claude Code 2.1.291 logged in |
| Codex via subscription | Codex CLI installed and logged in with ChatGPT | codex-cli 0.160.1, logged in |
| Production | Supabase project, migrations applied, `ANTHROPIC_API_KEY` secret, `supabase functions deploy analyze-photo` | Not yet configured (`.env` absent) |

## 8. Order of work

1. Dev analysis server and the `EXPO_PUBLIC_ANALYSIS_URL` switch (section 7). Unblocks everything else.
2. Feature A, library and tests first, then the Compare mode.
3. Feature B, reusing A's cache.
4. Feature C, prompt and schema through the eval harness, then rendering.
5. Feature D only after a validation set exists.

## 9. Open questions

- Should the change map be persisted per pair (cheap to recompute, but trends across many pairs add up on long journals)? Start in memory; add an AsyncStorage cache keyed by framing if first-load trend computation exceeds two seconds on the sample journal.
- Reduced motion: the outline morph and overlay fade must respect the OS setting (`AccessibilityInfo.isReduceMotionEnabled`).
- Whether the "Change" mode should be hidden until both photos are lined up, or shown disabled with the hint. Spec says disabled with hint; confirm with design.
