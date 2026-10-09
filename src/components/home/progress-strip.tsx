import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FramedThumb } from "@/components/framed-photo";
import { colors, fonts } from "@/components/ui";
import { VIEW_LABELS, elapsedDays, formatDate, type Photo } from "@/lib/model";

const THUMB = 56;

function shortDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric" },
  );
}

/**
 * A region's before and after, lined up, with a tick for every photo in
 * between. Opens the comparison.
 */
export function ProgressStrip({
  before,
  after,
  count,
  turn,
  onPress,
}: {
  before: Photo;
  after: Photo;
  /** Photos of the region, for the ticks. */
  count: number;
  turn: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Compare ${VIEW_LABELS[after.view]}: ${formatDate(before.taken_at)} to ${formatDate(after.taken_at)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.strip, { opacity: pressed ? 0.9 : 1 }]}
    >
      {[before, after].map((photo) => (
        <FramedThumb
          key={photo.id}
          photo={photo}
          turn={turn}
          width={THUMB}
          height={THUMB + 10}
          style={styles.thumb}
        />
      )).reduce<ReactNode[]>((row, thumb, i) => {
        if (i === 0) return [thumb];
        return [
          ...row,
          <View key="middle" style={styles.middle}>
            <Text style={styles.days}>
              {elapsedDays(before.taken_at, after.taken_at)} days
            </Text>
            <View style={styles.line}>
              {Array.from({ length: Math.min(count, 12) }, (_, k) => (
                <View key={k} style={styles.tick} />
              ))}
            </View>
            <Text style={styles.label}>
              {VIEW_LABELS[after.view]} · {shortDate(before.taken_at)} →{" "}
              {shortDate(after.taken_at)}
            </Text>
          </View>,
          thumb,
        ];
      }, [])}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  thumb: { borderRadius: 10 },
  middle: { flex: 1, alignItems: "center", gap: 6 },
  days: {
    fontFamily: fonts.mono,
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  line: {
    alignSelf: "stretch",
    height: 2,
    backgroundColor: colors.line,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tick: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginTop: -2,
  },
  label: { fontSize: 11, color: colors.muted, fontWeight: "600" },
});
