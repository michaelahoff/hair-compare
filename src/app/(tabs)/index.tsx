import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useJournal } from "@/hooks/use-journal";
import { useComparison } from "@/hooks/use-comparison";
import {
  Button,
  Empty,
  Eyebrow,
  Icon,
  Screen,
  colors,
  s,
} from "@/components/ui";
import { JournalState } from "@/components/journal-state";
import {
  FRESHNESS_COLOR,
  FRESHNESS_LABEL,
  FRESHNESS_TONE,
  HeadMap,
  freshness,
  type Freshness,
} from "@/components/home/head-map";
import { ProgressStrip } from "@/components/home/progress-strip";
import { JournalLog } from "@/components/home/journal-log";
import {
  SCALP_VIEWS,
  VIEW_LABELS,
  elapsedDays,
  localDate,
  type Photo,
  type ScalpView,
} from "@/lib/model";

function ago(date: string) {
  const days = elapsedDays(date);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

/**
 * Home: the journal's span for one region, the head to pick that region,
 * and the dated log beneath. The region is the one Compare shows, so the
 * two screens stay in step.
 */
export default function PhotosScreen() {
  const journal = useJournal();
  const { width } = useWindowDimensions();
  const photos = journal.data?.photos ?? [];
  const comparison = useComparison(photos);
  const view = comparison.view;
  const latest = Object.fromEntries(
    SCALP_VIEWS.map((v) => [
      v,
      photos
        .filter((p) => p.view === v)
        .reduce<Photo | undefined>(
          (best, p) => (!best || p.taken_at > best.taken_at ? p : best),
          undefined,
        ),
    ]),
  ) as Record<ScalpView, Photo | undefined>;
  const fresh = Object.fromEntries(
    SCALP_VIEWS.map((v) => [v, freshness(latest[v])]),
  ) as Record<ScalpView, Freshness>;
  // The region most in need of a photo, if that isn't the one selected.
  const rank: Freshness[] = ["due", "aging"];
  const overdue = [...SCALP_VIEWS]
    .filter((v) => v !== view && rank.includes(fresh[v]))
    .sort((a, b) => rank.indexOf(fresh[a]) - rank.indexOf(fresh[b]))[0];
  const { ordered, before, after } = comparison.pairOf(view);
  const first = photos.reduce<Photo | undefined>(
    (best, p) => (!best || p.taken_at < best.taken_at ? p : best),
    undefined,
  );
  const today = localDate();
  const active = (journal.data?.treatments ?? []).filter(
    (t) => t.started_on <= today && (!t.ended_on || t.ended_on > today),
  ).length;
  const map = Math.min(168, (Math.min(width, 560) - 32 - 36) * 0.44);
  const ready = !journal.isPending && !journal.error && comparison.ready;
  return (
    <Screen>
      <JournalState
        loading={journal.isPending || (!journal.error && !comparison.ready)}
        error={journal.error}
        retry={() => void journal.refetch()}
      />
      {ready && !photos.length && (
        <Empty
          icon="camera"
          title="Take your first photo"
          action={
            <View style={{ gap: 8, alignSelf: "stretch" }}>
              <Button
                label="Take photo"
                icon="camera"
                onPress={() => router.push("/capture")}
              />
              <Button
                label="Import from library"
                icon="upload"
                variant="secondary"
                onPress={() => router.push("/import")}
              />
            </View>
          }
        />
      )}
      {ready && photos.length > 0 && first && (
        <>
          <Eyebrow style={{ marginTop: -4 }}>
            {`${elapsedDays(first.taken_at)} days · ${photos.length} photo${photos.length === 1 ? "" : "s"} · ${active} active treatment${active === 1 ? "" : "s"}`}
          </Eyebrow>

          {before && after && before.id !== after.id ? (
            <ProgressStrip
              before={before}
              after={after}
              count={ordered.length}
              turn={comparison.turns[view] ?? 0}
              onPress={() => router.navigate("/compare")}
            />
          ) : (
            <View style={styles.stripEmpty}>
              <Text style={styles.stripEmptyText}>
                {ordered.length
                  ? `One ${VIEW_LABELS[view].toLowerCase()} photo so far. The next one starts the comparison.`
                  : `No ${VIEW_LABELS[view].toLowerCase()} photos yet.`}
              </Text>
            </View>
          )}

          <View style={styles.head}>
            <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
              <HeadMap
                size={map}
                selected={view}
                fresh={fresh}
                onSelect={comparison.setView}
              />
              <View style={{ flex: 1, gap: 5 }}>
                <Eyebrow tone={FRESHNESS_TONE[fresh[view]]}>
                  {FRESHNESS_LABEL[fresh[view]]}
                </Eyebrow>
                <Text style={styles.region}>{VIEW_LABELS[view]}</Text>
                <Text style={s.muted}>
                  {ordered.length
                    ? `${ordered.length} photo${ordered.length === 1 ? "" : "s"} · last ${ago(latest[view]!.taken_at)}`
                    : "Tap a region to switch"}
                </Text>
                <Button
                  label="Photograph"
                  icon="camera"
                  style={styles.photograph}
                  onPress={() =>
                    router.push({ pathname: "/capture", params: { view } })
                  }
                />
              </View>
            </View>
            {overdue && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${VIEW_LABELS[overdue]}, ${FRESHNESS_LABEL[fresh[overdue]].toLowerCase()}`}
                onPress={() => comparison.setView(overdue)}
                style={styles.nudge}
              >
                <View style={[styles.dot, { backgroundColor: FRESHNESS_COLOR[fresh[overdue]] }]} />
                <Text style={styles.nudgeText}>
                  {VIEW_LABELS[overdue]} {FRESHNESS_LABEL[fresh[overdue]].toLowerCase()}
                  {latest[overdue] ? ` · last ${ago(latest[overdue]!.taken_at)}` : ""}
                </Text>
                <Icon name="chevron" size={14} color={colors.muted} />
              </Pressable>
            )}
            <View style={styles.legend}>
              {SCALP_VIEWS.map((v) => (
                <Pressable
                  key={v}
                  accessibilityRole="button"
                  accessibilityLabel={`${VIEW_LABELS[v]}, ${FRESHNESS_LABEL[fresh[v]].toLowerCase()}`}
                  accessibilityState={{ selected: v === view }}
                  onPress={() => comparison.setView(v)}
                  style={[styles.legendItem, v === view && styles.legendOn]}
                >
                  <View style={[styles.dot, { backgroundColor: FRESHNESS_COLOR[fresh[v]] }]} />
                  <Text style={[styles.legendText, v === view && { color: colors.ink }]}>
                    {VIEW_LABELS[v]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <JournalLog journal={journal.data!} highlight={view} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stripEmpty: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  stripEmptyText: { fontSize: 13, color: colors.muted, textAlign: "center" },
  head: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  region: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.6,
    color: colors.ink,
    lineHeight: 30,
  },
  photograph: { marginTop: 6, alignSelf: "flex-start", minHeight: 42 },
  nudge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.subtle,
  },
  nudgeText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.ink },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 999,
    backgroundColor: colors.bg,
  },
  legendOn: { backgroundColor: colors.accentSoft },
  legendText: { fontSize: 12, fontWeight: "600", color: colors.muted },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
