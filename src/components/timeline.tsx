import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Eyebrow, colors, fonts } from "./ui";

/**
 * One entry on a dated rail: the day on the left, a dot on the line, the
 * entry on the right. Consecutive rails join into a continuous line.
 */
export function Rail({
  date,
  now = false,
  tone = colors.ink,
  last = false,
  children,
}: {
  /** Calendar day, YYYY-MM-DD. */
  date: string;
  /** Show "now" instead of the day. */
  now?: boolean;
  /** Dot colour: ink for photos, rust for treatments, accent for today. */
  tone?: string;
  /** Ends the line. */
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.rail}>
      <View style={styles.date}>
        <Text style={[styles.day, now && { color: colors.accent }]}>
          {now ? "now" : Number(date.slice(8, 10))}
        </Text>
        {!now && (
          <Text style={styles.weekday}>
            {new Date(`${date}T12:00:00`)
              .toLocaleDateString(undefined, { weekday: "short" })
              .toUpperCase()}
          </Text>
        )}
      </View>
      <View style={styles.track}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        {!last && <View style={styles.line} />}
      </View>
      <View style={[styles.body, last && { paddingBottom: 0 }]}>{children}</View>
    </View>
  );
}

/** "SEPTEMBER 2026", indented past the rail. */
export function MonthHead({ children, first = false }: { children: string; first?: boolean }) {
  return (
    <Eyebrow style={[styles.month, !first && { marginTop: 4 }]}>{children}</Eyebrow>
  );
}

const styles = StyleSheet.create({
  rail: { flexDirection: "row", gap: 12 },
  date: { width: 40, alignItems: "flex-end", paddingTop: 2 },
  day: {
    fontFamily: fonts.mono,
    fontSize: 20,
    fontWeight: "700",
    color: colors.ink,
    lineHeight: 22,
    fontVariant: ["tabular-nums"],
  },
  weekday: { fontFamily: fonts.mono, fontSize: 9, color: colors.muted, letterSpacing: 0.6 },
  track: { width: 14, alignItems: "center" },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  line: { flex: 1, width: 2, backgroundColor: colors.rail, marginTop: 2 },
  body: { flex: 1, paddingBottom: 22 },
  month: { marginBottom: 12, marginLeft: 66 },
});
