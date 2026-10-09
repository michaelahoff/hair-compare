# Follicle · Hair Compare

An Expo SDK 57 app for Android, iOS and web that keeps a dated scalp photo journal, compares matching views and records treatment timelines.

## Run

Use Node 22.13 or newer. Dependencies use npm (`package-lock.json`).

```sh
npm ci
npm start
# Browser preview
npm run web
```

Scan the Expo QR code on a device with a compatible Expo Go version, or use an Expo development build. Camera and photo-library access require permission on the device. The web picker supports uploads; camera availability depends on browser/device capabilities.

## Available without a backend

- Take or select photos, choosing scalp view, date, hair length, wetness and notes.
- Keep photos in the app's permanent documents directory on native devices; journal metadata uses AsyncStorage. Web previews keep image data in browser storage, which has limited capacity.
- Compare two photos from the same view, stacking in portrait and displaying side by side in landscape. Override the layout if desired.
- Pick the before and after from a view's whole timeline with the photo strip, arrows or a swipe. Each view's pair is remembered on the device and shown on Home.
- Pinch to zoom up to 5× and drag either photo to move both together. Buttons also control zoom.
- Line each photo up with its view's guide outline by dragging, pinching, twisting or using fine-tune buttons. The placement is saved with the photo, so every screen shows it lined up. Turn a view's guide to match which way the head faces.
- Once one photo of a view is lined up by hand, match the others to it automatically. Rotation, translation and uniform scale are estimated from small edge maps; inspect results against the guide.
- Turn on **Change** in Compare to tint the after photo where hair texture differs from the before photo: green for more, amber for less, with an opacity slider. Both photos must be lined up. It runs on the device, compares edge energy on the guide square, and is labelled as texture change, not hair growth; haircuts, wetness, lighting and loose framing all move it.
- The Photos tab marks each region in the legend with its texture trend across lined-up photos (▲ more, ▼ less, – about the same) once the region has been selected, and links the sentence under it to Compare's Change mode.
- Add, edit and delete treatments with dose/frequency, start/end dates and notes. Compare treatment dates with photo dates.
- Delete photos with confirmation. JPEG re-encoding removes camera metadata before storage/upload. Saved JPEGs are capped at 1800 pixels on the longest side; library originals are untouched.

The app does **not** reconstruct hidden hair, normalize hair length, correct lens/perspective distortion or measure follicle density. It preserves the observed image and records conditions affecting comparisons. Similarity registration is a framing aid, not a clinically validated measurement. Low-detail matches are rejected; inspect all results visually.

Device and cloud journals are separate. Signing in does not upload or migrate local photos. Deleting the app or clearing browser storage removes the device journal.

## Optional Supabase cloud journal and AI

1. Create a Supabase project. Copy `.env.example` to `.env` and set its URL and publishable/anon key. Never put a service-role or AI key in an `EXPO_PUBLIC_` variable. Restart Expo after environment changes.
2. Apply **both** files in `supabase/migrations/` in timestamp order using the SQL editor, or link the project with the Supabase CLI and run `supabase db push`. They create tables, row-level policies and a private photo bucket.
3. Enable email/password authentication. Keep email confirmation enabled for production. Users create an account in the Account screen, confirm their email if required and sign in.
4. Deploy the authenticated edge function:

```sh
supabase secrets set ANTHROPIC_API_KEY=YOUR_SERVER_SIDE_KEY
# Optional; default is claude-sonnet-5-5
supabase secrets set ANTHROPIC_MODEL=YOUR_VISION_MODEL_ID
supabase functions deploy analyze-photo
```

Do not disable JWT verification for deployment. The function also verifies the user through Supabase Auth, reads through the caller's RLS and explicitly scopes queries to that user.

