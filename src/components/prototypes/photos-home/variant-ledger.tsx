/**
 * PROTOTYPE C · "Ledger". A dated log read top-down from today. Photos and
 * treatment changes share one rail, so cause and effect sit side by side.
 * Sage paper, moss ink, rust for treatment events; monospaced dates.
 */
import { Fragment, type ReactNode } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui";
import {
  KIND_LABELS,
  VIEW_LABELS,
  elapsedDays,
  localDate,
  type Journal,
  type Photo,
  type ScalpView,
  type Treatment,
} from "@/lib/model";
import { FONT, VIEWS, byDateDesc, monthYear, shortDate } from "./shared";

export const ledger = {
  paper: "#EDF1EC",
  surface: "#FFFFFF",
  ink: "#15211D",
  muted: "#647069",
  line: "#D5DED8",
  rail: "#BFCCC5",
  moss: "#35684B",
  mossSoft: "#DCEADF",
  rust: "#B2552B",
  rustSoft: "#F6E4DA",
};

type Entry =
  | { kind: "today"; date: string }
  | { kind: "photos"; date: string; photos: Photo[] }
  | { kind: "treatment"; date: string; verb: "Started" | "Ended"; treatment: Treatment };

function entriesOf(journal: Journal, today: string): Entry[] {
  const days = new Map<string, Photo[]>();
  for (const p of byDateDesc(journal.photos)) {
    const d = p.taken_at.slice(0, 10);
    days.set(d, [...(days.get(d) ?? []), p]);
  }
  const entries: Entry[] = [...days].map(([date, photos]) => ({ kind: "photos", date, photos }));
  for (const t of journal.treatments) {
    if (t.started_on <= today) entries.push({ kind: "treatment", date: t.started_on, verb: "Started", treatment: t });
    if (t.ended_on && t.ended_on <= today) entries.push({ kind: "treatment", date: t.ended_on, verb: "Ended", treatment: t });
  }
  if (!days.has(today)) entries.push({ kind: "today", date: today });
  // Newest first; on the same day, photos above treatment changes.
  return entries.sort(
    (a, b) => b.date.localeCompare(a.date) || Number(a.kind === "treatment") - Number(b.kind === "treatment"),
  );
}

function Rail({ date, today, tone, children, last }: {
  date: string;
  today: string;
  tone: string;
  children: ReactNode;
  last: boolean;
}) {
  const isToday = date === today;
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ width: 40, alignItems: "flex-end", paddingTop: 2 }}>
        <Text style={[styles.day, isToday && { color: ledger.moss }]}>
          {isToday ? "now" : Number(date.slice(8, 10))}
        </Text>
        {!isToday && (
          <Text style={styles.month}>
            {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={{ width: 14, alignItems: "center" }}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        {!last && <View style={styles.line} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 22 }}>{children}</View>
    </View>
  );
}

