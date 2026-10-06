import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, IconButton, colors } from "./ui";
import { localDate } from "@/lib/model";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function dayKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function daysIn(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

/** Rounded month calendar in a floating bottom sheet. Days are YYYY-MM-DD. */
export function CalendarSheet({
  value,
  minimumDate,
  maximumDate,
  onSelect,
  onClose,
}: {
  value: string | null;
  minimumDate?: string;
  maximumDate?: string;
  onSelect: (day: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const today = localDate();
  const start =
    value ?? (maximumDate && maximumDate < today ? maximumDate : today);
  const [cursor, setCursor] = useState({
    year: Number(start.slice(0, 4)),
    month: Number(start.slice(5, 7)) - 1,
  });
  const [picking, setPicking] = useState<"day" | "year">("day");
  const { year, month } = cursor;
  const outOfRange = (day: string) =>
    Boolean(
      (minimumDate && day < minimumDate) || (maximumDate && day > maximumDate),
    );
  const prev = month
    ? { year, month: month - 1 }
    : { year: year - 1, month: 11 };
  const next =
    month < 11 ? { year, month: month + 1 } : { year: year + 1, month: 0 };
  const prevDisabled = Boolean(
    minimumDate &&
    dayKey(prev.year, prev.month, daysIn(prev.year, prev.month)) < minimumDate,
  );
  const nextDisabled = Boolean(
    maximumDate && dayKey(next.year, next.month, 1) > maximumDate,
  );
  const thisYear = Number(today.slice(0, 4));
  const firstYear = minimumDate
    ? Number(minimumDate.slice(0, 4))
    : thisYear - 25;
  const lastYear = maximumDate ? Number(maximumDate.slice(0, 4)) : thisYear + 5;
  const years = Array.from(
    { length: lastYear - firstYear + 1 },
    (_, i) => lastYear - i,
  );
  const cells: (number | null)[] = [
    ...Array(new Date(year, month, 1).getDay()).fill(null),
    ...Array.from({ length: daysIn(year, month) }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) =>
    cells.slice(i * 7, i * 7 + 7),
  );
  const title = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close calendar"
        style={styles.backdrop}
        onPress={onClose}
      />
      <View
        pointerEvents="box-none"
        style={[styles.anchor, { paddingBottom: insets.bottom + 12 }]}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${title}. Choose year`}
              onPress={() => setPicking(picking === "day" ? "year" : "day")}
              style={styles.titleButton}
            >
              <Text style={styles.title}>{title}</Text>
              <Icon
                name={picking === "day" ? "down" : "up"}
                size={16}
                color={colors.accent}
              />
            </Pressable>
            {picking === "day" && (
              <View style={{ flexDirection: "row" }}>
                <IconButton
                  icon="left"
                  label="Previous month"
                  disabled={prevDisabled}
                  onPress={() => setCursor(prev)}
                />
                <IconButton
                  icon="right"
                  label="Next month"
                  disabled={nextDisabled}
                  onPress={() => setCursor(next)}
                />
              </View>
            )}
          </View>
          {picking === "year" ? (
            <ScrollView style={{ maxHeight: 300 }}>
              <View style={styles.years}>
                {years.map((y) => (
                  <Pressable
                    key={y}
                    accessibilityRole="button"
                    accessibilityState={{ selected: y === year }}
                    onPress={() => {
                      setCursor({ year: y, month });
                      setPicking("day");
                    }}
                    style={[styles.year, y === year && styles.selected]}
                  >
                    <Text
                      style={[styles.yearText, y === year && { color: "#FFF" }]}
                    >
                      {y}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          ) : (
            <View>
              <View style={styles.week}>
                {WEEKDAYS.map((d, i) => (
                  <Text key={i} style={styles.weekday}>
                    {d}
                  </Text>
                ))}
              </View>
              {weeks.map((week, w) => (
                <View key={w} style={styles.week}>
                  {week.map((day, i) => {
                    if (!day) return <View key={i} style={styles.cell} />;
                    const key = dayKey(year, month, day);
                    const selected = key === value;
                    const disabled = outOfRange(key);
                    return (
                      <View key={i} style={styles.cell}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={new Date(
                            year,
                            month,
                            day,
                          ).toLocaleDateString(undefined, {
                            dateStyle: "long",
                          })}
                          accessibilityState={{ selected, disabled }}
                          disabled={disabled}
                          onPress={() => onSelect(key)}
                          style={({ pressed }) => [
                            styles.day,
                            key === today && styles.today,
                            selected && styles.selected,
                            pressed && !selected && styles.pressed,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayText,
                              selected && { color: "#FFF", fontWeight: "700" },
                              disabled && { color: "#C3CCC8" },
                            ]}
                          >
                            {day}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          )}
          {!outOfRange(today) && today !== value && (
            <Pressable
              accessibilityRole="button"
              onPress={() => onSelect(today)}
              style={({ pressed }) => [
                styles.todayButton,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={styles.todayButtonText}>Today</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(15,26,23,0.45)",
  },
  anchor: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 12,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: 28,
    padding: 16,
    paddingTop: 10,
    gap: 6,
    shadowColor: colors.stage,
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink },
  week: { flexDirection: "row" },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
    paddingVertical: 6,
  },
  cell: { flex: 1, alignItems: "center", paddingVertical: 2 },
  day: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: {
    fontSize: 16,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  today: { borderWidth: 2, borderColor: colors.accentSoft },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { backgroundColor: colors.subtle },
  years: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 4 },
  year: {
    width: "23%",
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.subtle,
  },
  yearText: { fontSize: 15, fontWeight: "600", color: colors.ink },
  todayButton: {
    alignSelf: "center",
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  todayButtonText: { fontSize: 15, fontWeight: "700", color: colors.accent },
});
