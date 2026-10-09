import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import { Stack, router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  Empty,
  Icon,
  Notice,
  Pill,
  Screen,
  Segmented,
  colors,
  s,
} from "@/components/ui";
import { JournalState } from "@/components/journal-state";
import { AI_MATCH } from "@/components/match-choices";
import { PIN_COLORS, PinMarker } from "@/components/pin-marker";
import { AiBubble, ScanOverlay, useScanTour } from "@/components/scan";
import {
  FineTune,
  FramingEditor,
  loadFraming,
  settledFraming,
  snapFeedback,
  snapFraming,
  useFramingEdit,
  type FramingEdit,
} from "@/components/framed-photo";
import { useJournal, useJournalMutation } from "@/hooks/use-journal";
import { useViewGuide } from "@/hooks/use-preferences";
import { saveAlignment } from "@/lib/repository";
import { requestDevMatch } from "@/lib/dev-analysis";
import { POINT_TOLERANCE } from "@/lib/match";
import { IDENTITY, framingOf } from "@/lib/framing";
import { inspectPoints, pinPresets, type PinPreset } from "@/lib/guide-art";
import {
  MAX_PINS,
  fitToPins,
  nextSpot,
  pairPins,
  pinAt,
  pinsFromMatch,
  type PairPin,
} from "@/lib/pins";
import { matchLines } from "@/lib/scan-script";
import type { Point } from "@/lib/outline";
import { errorMessage, formatDate, type Photo } from "@/lib/model";

const SEAM = 4;
type Side = "before" | "after";

/**
 * Adjust two photos of a view together: move both onto the guide as one,
 * or each on its own, and pin features so one photo follows the other.
 */
export default function AdjustScreen() {
  const params = useLocalSearchParams<{
    /** The photo the other is lined up to; it only moves when you move it. */
    ref: string;
    /** The photo being lined up; pins move it onto `ref`. */
    id: string;
  }>();
  const journal = useJournal();
  const photos = journal.data?.photos ?? [];
  const reference = photos.find((p) => p.id === params.ref);
  const photo = photos.find((p) => p.id === params.id);
  return (
    <Screen>
      <Stack.Screen options={{ title: "Adjust pair" }} />
      <JournalState
        loading={journal.isPending}
        error={journal.error}
        retry={() => void journal.refetch()}
      />
      {(!reference || !photo) && !journal.isPending && !journal.error && (
        <Empty icon="photos" title="Photos not found" />
      )}
      {reference && photo && (
        <Adjust
          key={`${reference.id}-${photo.id}`}
          reference={reference}
          photo={photo}
        />
      )}
    </Screen>
  );
}

