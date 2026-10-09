import { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useJournal } from "@/hooks/use-journal";
import { useComparison } from "@/hooks/use-comparison";
import { usePreferences } from "@/hooks/use-preferences";
import {
  Button,
  Card,
  Chips,
  Empty,
  Notice,
  Screen,
  type PageScroll,
  SectionTitle,
  colors,
  s,
} from "@/components/ui";
import { JournalState } from "@/components/journal-state";
import { FramedThumb } from "@/components/framed-photo";
import { ComparisonViewer } from "@/components/comparison-viewer";
import { AnalysisCard } from "@/components/analysis-card";
import {
  VIEW_LABELS,
  elapsedDays,
  formatDate,
  movePair,
  type Photo,
  type ScalpView,
  type Treatment,
} from "@/lib/model";

const THUMB = 68;
const THUMB_GAP = 10;

/**
 * The whole timeline for one side of the pair. Photos past the other side
 * stay choosable and dimmed: picking one moves the other side along too.
 */
function PhotoStrip({
  label,
  photos,
  selected,
  other,
  side,
  onChange,
}: {
  label: string;
  photos: Photo[];
  selected: number;
  other: number;
  side: "before" | "after";
  onChange: (index: number) => void;
}) {
  const scroller = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const { preferences } = usePreferences();
  // Keep the chosen photo in view, including after swiping the panes.
  useEffect(() => {
    if (!width) return;
    const x = selected * (THUMB + THUMB_GAP) - (width - THUMB) / 2;
    scroller.current?.scrollTo({ x: Math.max(0, x), animated: true });
  }, [selected, width]);
  const spansYears =
    photos.length > 0 &&
    photos[0].taken_at.slice(0, 4) !== photos.at(-1)!.taken_at.slice(0, 4);
  return (
    <View style={{ gap: 8 }}>
      <View style={s.row}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.muted}>
          {selected + 1} of {photos.length}
        </Text>
      </View>
      <ScrollView
        ref={scroller}
        horizontal
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        showsHorizontalScrollIndicator={Platform.OS === "web"}
        contentContainerStyle={{ gap: THUMB_GAP }}
      >
        {photos.map((photo, index) => {
          const on = index === selected;
          const isOther = index === other;
          // The last photo can't be a before, nor the first an after.
          const unavailable =
            side === "before" ? index === photos.length - 1 : index === 0;
          const pushes = side === "before" ? index > other : index < other;
          const date = formatDate(photo.taken_at);
          return (
            <Pressable
              key={photo.id}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${date}`}
              accessibilityState={{ selected: on, disabled: unavailable }}
              disabled={unavailable}
              onPress={() => onChange(index)}
              style={{ width: THUMB, gap: 4 }}
            >
              <FramedThumb
                photo={photo}
                turn={preferences.turns[photo.view] ?? 0}
                width={THUMB}
                height={THUMB}
                style={{
                  borderRadius: 14,
                  borderWidth: 3,
                  borderColor: on
                    ? colors.accent
                    : isOther
                      ? colors.line
                      : "transparent",
                  opacity: on ? 1 : unavailable ? 0.25 : pushes ? 0.45 : 0.8,
                }}
              />
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 11,
                  textAlign: "center",
                  color: on ? colors.ink : colors.muted,
                  fontWeight: on ? "700" : "500",
                }}
              >
                {isOther
                  ? side === "before"
                    ? "After"
                    : "Before"
                  : spansYears
                    ? date.replace(/^(\w+) \d+, (\d{2})(\d{2})$/, "$1 \u2019$3")
                    : date.replace(/, \d{4}$/, "")}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** A treatment's active span, drawn against the before → after window. */
function TreatmentSpan({
  treatment: t,
  from,
  to,
}: {
  treatment: Treatment;
  from: string;
  to: string;
}) {
  const total = Math.max(1, elapsedDays(from, to));
  const start = Math.max(0, elapsedDays(from, t.started_on));
  const end = t.ended_on
    ? Math.min(total, elapsedDays(from, t.ended_on))
    : total;
  return (
    <View style={{ gap: 6 }}>
      <View style={s.row}>
        <Text style={[s.body, { fontWeight: "600", flexShrink: 1 }]}>
          {t.name}
        </Text>
        {t.dosage && (
          <Text style={[s.muted, { flexShrink: 1 }]} numberOfLines={1}>
            {t.dosage}
          </Text>
        )}
      </View>
      <View
        style={{ height: 8, borderRadius: 4, backgroundColor: colors.subtle }}
      >
        <View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            borderRadius: 4,
            left: `${(start / total) * 100}%`,
            width: `${(Math.max(0, end - start) / total) * 100}%`,
            backgroundColor: colors.rust,
          }}
        />
      </View>
    </View>
  );
}

export default function CompareScreen() {
  const journal = useJournal();
  const page = useRef<PageScroll>(null);
  const { width, height } = useWindowDimensions();
  const paneHeight = Math.round(
    Math.max(200, Math.min(width - 32, (height - 330) / 2)),
  );
  const comparison = useComparison(journal.data?.photos ?? []);
  const { mode, at } = useLocalSearchParams<{ mode?: string; at?: string }>();
  const { view } = comparison;
  const { ordered: photos, before, after } = comparison.pairOf(view);
  const afterIndex = photos.findIndex((p) => p.id === after?.id);
  const beforeIndex = photos.findIndex((p) => p.id === before?.id);
  function choose(side: "before" | "after", index: number) {
    const next = movePair(
      photos.length,
      { before: beforeIndex, after: afterIndex },
      side,
      index,
    );
    comparison.choose(view, photos[next.before].id, photos[next.after].id);
  }
  // Swiping a pane walks its side through time, stopping at the timeline's ends.
  const beforeSteps = {
    onOlder:
      beforeIndex > 0 ? () => choose("before", beforeIndex - 1) : undefined,
    onNewer:
      beforeIndex < photos.length - 2
        ? () => choose("before", beforeIndex + 1)
        : undefined,
  };
  const afterSteps = {
    onOlder: afterIndex > 1 ? () => choose("after", afterIndex - 1) : undefined,
    onNewer:
      afterIndex < photos.length - 1
        ? () => choose("after", afterIndex + 1)
        : undefined,
  };
  // Only this pair's own analysis: one against another photo would mislead.
  const analysis = (journal.data?.analyses ?? [])
    .filter((a) => a.photo_id === after?.id && a.previous_photo_id === before?.id)
    .at(-1);
  const treatments = (journal.data?.treatments ?? []).filter(
    (t) =>
      before &&
      after &&
      t.started_on <= after.taken_at.slice(0, 10) &&
      (!t.ended_on || t.ended_on >= before.taken_at.slice(0, 10)),
  );
  const differences =
    before && after
      ? [
          before.hair_length &&
            after.hair_length &&
            before.hair_length !== after.hair_length &&
            "hair length",
          before.hair_wet !== after.hair_wet && "wetness",
        ].filter(Boolean)
      : [];
  return (
    <Screen scroller={page}>
      <Chips
        selected={view}
        onChange={comparison.setView}
        values={Object.entries(VIEW_LABELS).map(([value, label]) => ({
          value: value as ScalpView,
          label,
        }))}
      />
      <JournalState
        loading={journal.isPending || !comparison.ready}
        error={journal.error}
        retry={() => void journal.refetch()}
      />
      {!journal.isPending &&
      comparison.ready &&
      !journal.error &&
      photos.length < 2 ? (
        <Empty
          icon="compare"
          title={`Needs two ${VIEW_LABELS[view].toLowerCase()} photos`}
          action={
            <Button
              label="Take photo"
              icon="camera"
              onPress={() =>
                router.push({ pathname: "/capture", params: { view } })
              }
            />
          }
        />
      ) : (
        before &&
        after && (
          <>
            <ComparisonViewer
              before={before}
              after={after}
              photos={photos}
              paneHeight={paneHeight}
              analyses={journal.data?.analyses ?? []}
              treatments={journal.data?.treatments ?? []}
              beforeSteps={beforeSteps}
              afterSteps={afterSteps}
              changeRequest={mode === "change" ? (at ?? "1") : undefined}
              onWatch={() => page.current?.scrollTo({ y: 0, animated: true })}
            />
            {differences.length > 0 && (
              <Notice>Different {differences.join(" and ")}.</Notice>
            )}
            <Card>
              <PhotoStrip
                label="Before"
                side="before"
                photos={photos}
                selected={beforeIndex}
                other={afterIndex}
                onChange={(index) => choose("before", index)}
              />
              <PhotoStrip
                label="After"
                side="after"
                photos={photos}
                selected={afterIndex}
                other={beforeIndex}
                onChange={(index) => choose("after", index)}
              />
            </Card>
            {treatments.length > 0 && (
              <>
                <SectionTitle>Treatments</SectionTitle>
                <Card>
                  {treatments.map((t) => (
                    <TreatmentSpan
                      key={t.id}
                      treatment={t}
                      from={before.taken_at}
                      to={after.taken_at}
                    />
                  ))}
                </Card>
              </>
            )}
            {analysis && <AnalysisCard analysis={analysis} />}
          </>
        )
      )}
    </Screen>
  );
}
