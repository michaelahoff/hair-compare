import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { colors, fonts } from "@/components/ui";
import { useTimelineMetrics } from "@/hooks/use-scalp-metrics";
import { errorMessage, shortDate, type Photo, type Treatment } from "@/lib/model";
import type { ScalpMetrics } from "@/lib/scalp/metrics";

const HEIGHT = 120;
const PAD = { left: 34, right: 10, top: 12, bottom: 24 };

type Point = { photo: Photo; metrics: ScalpMetrics; t: number };

/**
 * One series over time, drawn as a line through the photos that have it.
 * Photos with the same hair length join up; a change of hair length breaks
 * the line, since the figures aren't comparable across it.
 */
function series(
  points: Point[],
  value: (m: ScalpMetrics) => number | null,
): { x: number; y: number; photo: Photo; value: number }[][] {
  const runs: { x: number; y: number; photo: Photo; value: number }[][] = [];
  let run: { x: number; y: number; photo: Photo; value: number }[] = [];
  let length: string | null | undefined;
  for (const p of points) {
    const v = value(p.metrics);
    const hair = p.photo.hair_length;
    if (v === null || !Number.isFinite(v)) continue;
    if (run.length && hair !== length) {
      runs.push(run);
      run = [];
    }
    length = hair;
    run.push({ x: p.t, y: v, photo: p.photo, value: v });
  }
  if (run.length) runs.push(run);
  return runs;
}

/**
 * Crown coverage over a view's timeline: the crown-to-ring hair-line ratio
 * where hair is short enough to count lines, and the share of the head
 * showing scalp for every photo. Treatments start as ticks along the base.
 */
export function CoverageTrend({
  photos,
  treatments,
  width,
  enabled,
}: {
  /** The view's photos, oldest first. */
  photos: Photo[];
  treatments: Treatment[];
  width: number;
  enabled: boolean;
}) {
  const rows = useTimelineMetrics(photos, enabled);
  const points = useMemo(
    () =>
      rows
        .filter((r): r is typeof r & { metrics: ScalpMetrics } => Boolean(r.metrics))
        .map((r) => ({ photo: r.photo, metrics: r.metrics, t: Date.parse(r.photo.taken_at) })),
    [rows],
  );
  const pending = rows.filter((r) => r.loading).length;
  const failed = rows.filter((r) => r.error);
  if (!photos.length) return null;
  const t0 = Date.parse(photos[0].taken_at);
  const t1 = Math.max(t0 + 86400000, Date.parse(photos[photos.length - 1].taken_at));
  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * plotW;
  const ratio = series(points, (m) => (m.linesReliable ? m.crownToRing : null));
  const exposure = series(points, (m) => m.exposure);
  const yRatio = (v: number) => PAD.top + (1 - Math.min(1, v)) * plotH;
  const yExposure = (v: number) => PAD.top + (1 - Math.min(1, v / 0.4)) * plotH;
  const path = (run: { x: number; y: number }[], y: (v: number) => number) =>
    run.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join("");

  return (
    <View style={{ gap: 6 }}>
      <Svg width={width} height={HEIGHT}>
        <Rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill={colors.subtle} rx={6} />
        {[0, 0.5, 1].map((v) => (
          <Line
            key={v}
            x1={PAD.left}
            x2={PAD.left + plotW}
            y1={yRatio(v)}
            y2={yRatio(v)}
            stroke={colors.line}
            strokeWidth={1}
          />
        ))}
        {[0, 0.5, 1].map((v) => (
          <SvgText
            key={`l${v}`}
            x={PAD.left - 6}
            y={yRatio(v) + 4}
            fontSize={10}
            fill={colors.muted}
            textAnchor="end"
          >
            {v.toFixed(1)}
          </SvgText>
        ))}
        {treatments.map((t) => {
          const at = Date.parse(`${t.started_on}T12:00:00`);
          if (!(at >= t0 && at <= t1)) return null;
          return (
            <Line
              key={t.id}
              x1={x(at)}
              x2={x(at)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke={colors.rust}
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
          );
        })}
        {exposure.map((run, i) => (
          <Path
            key={`e${i}`}
            d={path(run, yExposure)}
            stroke={colors.muted}
            strokeWidth={1.5}
            fill="none"
            strokeDasharray="4 3"
          />
        ))}
        {ratio.map((run, i) => (
          <Path
            key={`r${i}`}
            d={path(run, yRatio)}
            stroke={colors.accent}
            strokeWidth={2.5}
            fill="none"
          />
        ))}
        {ratio.flat().map((p) => (
          <Circle
            key={p.photo.id}
            cx={x(p.x)}
            cy={yRatio(p.y)}
            r={4}
            fill={colors.accent}
            stroke={colors.surface}
            strokeWidth={1.5}
          />
        ))}
        <SvgText x={PAD.left} y={HEIGHT - 8} fontSize={10} fill={colors.muted}>
          {shortDate(photos[0].taken_at)}
        </SvgText>
        <SvgText
          x={PAD.left + plotW}
          y={HEIGHT - 8}
          fontSize={10}
          fill={colors.muted}
          textAnchor="end"
        >
          {shortDate(photos[photos.length - 1].taken_at)}
        </SvgText>
      </Svg>
      <Text style={styles.legend}>
        <Text style={{ color: colors.accent, fontWeight: "700" }}>— crown ÷ ring</Text>
        {"  (short hair only)   "}
        <Text style={{ color: colors.muted, fontWeight: "700" }}>- - scalp showing</Text>
        {"  (0 to 40%)"}
        {treatments.length ? "   ¦ treatment start" : ""}
      </Text>
      {pending > 0 && (
        <Text style={styles.note}>Reading {pending} more {pending === 1 ? "photo" : "photos"}…</Text>
      )}
      {!pending && failed.length > 0 && (
        <Text style={styles.note}>
          {failed.length === 1 ? "One photo" : `${failed.length} photos`} couldn&apos;t be
          read and {failed.length === 1 ? "is" : "are"} left out: {errorMessage(failed[0].error)}
        </Text>
      )}
      {!pending && ratio.flat().length === 0 && (
        <Text style={styles.note}>
          Hair lines can only be counted on photos marked buzzed or short. Scalp showing
          is drawn for every photo, but long hair, wetness and styling move it.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { fontSize: 11, color: colors.muted, fontFamily: fonts.mono },
  note: { fontSize: 12, lineHeight: 16, color: colors.muted },
});
