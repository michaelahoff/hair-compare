/**
 * PROTOTYPE ONLY. A believable journal for judging layouts: eight months of
 * photos across the five views, three treatments. Images are generated SVG
 * data URIs, so this only renders on web.
 */
import type { Journal, Photo, ScalpView, Treatment } from "@/lib/model";

const PLAN: [string, ScalpView[]][] = [
  ["2026-02-14", ["top", "crown"]],
  ["2026-03-20", ["top", "hairline"]],
  ["2026-04-25", ["top", "crown"]],
  ["2026-06-02", ["top", "hairline", "left_temple", "right_temple"]],
  ["2026-07-10", ["top", "crown"]],
  ["2026-08-18", ["top"]],
  ["2026-09-22", ["top", "crown", "hairline", "left_temple"]],
];
const NOTES: Record<string, string> = {
  "2026-02-14": "Baseline. Bathroom light, hair just washed.",
  "2026-06-02": "Added the temples. Harder to hold the angle steady.",
  "2026-09-22": "Barber cut yesterday, so shorter than usual.",
};

function scalpSvg(seed: number, progress: number) {
  // Warm skin at the centre fading into hair; more strokes as progress rises.
  const strokes: string[] = [];
  let r = seed * 9301 + 49297;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const count = 140 + Math.round(progress * 220);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const d = 60 + rand() * 230;
    const x = 300 + Math.cos(a) * d;
    const y = 330 + Math.sin(a) * d * 1.15;
    const len = 18 + rand() * 40;
    const x2 = x + Math.cos(a + 0.6) * len;
    const y2 = y + Math.sin(a + 0.6) * len;
    strokes.push(
      `<path d='M${x.toFixed(0)} ${y.toFixed(0)}L${x2.toFixed(0)} ${y2.toFixed(0)}' stroke='#2B1A12' stroke-opacity='${(0.45 + rand() * 0.4).toFixed(2)}' stroke-width='${(1.5 + rand() * 2).toFixed(1)}' stroke-linecap='round'/>`,
    );
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='720'><defs><radialGradient id='g' cx='50%' cy='46%' r='62%'><stop offset='0' stop-color='#E9C2A4'/><stop offset='0.45' stop-color='#B98668'/><stop offset='1' stop-color='#3A2418'/></radialGradient></defs><rect width='600' height='720' fill='url(#g)'/>${strokes.join("")}</svg>`;
  // Not the `;utf8,` form: react-native-web re-encodes that one.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function demoJournal(): Journal {
  const photos: Photo[] = [];
  PLAN.forEach(([date, views], step) => {
    views.forEach((view, i) => {
      const id = `demo-${date}-${view}`;
      photos.push({
        id,
        user_id: "local",
        view,
        taken_at: `${date}T12:00:00.000Z`,
        storage_path: `local/${id}.jpg`,
        width: 600,
        height: 720,
        hair_length: step === 6 ? "short" : "medium",
        hair_wet: step === 0,
        notes: i === 0 ? (NOTES[date] ?? null) : null,
        alignment: null,
        created_at: `${date}T12:00:00.000Z`,
        uri: scalpSvg(step * 7 + i, step / (PLAN.length - 1)),
      });
    });
  });
  const treatments: Treatment[] = [
    {
      id: "demo-t1",
      user_id: "local",
      name: "Minoxidil 5%",
      kind: "topical",
      dosage: "1 ml, twice daily",
      started_on: "2026-02-20",
      ended_on: null,
      notes: null,
      created_at: "2026-02-20T12:00:00.000Z",
    },
    {
      id: "demo-t2",
      user_id: "local",
      name: "Finasteride",
      kind: "oral",
      dosage: "1 mg daily",
      started_on: "2026-04-01",
      ended_on: null,
      notes: null,
      created_at: "2026-04-01T12:00:00.000Z",
    },
    {
      id: "demo-t3",
      user_id: "local",
      name: "Ketoconazole shampoo",
      kind: "topical",
      dosage: "2% · twice weekly",
      started_on: "2026-03-01",
      ended_on: "2026-06-15",
      notes: null,
      created_at: "2026-03-01T12:00:00.000Z",
    },
  ];
  return { photos, treatments, analyses: [] };
}