function Adjust({ reference, photo }: { reference: Photo; photo: Photo }) {
  const view = photo.view;
  // Shown in date order; `moving` is the side the pins move.
  const earlier = reference.taken_at <= photo.taken_at;
  const shown: Record<Side, Photo> = earlier
    ? { before: reference, after: photo }
    : { before: photo, after: reference };
  const moving: Side = earlier ? "after" : "before";
  const fixed: Side = moving === "after" ? "before" : "after";
  const { width, height } = useWindowDimensions();
  const { turn, variant: guide, turnGuide } = useViewGuide(view);
  const paneHeight = Math.round(
    Math.max(200, Math.min(Math.min(width, 560) - 32, (height - 420) / 2)),
  );
  const start = {
    before: framingOf(shown.before) ?? IDENTITY,
    after: framingOf(shown.after) ?? IDENTITY,
  };
  const edits: Record<Side, FramingEdit> = {
    before: useFramingEdit(start.before),
    after: useFramingEdit(start.after),
  };
  const [firstPins] = useState(() =>
    pairPins(
      shown.before,
      start.before,
      framingOf(shown.before)?.pins ?? [],
      shown.after,
      start.after,
      framingOf(shown.after)?.pins ?? [],
    ),
  );
  const [pins, setPins] = useState<PairPin[]>(firstPins);
  const [together, setTogether] = useState(true);
  const [active, setActive] = useState<Side>(moving);
  const [aiBusy, setAiBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // The moving photo follows its pins onto the fixed photo's.
  function follow(next: PairPin[]) {
    setPins(next);
    if (!next.length) return;
    snapFraming(
      edits[moving],
      fitToPins(
        shown[fixed],
        settledFraming(edits[fixed]),
        shown[moving],
        settledFraming(edits[moving]),
        next.map((p) => ({ ...p, before: p[fixed], after: p[moving] })),
      ),
    );
  }
  function move(side: Side, id: string, at: Point) {
    follow(pins.map((p) => (p.id === id ? { ...p, [side]: at } : p)));
  }
  function add(preset: PinPreset) {
    // A pin starts where the guide's picture shows the feature, in both
    // photos. Spots step along a little so new ones don't stack.
    const spot =
      preset.id === "spot" ? nextSpot(pins, randomUUID().slice(0, 8)) : null;
    const step = spot ? spot.n - 1 : 0;
    const x = spot ? preset.x + ((step % 4) - 1.5) * 11 : preset.x;
    const y = spot ? preset.y + Math.floor(step / 4) * 11 : preset.y;
    setPins([
      ...pins,
      {
        id: spot?.id ?? preset.id,
        name: spot?.name ?? preset.name,
        before: pinAt(x, y, shown.before, settledFraming(edits.before)),
        after: pinAt(x, y, shown.after, settledFraming(edits.after)),
      },
    ]);
    Haptics.selectionAsync().catch(() => {});
  }
  async function aiPins() {
    setAiBusy(true);
    setMessage("");
    setError("");
    try {
      const { result, sizes } = await requestDevMatch(shown.before, shown.after);
      const found = result.same_area
        ? pinsFromMatch(
            result.points,
            sizes,
            POINT_TOLERANCE,
            `ai-${randomUUID().slice(0, 8)}`,
          )
        : [];
      if (found.length < 2) {
        setMessage(
          "Claude couldn't find enough of the same spots in both photos. Pin them by hand.",
        );
        return;
      }
      follow(found);
      snapFeedback();
      setMessage(
        `Claude placed ${found.length} pins. Drag any that are off; the ${moving} photo follows.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAiBusy(false);
    }
  }
  function reset() {
    loadFraming(edits.before, framingOf(shown.before));
    loadFraming(edits.after, framingOf(shown.after));
    setPins(firstPins);
    setMessage("");
  }
  const save = useJournalMutation(async (owner: string) => {
    for (const side of ["before", "after"] as const) {
      // A photo left where it was keeps how it got there; one moved here was
      // placed by hand.
      const kept = framingOf(shown[side]);
      await saveAlignment(owner, shown[side].id, {
        ...settledFraming(edits[side]),
        source: edits[side].touched.get() ? "manual" : (kept?.source ?? "auto"),
        pins: pins.map((p) => ({ id: p.id, name: p.name, ...p[side] })),
      });
    }
  });
  async function persist() {
    setError("");
    try {
      await save.mutateAsync();
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  // Claude's look at both photos, shown as the scan over them.
  const tour = useScanTour(
    matchLines(view, guide, formatDate(shown[fixed].taken_at), true),
    { scanning: aiBusy, points: inspectPoints(view, guide), everyMs: 2200 },
  );

  const available = pinPresets(view, guide).filter(
    (p) => p.id === "spot" || !pins.some((pin) => pin.id === p.id),
  );
  return (
    <>
      <View style={[s.stage, { gap: SEAM }]}>
        {(["before", "after"] as const).map((side) => (
          <FramingEditor
            key={side}
            photo={shown[side]}
            edit={edits[side]}
            linked={
              together
                ? edits[side === "before" ? "after" : "before"]
                : undefined
            }
            turn={turn}
            guide={guide}
            height={paneHeight}
            active={!together && active === side}
            onActivate={() => setActive(side)}
            overlay={(frameWidth) => (
              <>
                {aiBusy && (
                  <ScanOverlay
                    scanner={tour.scanner}
                    width={frameWidth}
                    height={paneHeight}
                    turn={turn}
                  />
                )}
                {pins.map((pin, i) => (
                  <PinMarker
                    key={pin.id}
                    id={pin.id}
                    n={i + 1}
                    name={pin.name}
                    color={PIN_COLORS[i % PIN_COLORS.length]}
                    at={pin[side]}
                    photo={shown[side]}
                    edit={edits[side]}
                    turn={turn}
                    width={frameWidth}
                    height={paneHeight}
                    onMove={(id, at) => move(side, id, at)}
                  />
                ))}
                <View pointerEvents="none" style={styles.tag}>
                  <Pill tone="dark">
                    {side === "before" ? "Before" : "After"} ·{" "}
                    {formatDate(shown[side].taken_at)}
                  </Pill>
                </View>
                {side === "before" && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Turn guide"
                    onPress={turnGuide}
                    style={styles.round}
                  >
                    <Icon name="turn" size={18} color="#FFF" />
                  </Pressable>
                )}
              </>
            )}
          />
        ))}
        {aiBusy && tour.line && (
          <View
            pointerEvents="none"
            style={[styles.voice, { bottom: paneHeight + SEAM / 2 - 22 }]}
          >
            <AiBubble text={tour.line} thinking />
          </View>
        )}
      </View>
      <Card>
        <Segmented
          values={[
            { value: "together", label: "Move together" },
            { value: "apart", label: "Move separately" },
          ]}
          selected={together ? "together" : "apart"}
          onChange={(value) => setTogether(value === "together")}
        />
        <Text style={s.muted}>
          {together
            ? "Drag, pinch or twist either photo to move both onto the guide."
            : "Drag, pinch or twist each photo on its own. The buttons move the outlined one."}{" "}
          Pins mark the same spot in each photo: drag each onto it, and the{" "}
          {moving} photo follows.
        </Text>
        <FineTune
          edit={edits[together ? fixed : active]}
          linked={together ? edits[moving] : undefined}
        />
        {pins.length > 0 && (
          <View style={s.wrap}>
            {pins.map((pin, i) => (
              <Pressable
                key={pin.id}
                accessibilityRole="button"
                accessibilityLabel={`Remove the ${pin.name} pin`}
                onPress={() => follow(pins.filter((p) => p.id !== pin.id))}
                style={styles.chip}
              >
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: PIN_COLORS[i % PIN_COLORS.length] },
                  ]}
                >
                  <Text style={styles.dotText}>{i + 1}</Text>
                </View>
                <Text numberOfLines={1} style={[styles.chipText, styles.name]}>
                  {pin.name}
                </Text>
                <Text style={styles.remove}>×</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={s.label}>
          {pins.length === 0
            ? "Add a pin to line the photos up by a feature."
            : pins.length === 1
              ? "One pin matches position. Add another to match turn and size."
              : `${pins.length} pins match position, turn and size.`}
        </Text>
        {pins.length < MAX_PINS && (
          <View style={s.wrap}>
            {available.map((preset) => (
              <Pressable
                key={preset.id}
                accessibilityRole="button"
                accessibilityLabel={`Add a ${preset.name} pin`}
                onPress={() => add(preset)}
                style={[styles.chip, styles.add]}
              >
                <Text style={[styles.chipText, { color: colors.accent }]}>
                  + {preset.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {AI_MATCH && (
          <Button
            label={aiBusy ? "Claude is pinning…" : "AI pins"}
            icon="eye"
            variant="secondary"
            busy={aiBusy}
            onPress={() => void aiPins()}
          />
        )}
        <View style={s.wrap}>
          <Button
            label="Reset"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={reset}
          />
          <Button
            label="Save both"
            icon="check"
            style={{ flex: 1 }}
            busy={save.isPending}
            disabled={aiBusy}
            onPress={() => void persist()}
          />
        </View>
        {AI_MATCH && (
          <Text style={styles.small}>
            AI pins replace your pins and send both photos to the developer
            analysis server.
          </Text>
        )}
      </Card>
      {Boolean(message) && <Notice>{message}</Notice>}
      {Boolean(error) && <Notice error>{error}</Notice>}
    </>
  );
}

const styles = StyleSheet.create({
  tag: { position: "absolute", top: 10, left: 10 },
  round: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,26,23,0.6)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  voice: {
    position: "absolute",
    left: 12,
    right: 12,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: colors.subtle,
  },
  add: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.accent,
  },
  dot: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  dotText: { fontSize: 11, fontWeight: "800", color: "#0F1A17" },
  name: { maxWidth: 130 },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  remove: { fontSize: 16, color: colors.muted, marginLeft: 2 },
  small: { fontSize: 12, lineHeight: 16, color: colors.muted },
});