/** First and latest photo of `photos` (one region, any order), with a tick per photo. */
export function ProgressStrip({ photos }: { photos: Photo[] }) {
  const span = byDateDesc(photos);
  if (span.length < 2) return null;
  const first = span.at(-1)!;
  const last = span[0];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Compare ${VIEW_LABELS[first.view]}`}
      onPress={() => router.navigate("/compare")}
      style={({ pressed }) => [styles.strip, { opacity: pressed ? 0.9 : 1 }]}
    >
      <Image source={{ uri: first.uri }} style={styles.stripThumb} resizeMode="cover" />
      <View style={{ flex: 1, alignItems: "center", gap: 6 }}>
        <Text style={styles.stripDays}>{elapsedDays(first.taken_at, last.taken_at)} days</Text>
        <View style={styles.stripLine}>
          {span.map((p) => (
            <View key={p.id} style={styles.stripTick} />
          ))}
        </View>
        <Text style={styles.stripLabel}>
          {VIEW_LABELS[first.view]} · {shortDate(first.taken_at)} → {shortDate(last.taken_at)}
        </Text>
      </View>
      <Image source={{ uri: last.uri }} style={styles.stripThumb} resizeMode="cover" />
    </Pressable>
  );
}

/** The dated log. `highlight` rings that region's photos. */
export function LedgerLog({
  journal,
  highlight,
}: {
  journal: Journal;
  highlight?: ScalpView;
}) {
  const today = localDate();
  const entries = entriesOf(journal, today);
  return (
    <View style={styles.log}>
      {entries.map((entry, i) => {
        const prev = entries[i - 1];
        const newMonth = !prev || monthYear(prev.date) !== monthYear(entry.date);
        const last = i === entries.length - 1;
        return (
          <Fragment key={`${entry.kind}-${entry.date}-${"treatment" in entry ? entry.treatment.id : ""}`}>
            {newMonth && entry.kind !== "today" && (
              <Text style={[styles.monthHead, i > 0 && { marginTop: 4 }]}>{monthYear(entry.date).toUpperCase()}</Text>
            )}
            {entry.kind === "today" && (
              <Rail date={entry.date} today={today} tone={ledger.moss} last={last}>
                <View style={styles.todayBox}>
                  <Text style={styles.todayText}>No photo yet today</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Take photo" onPress={() => router.push("/capture")} style={styles.todayBtn}>
                      <Icon name="camera" size={16} color="#FFF" />
                      <Text style={styles.todayBtnText}>Take photo</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Import" onPress={() => router.push("/import")} style={[styles.todayBtn, styles.todayBtnGhost]}>
                      <Text style={[styles.todayBtnText, { color: ledger.moss }]}>Import</Text>
                    </Pressable>
                  </View>
                </View>
              </Rail>
            )}
            {entry.kind === "photos" && (
              <Rail date={entry.date} today={today} tone={ledger.ink} last={last}>
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {entry.photos.map((photo) => {
                      const on = highlight === photo.view;
                      return (
                        <Pressable
                          key={photo.id}
                          accessibilityRole="button"
                          accessibilityLabel={`${VIEW_LABELS[photo.view]}, ${shortDate(photo.taken_at)}`}
                          onPress={() => router.push({ pathname: "/photo/[id]", params: { id: photo.id } })}
                          style={{ width: 66, gap: 4 }}
                        >
                          <Image
                            source={{ uri: photo.uri }}
                            style={[styles.thumb, on && { borderWidth: 2.5, borderColor: ledger.moss }]}
                            resizeMode="cover"
                          />
                          <Text style={[styles.thumbLabel, on && { color: ledger.moss }]} numberOfLines={1}>
                            {VIEW_LABELS[photo.view]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {entry.photos.find((p) => p.notes) && (
                    <Text style={styles.note}>{entry.photos.find((p) => p.notes)!.notes}</Text>
                  )}
                </View>
              </Rail>
            )}
            {entry.kind === "treatment" && (
              <Rail date={entry.date} today={today} tone={ledger.rust} last={last}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.verb} ${entry.treatment.name}`}
                  onPress={() => router.push({ pathname: "/treatment", params: { id: entry.treatment.id } })}
                  style={styles.event}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.eventTitle}>
                      <Text style={{ color: ledger.rust }}>{entry.verb} </Text>
                      {entry.treatment.name}
                    </Text>
                    <Text style={styles.eventMeta}>
                      {KIND_LABELS[entry.treatment.kind]}
                      {entry.treatment.dosage ? ` · ${entry.treatment.dosage}` : ""}
                    </Text>
                  </View>
                  <Icon name="chevron" size={16} color={ledger.muted} />
                </Pressable>
              </Rail>
            )}
          </Fragment>
        );
      })}
    </View>
  );
}

