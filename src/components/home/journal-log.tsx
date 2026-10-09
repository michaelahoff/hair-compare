import { Fragment } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { FramedThumb } from "@/components/framed-photo";
import { MonthHead, Rail } from "@/components/timeline";
import { Icon, colors } from "@/components/ui";
import { usePreferences } from "@/hooks/use-preferences";
import {
  KIND_LABELS,
  VIEW_LABELS,
  formatDate,
  localDate,
  type Journal,
  type Photo,
  type ScalpView,
  type Treatment,
} from "@/lib/model";

type Entry =
  | { kind: "today"; date: string }
  | { kind: "photos"; date: string; photos: Photo[] }
  | {
      kind: "treatment";
      date: string;
      verb: "Started" | "Ended";
      treatment: Treatment;
    };

/** Photos by day and treatment changes, newest first, with today on top. */
export function journalEntries(journal: Journal, today: string): Entry[] {
  const days = new Map<string, Photo[]>();
  const photos = [...journal.photos].sort(
    (a, b) =>
      b.taken_at.localeCompare(a.taken_at) ||
      b.created_at.localeCompare(a.created_at),
  );
  for (const photo of photos) {
    const day = photo.taken_at.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), photo]);
  }
  const entries: Entry[] = [...days].map(([date, items]) => ({
    kind: "photos",
    date,
    photos: items,
  }));
  for (const treatment of journal.treatments) {
    if (treatment.started_on <= today)
      entries.push({
        kind: "treatment",
        date: treatment.started_on,
        verb: "Started",
        treatment,
      });
    if (treatment.ended_on && treatment.ended_on <= today)
      entries.push({
        kind: "treatment",
        date: treatment.ended_on,
        verb: "Ended",
        treatment,
      });
  }
  if (!days.has(today)) entries.push({ kind: "today", date: today });
  // On the same day, photos sit above treatment changes.
  return entries.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      Number(a.kind === "treatment") - Number(b.kind === "treatment"),
  );
}

const THUMB_WIDTH = 66;
const THUMB_HEIGHT = 78;

function monthOf(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/**
 * The journal as a dated log. Photos and treatment changes share one rail,
 * so what was taken sits beside what changed. `highlight` rings a region.
 */
export function JournalLog({
  journal,
  highlight,
}: {
  journal: Journal;
  highlight?: ScalpView;
}) {
  const { preferences } = usePreferences();
  const today = localDate();
  const entries = journalEntries(journal, today);
  return (
    <View style={styles.log}>
      {entries.map((entry, i) => {
        const previous = entries[i - 1];
        const newMonth =
          entry.kind !== "today" &&
          (!previous || monthOf(previous.date) !== monthOf(entry.date));
        const last = i === entries.length - 1;
        const key =
          entry.kind === "treatment"
            ? `${entry.verb}-${entry.treatment.id}`
            : `${entry.kind}-${entry.date}`;
        return (
          <Fragment key={key}>
            {newMonth && <MonthHead first={i === 0}>{monthOf(entry.date)}</MonthHead>}
            {entry.kind === "today" && (
              <Rail date={entry.date} now tone={colors.accent} last={last}>
                <View style={styles.today}>
                  <Text style={styles.todayText}>No photo yet today</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Take photo"
                      onPress={() => router.push("/capture")}
                      style={styles.todayButton}
                    >
                      <Icon name="camera" size={16} color="#FFF" />
                      <Text style={styles.todayButtonText}>Take photo</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Import photos"
                      onPress={() => router.push("/import")}
                      style={[styles.todayButton, styles.todayGhost]}
                    >
                      <Text style={[styles.todayButtonText, { color: colors.accent }]}>
                        Import
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </Rail>
            )}
            {entry.kind === "photos" && (
              <Rail date={entry.date} last={last}>
                <View style={{ gap: 8 }}>
                  <View style={styles.thumbs}>
                    {entry.photos.map((photo) => {
                      const on = highlight === photo.view;
                      return (
                        <Pressable
                          key={photo.id}
                          accessibilityRole="button"
                          accessibilityLabel={`${VIEW_LABELS[photo.view]}, ${formatDate(photo.taken_at)}`}
                          onPress={() =>
                            router.push({
                              pathname: "/photo/[id]",
                              params: { id: photo.id },
                            })
                          }
                          style={({ pressed }) => [
                            styles.thumbWrap,
                            { transform: [{ scale: pressed ? 0.96 : 1 }] },
                          ]}
                        >
                          <FramedThumb
                            photo={photo}
                            turn={preferences.turns[photo.view] ?? 0}
                            width={THUMB_WIDTH}
                            height={THUMB_HEIGHT}
                            style={[styles.thumb, on && styles.thumbOn]}
                          />
                          <Text
                            numberOfLines={1}
                            style={[styles.thumbLabel, on && { color: colors.accent }]}
                          >
                            {VIEW_LABELS[photo.view]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {entry.photos.some((p) => p.notes) && (
                    <Text style={styles.note}>
                      {entry.photos.find((p) => p.notes)!.notes}
                    </Text>
                  )}
                </View>
              </Rail>
            )}
            {entry.kind === "treatment" && (
              <Rail date={entry.date} tone={colors.rust} last={last}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.verb} ${entry.treatment.name}`}
                  onPress={() =>
                    router.push({
                      pathname: "/treatment",
                      params: { id: entry.treatment.id },
                    })
                  }
                  style={({ pressed }) => [styles.event, { opacity: pressed ? 0.8 : 1 }]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.eventTitle}>
                      <Text style={{ color: colors.rust }}>{entry.verb} </Text>
                      {entry.treatment.name}
                    </Text>
                    <Text style={styles.eventMeta}>
                      {KIND_LABELS[entry.treatment.kind]}
                      {entry.treatment.dosage ? ` · ${entry.treatment.dosage}` : ""}
                    </Text>
                  </View>
                  <Icon name="chevron" size={16} color={colors.muted} />
                </Pressable>
              </Rail>
            )}
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  log: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 16,
    paddingTop: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  today: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.accent,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    backgroundColor: colors.accentSoft,
  },
  todayText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  todayButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  todayGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.accent,
  },
  todayButtonText: { color: "#FFF", fontSize: 13, fontWeight: "700" },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumbWrap: { width: THUMB_WIDTH, gap: 4 },
  thumb: { borderRadius: 10 },
  thumbOn: { borderWidth: 2.5, borderColor: colors.accent },
  thumbLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.muted,
    textAlign: "center",
  },
  note: { fontSize: 13, color: colors.muted, fontStyle: "italic", lineHeight: 18 },
  event: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.rustSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  eventTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  eventMeta: { fontSize: 12, color: colors.muted },
});