Cloud photos use private storage and temporary signed URLs. A requested assessment sends the current photo, the preceding photo of the same view, photo metadata/notes and relevant treatment history to Anthropic. The app explains this before sending. Results include photo quality, estimated Norwood stage (or indeterminate), confidence, approximate region outlines (prompt `scalp-v2`; each region's box is filled from its outline for older clients), hair-condition effects and an uncertainty-aware comparison. Open a photo to request assessment; compare photos to display region outlines. In Change mode, when both photos have an assessment, the after photo's outlines morph from the before photo's.

An AI estimate is not a diagnosis or proof that a treatment caused a change. Before public release, add clinical validation, abuse/rate limits and provider privacy/retention review. The function has a request timeout and no automatic retries, but does not enforce per-user spending quotas.

## Developer analysis server

To iterate on the assessment without a Supabase project or API key, run the local server in `scripts/dev-analysis-server/`. It implements the edge function's prompt and result schema and picks a provider by flag:

```sh
(cd scripts/dev-analysis-server && npm ci)
npm run dev:analysis -- --provider claude   # or codex, or api
```

Then set `EXPO_PUBLIC_ANALYSIS_URL=http://127.0.0.1:8787` in `.env` and restart Expo. Development builds send assessments for local and cloud journals to the server; production builds ignore the variable. Android emulators also need `adb reverse tcp:8787 tcp:8787`.

- `claude` uses your Claude Code login through the Agent SDK (Haiku 5.5 by default; pass `--model` to change it). If it is not picked up, run `claude setup-token` and export `CLAUDE_CODE_OAUTH_TOKEN`.
- `codex` runs `codex exec` on your `codex login`.
- `api` uses `ANTHROPIC_API_KEY`, like the edge function.

The server also answers `/match`, which asks the model for the same spots in two photos so the app can line them up. With the server set, Line up and Compare offer **AI match** when matching the photo details misses, and after a match you mark as not right (it can land confidently wrong when a head looks very different between photos). Photos are sent only when you tap it. `claude` and `api` support it, on Opus 5.5 by default (`--match-model` changes it); `codex` doesn't yet. Each match takes about 10 to 25 seconds. Compare's Analyze sends the pair you chose, so the after photo is assessed against that before photo.

Subscription logins are for your own photos on your own machine only. Any build that reaches a tester, or a server that serves anyone else, must use an API key (see `docs/visual-change-spec.md` section 7). The server binds to 127.0.0.1, accepts browser requests only from localhost origins, and logs model, latency and schema status (never images or notes) to `.model-eval/dev-server.log`.

## Compare AI providers

The server-side benchmark connects Ling, Gemini Flash-Lite, Haiku, Sonnet and Kimi K3 without changing the app's current provider. Start with a no-network dry run:

```sh
npm run eval:fixtures
npm run eval:models -- --manifest .model-eval/smoke/manifest.json
```

See [the evaluation plan](docs/model-evaluation.md) for API-key setup, paid smoke tests, the scalp-photo dataset, quality gates, cost/latency reports and blind human scoring. Keys use `.env.models.local`; private images/reports belong in the ignored `.model-eval/` directory. Live runs require `--live` and a planning budget. The CLI needs no Supabase credentials and does not write into journals.

## Checks

```sh
npm run lint
npm run typecheck
# The developer analysis server has its own dependencies and typecheck
(cd scripts/dev-analysis-server && npm ci) && npx tsc --noEmit -p scripts/dev-analysis-server
# Bun is only the unit-test runner, not the dependency manager.
npm test
deno check --config supabase/functions/deno.json supabase/functions/analyze-photo/index.ts
npx expo export --platform web
```

TypeScript checks the app/shared schema; Deno checks the function separately. Registration tests use synthetic transforms and lighting changes, establishing algorithm behavior rather than clinical accuracy. No sample patient photos or fabricated progress data are committed.

## Native builds

Run `npx eas-cli@latest build:configure`, choose your own iOS bundle identifier and Android package, then build with EAS. Generated native folders are intentionally absent. Camera/photo permission text lives in `app.json`; microphone access is blocked for the photo picker. Device testing, signing and store submission require the app owner's Expo/store accounts.

## Structure

- `src/app/`: Expo Router screens. `line-up.tsx` lines one photo up (matching on open); `adjust.tsx` adjusts a compared pair together, with pins.
- `src/components/`: UI, assessment display and gesture comparison viewer. `guide.tsx` draws each view's head picture; `scan.tsx` and `scan-outlines.tsx` are the scan, AI bubble and traced regions shown while matching and analysing; `pin-marker.tsx` is a draggable pin.
- `src/components/home/`: the head map, progress strip and dated log on the Photos tab.
- `src/hooks/use-journal.tsx`: session lifecycle and React Query hooks.
- `src/hooks/use-auto-line-up.ts`: the queue that lines photos up in the background after uploads and in Compare.
- `src/lib/repository.ts`: device/cloud data operations and private image access.
- `src/lib/photos.ts`: JPEG preparation and working-image registration.
- `src/lib/alignment/`: coarse-to-fine similarity registration, and similarity fits to matched points.
- `src/lib/match.ts`: lining one photo up from another, on the device or by Claude's points, and choosing the photo to match from.
- `src/lib/framing.ts`: each photo's placement on its view's guide, and its pins.
- `src/lib/guide-art.ts`: each view's head picture, the spots a scan visits and the features worth pinning.
- `src/lib/pins.ts`: fitting one photo to another by pinned features.
- `src/lib/scan-script.ts`: what the AI bubble says while matching and analysing.
- `src/lib/change-map.ts`, `src/hooks/use-change-map.ts`: the on-device texture change map and its in-memory cache; `src/lib/trend.ts` turns a region's maps into a trend.
- `src/lib/outline.ts`: AI region outlines and mapping between photos and the guide.
- `scripts/dev-analysis-server/`: local analysis and photo-matching server for development.
- `supabase/`: migrations, validated result schema and authenticated AI function.
