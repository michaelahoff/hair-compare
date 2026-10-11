import { StyleSheet, Text, View } from "react-native";
import { Card, Notice, colors, s } from "./ui";
import { useScalpMetrics } from "@/hooks/use-scalp-metrics";
import { comparable, type ScalpMetrics } from "@/lib/scalp/metrics";
import { errorMessage, shortDate, type Photo } from "@/lib/model";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const one = (v: number | null) => (v === null ? "–" : v.toFixed(1));

/** One photo's column: the figures that can be read off it. */
function Column({ photo, metrics }: { photo: Photo; metrics: ScalpMetrics }) {
  return (
    <View style={styles.column}>
      <Text style={styles.date}>{shortDate(photo.taken_at, true)}</Text>
      <Row label="Scalp showing" value={pct(metrics.exposure)} />
      <Row label="Thin patch" value={`${metrics.patchCm2.toFixed(0)} cm²`} />
      {metrics.linesReliable ? (
        <>
          <Row
            label="Crown lines"
            value={`${one(metrics.crown.density)} cm/cm²`}
          />
          <Row label="Ring lines" value={`${one(metrics.ring.density)} cm/cm²`} />
          <Row
            label="Crown ÷ ring"
            value={
              metrics.crownToRing === null ? "–" : metrics.crownToRing.toFixed(2)
            }
            strong
          />
        </>
      ) : (
        <Text style={styles.small}>
          Hair lines aren&apos;t counted on longer hair: strands overlap.
        </Text>
      )}
      {!metrics.scaleKnown && (
        <Text style={styles.small}>Head cut off: sizes are a guess.</Text>
      )}
    </View>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, strong && { fontWeight: "800" }]}>{value}</Text>
    </View>
  );
}

/** What changed between two photos, said as what the photos show. */
function changeLine(before: ScalpMetrics, after: ScalpMetrics): string {
  const fit = comparable(before, after);
  if (!fit.ok) return `These two aren't directly comparable: ${fit.reason}.`;
  const parts: string[] = [];
  const patch = after.patchCm2 - before.patchCm2;
  if (Math.abs(patch) >= 1.5)
    parts.push(
      `the thin patch reads ${Math.abs(patch).toFixed(0)} cm² ${patch < 0 ? "smaller" : "larger"}`,
    );
  if (
    before.linesReliable &&
    after.linesReliable &&
    before.crownToRing !== null &&
    after.crownToRing !== null &&
    before.crownToRing > 0
  ) {
    const rel = after.crownToRing / before.crownToRing - 1;
    if (Math.abs(rel) >= 0.1)
      parts.push(
        `the crown's hair-line density relative to the ring around it is ${Math.abs(Math.round(rel * 100))}% ${rel > 0 ? "higher" : "lower"}`,
      );
  }
  if (!parts.length) return "No clear change between these two photos.";
  return `In the later photo, ${parts.join(", and ")}.`;
}

/**
 * Scalp coverage figures for a compared pair: how much scalp shows, how
 * big the thin patch is and, on short hair, how dense the hair lines are in
 * the crown against the ring of hair around it. Estimates from the photos
 * themselves, said as what the photos show.
 */
export function CoverageCard({
  before,
  after,
  enabled,
}: {
  before: Photo;
  after: Photo;
  enabled: boolean;
}) {
  const a = useScalpMetrics(before, enabled);
  const b = useScalpMetrics(after, enabled);
  return (
    <Card>
      <Text style={[s.body, styles.caption]}>Scalp coverage</Text>
      {(a.isPending || b.isPending) && (
        <Text style={s.muted}>Reading hair lines in both photos… a few seconds.</Text>
      )}
      {a.error && <Notice error>{errorMessage(a.error)}</Notice>}
      {b.error && !a.error && <Notice error>{errorMessage(b.error)}</Notice>}
      {a.data && b.data && (
        <>
          <View style={styles.columns}>
            <Column photo={before} metrics={a.data} />
            <Column photo={after} metrics={b.data} />
          </View>
          <Text style={s.body}>{changeLine(a.data, b.data)}</Text>
          <Text style={styles.small}>
            Estimates from these photos alone, scaled to a typical head width.
            Lighting, wetness, styling and the angle all move them. They
            describe the photos, not a diagnosis or a treatment&apos;s effect.
          </Text>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  caption: { fontWeight: "600" },
  columns: { flexDirection: "row", gap: 12 },
  column: { flex: 1, gap: 6 },
  date: { fontSize: 13, fontWeight: "700", color: colors.ink },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  label: { fontSize: 13, color: colors.muted, flexShrink: 1 },
  value: {
    fontSize: 13,
    color: colors.ink,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  small: { fontSize: 12, lineHeight: 16, color: colors.muted },
});