export function LedgerHeader({ journal }: { journal: Journal }) {
  const today = localDate();
  const all = byDateDesc(journal.photos);
  const first = all.at(-1);
  const active = journal.treatments.filter(
    (t) => t.started_on <= today && (!t.ended_on || t.ended_on > today),
  ).length;
  return (
    <View style={styles.header}>
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>Photos</Text>
        <Text style={styles.sub}>
          {first
            ? `${elapsedDays(first.taken_at)} DAYS · ${all.length} PHOTOS · ${active} ACTIVE TREATMENT${active === 1 ? "" : "S"}`
            : "NOTHING LOGGED YET"}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 2 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Import photos" onPress={() => router.push("/import")} style={styles.iconBtn}>
          <Icon name="upload" color={ledger.ink} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Account" onPress={() => router.push("/account")} style={styles.iconBtn}>
          <Icon name="account" color={ledger.ink} />
        </Pressable>
      </View>
    </View>
  );
}

export function VariantLedger({ journal }: { journal: Journal }) {
  const insets = useSafeAreaInsets();
  const all = byDateDesc(journal.photos);
  // Progress strip: the region with the longest record.
  const span = VIEWS.map((v) => all.filter((p) => p.view === v))
    .filter((ps) => ps.length > 1)
    .sort((a, b) => b.length - a.length)[0];
  return (
    <View style={{ flex: 1, backgroundColor: ledger.paper }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 110 }}>
        <View style={{ maxWidth: 560, width: "100%", alignSelf: "center", gap: 20 }}>
          <LedgerHeader journal={journal} />
          {span && <ProgressStrip photos={span} />}
          <LedgerLog journal={journal} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8, color: ledger.ink },
  sub: { fontFamily: FONT.mono, fontSize: 11, color: ledger.muted, letterSpacing: 0.4 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  strip: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: ledger.surface, borderRadius: 18, padding: 10, borderWidth: 1, borderColor: ledger.line },
  stripThumb: { width: 56, height: 66, borderRadius: 10, backgroundColor: ledger.line },
  stripDays: { fontFamily: FONT.mono, fontSize: 15, fontWeight: "700", color: ledger.ink },
  stripLine: { alignSelf: "stretch", height: 2, backgroundColor: ledger.line, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stripTick: { width: 6, height: 6, borderRadius: 3, backgroundColor: ledger.moss, marginTop: -2 },
  stripLabel: { fontSize: 11, color: ledger.muted, fontWeight: "600" },
  log: { backgroundColor: ledger.surface, borderRadius: 22, padding: 16, paddingTop: 14, borderWidth: 1, borderColor: ledger.line },
  monthHead: { fontFamily: FONT.mono, fontSize: 11, color: ledger.muted, letterSpacing: 1, marginBottom: 12, marginLeft: 66 },
  day: { fontFamily: FONT.mono, fontSize: 20, fontWeight: "700", color: ledger.ink, lineHeight: 22 },
  month: { fontFamily: FONT.mono, fontSize: 9, color: ledger.muted, letterSpacing: 0.6 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6, borderWidth: 2, borderColor: ledger.surface },
  line: { flex: 1, width: 2, backgroundColor: ledger.rail, marginTop: 2 },
  thumb: { width: 66, height: 78, borderRadius: 10, backgroundColor: ledger.line },
  thumbLabel: { fontSize: 10, fontWeight: "600", color: ledger.muted, textAlign: "center" },
  note: { fontSize: 13, color: ledger.muted, fontStyle: "italic", lineHeight: 18 },
  event: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: ledger.rustSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  eventTitle: { fontSize: 15, fontWeight: "700", color: ledger.ink },
  eventMeta: { fontSize: 12, color: ledger.muted },
  todayBox: { borderWidth: 1.5, borderStyle: "dashed", borderColor: ledger.moss, borderRadius: 14, padding: 12, gap: 10, backgroundColor: ledger.mossSoft },
  todayText: { fontSize: 14, fontWeight: "600", color: ledger.ink },
  todayBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: ledger.moss },
  todayBtnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: ledger.moss },
  todayBtnText: { color: "#FFF", fontSize: 13, fontWeight: "700" },
});
