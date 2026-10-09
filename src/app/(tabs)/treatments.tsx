import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useJournal } from "@/hooks/use-journal";
import { Button, Empty, Fab, Pill, Screen, colors, fonts, s } from "@/components/ui";
import { JournalState } from "@/components/journal-state";
import { KIND_LABELS, elapsedDays, formatDate, localDate } from "@/lib/model";

export default function TreatmentsScreen() {
  const journal = useJournal();
  const treatments = [...(journal.data?.treatments ?? [])].sort((a, b) =>
    b.started_on.localeCompare(a.started_on),
  );
  const today = localDate();
  return (
    <Screen
      fab={
        <Fab
          icon="plus"
          label="Add treatment"
          onPress={() => router.push("/treatment")}
        />
      }
    >
      <JournalState
        loading={journal.isPending}
        error={journal.error}
        retry={() => void journal.refetch()}
      />
      {!treatments.length && !journal.isPending && !journal.error ? (
        <Empty
          icon="treatments"
          title="No treatments yet"
          action={
            <Button
              label="Add treatment"
              icon="plus"
              onPress={() => router.push("/treatment")}
            />
          }
        />
      ) : (
        treatments.map((t) => {
          const planned = t.started_on > today;
          const ended = t.ended_on !== null && t.ended_on <= today;
          const active = !planned && !ended;
          const days = elapsedDays(t.started_on, ended ? t.ended_on! : today);
          return (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${t.name}`}
              onPress={() =>
                router.push({ pathname: "/treatment", params: { id: t.id } })
              }
              style={({ pressed }) => [
                styles.card,
                { transform: [{ scale: pressed ? 0.98 : 1 }] },
              ]}
            >
              <View style={[styles.rail, active && styles.railActive]} />
              <View style={{ flex: 1, gap: 6 }}>
                <View style={s.wrap}>
                  <Pill tone={active ? "accent" : "neutral"}>
                    {planned ? "Planned" : ended ? "Ended" : "Active"}
                  </Pill>
                  <Pill tone="rust">{KIND_LABELS[t.kind]}</Pill>
                </View>
                <Text style={styles.name}>{t.name}</Text>
                {Boolean(t.dosage) && <Text style={s.muted}>{t.dosage}</Text>}
                <Text style={styles.dates}>
                  {formatDate(t.started_on)} →{" "}
                  {t.ended_on ? formatDate(t.ended_on) : "now"}
                </Text>
              </View>
              {!planned && (
                <View style={{ alignItems: "flex-end" }}>
                  <Text
                    style={[
                      styles.days,
                      { color: active ? colors.accent : colors.muted },
                    ]}
                  >
                    {days}
                  </Text>
                  <Text style={styles.daysUnit}>days</Text>
                </View>
              )}
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 16,
    paddingLeft: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
  rail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: colors.line,
  },
  railActive: { backgroundColor: colors.rust },
  dates: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.muted,
    fontVariant: ["tabular-nums"],
  },
  name: {
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: colors.ink,
  },
  days: {
    fontFamily: fonts.mono,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
  },
  daysUnit: { fontSize: 12, fontWeight: "600", color: colors.muted },
});
