import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Stack, router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  Empty,
  Notice,
  Pill,
  Screen,
  colors,
  s,
} from "@/components/ui";
import { JournalState } from "@/components/journal-state";
import { AI_MATCH } from "@/components/match-choices";
import { PIN_COLORS, PinMarker } from "@/components/pin-marker";
import {
  AiBubble,
  ScanOverlay,
  useLines,
  useScanner,
} from "@/components/scan";
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
import { guideStyleOf, usePreferences } from "@/hooks/use-preferences";
import { saveAlignment } from "@/lib/repository";
import { requestDevMatch } from "@/lib/dev-analysis";
import { IDENTITY, framingOf } from "@/lib/framing";
import { inspectPoints, pinPresets } from "@/lib/guide-art";
import {
  MAX_PINS,
  fitToPins,
  pairPins,
  pinAt,
  pinsFromMatch,
  type PairPin,
} from "@/lib/pins";
import { matchLines } from "@/lib/scan-script";
import type { Point } from "@/lib/outline";
import { errorMessage, formatDate, type Photo } from "@/lib/model";

const SEAM = 4;

/** Adjust a compared pair together, by moving both or by pinning features. */
export default function AdjustScreen() {
  const params = useLocalSearchParams<{ before: string; after: string }>();
  const journal = useJournal();
  const found = [params.before, params.after]
    .map((id) => journal.data?.photos.find((p) => p.id === id))
    .filter((p): p is Photo => Boolean(p))
    .sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  return (
    <Screen>
      <Stack.Screen options={{ title: "Adjust pair" }} />
      <JournalState
        loading={journal.isPending}
        error={journal.error}
        retry={() => void journal.refetch()}
      />
      {found.length < 2 && !journal.isPending && !journal.error && (
        <Empty icon="photos" title="Photos not found" />
      )}
      {found.length === 2 && (
        <Adjust
          key={`${found[0].id}-${found[1].id}`}
          before={found[0]}
          after={found[1]}
        />
      )}
    </Screen>
  );
}

function Adjust({ before, after }: { before: Photo; after: Photo }) {
  const view = after.view;
  const { width, height } = useWindowDimensions();
  const { preferences } = usePreferences();
  const turn = preferences.turns[view] ?? 0;
  const guide = guideStyleOf(preferences, view);
  const paneHeight = Math.round(
    Math.max(200, Math.min(Math.min(width, 560) - 32, (height - 380) / 2)),
  );
  const start = {
    before: framingOf(before) ?? IDENTITY,
    after: framingOf(after) ?? IDENTITY,
  };
  const edits: Record<"before" | "after", FramingEdit> = {
    before: useFramingEdit(start.before),
    after: useFramingEdit(start.after),
  };
  const [firstPins] = useState(() =>
    pairPins(
      before,
      start.before,
      framingOf(before)?.pins ?? [],
      after,
      start.after,
      framingOf(after)?.pins ?? [],
    ),
  );
  const [pins, setPins] = useState<PairPin[]>(firstPins);
  const [aiBusy, setAiBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const shown = { before, after };

  // The after photo follows its pins onto the before photo's.
  function follow(next: PairPin[]) {
    setPins(next);
    if (!next.length) return;
    snapFraming(
      edits.after,
      fitToPins(
        before,
        settledFraming(edits.before),
        after,
        settledFraming(edits.after),
        next,
      ),
    );
  }
  function move(side: "before" | "after", id: string, at: Point) {
    follow(pins.map((p) => (p.id === id ? { ...p, [side]: at } : p)));
  }
  const presets = pinPresets(view, guide);
  function add(preset: (typeof presets)[number]) {
    // A pin starts where the guide's picture shows the feature, in both photos.
    const id =
      preset.id === "spot"
        ? `spot-${pins.filter((p) => p.id.startsWith("spot")).length + 1}`
        : preset.id;
    const name =
      preset.id === "spot"
        ? `Spot ${pins.filter((p) => p.id.startsWith("spot")).length + 1}`
        : preset.name;
    setPins([
      ...pins,
      {
        id,
        name,
        before: pinAt(preset.x, preset.y, before, settledFraming(edits.before)),
        after: pinAt(preset.x, preset.y, after, settledFraming(edits.after)),
      },
    ]);
    Haptics.selectionAsync().catch(() => {});
  }
  async function aiPins() {
    setAiBusy(true);
    setMessage("");
    setError("");
    try {
      const { result, sizes } = await requestDevMatch(before, after);
      const found = result.same_area
        ? pinsFromMatch(result.points, sizes, 0.05)
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
        `Claude placed ${found.length} pins. Drag any that are off; the after photo follows.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAiBusy(false);
    }
  }
  function reset() {
    loadFraming(edits.before, framingOf(before));
    loadFraming(edits.after, framingOf(after));
    setPins(firstPins);
    setMessage("");
  }
  const save = useJournalMutation(async (owner: string) => {
    const photoPins = (side: "before" | "after") =>
      pins.map((p) => ({ id: p.id, name: p.name, ...p[side] }));
    for (const side of ["before", "after"] as const)
      await saveAlignment(owner, shown[side].id, {
        ...settledFraming(edits[side]),
        source: "manual",
        pins: photoPins(side),
      });
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
  const scanner = useScanner(aiBusy);
  const speech = useLines(
    matchLines(view, guide, formatDate(before.taken_at), true),
    aiBusy,
    { everyMs: 2200 },
  );
  const points = inspectPoints(view, guide);
  const spot = points[speech.index % points.length];
  const { look } = scanner;
  useEffect(() => {
    if (aiBusy) look(spot.x, spot.y);
  }, [aiBusy, spot.x, spot.y, look]);

  const available = presets.filter(
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
            linked={edits[side === "before" ? "after" : "before"]}
            turn={turn}
            guide={guide}
            height={paneHeight}
            overlay={(frameWidth) => (
              <>
                {aiBusy && (
                  <ScanOverlay
                    scanner={scanner}
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
              </>
            )}
          />
        ))}
        {aiBusy && speech.line && (
          <View
            pointerEvents="none"
            style={[styles.voice, { bottom: paneHeight + SEAM / 2 - 22 }]}
          >
            <AiBubble text={speech.line} thinking />
          </View>
        )}
      </View>
      <Card>
        <Text style={s.muted}>
          Drag, pinch or twist either photo to move both onto the guide. Pins
          mark the same spot in each photo: drag each onto it, and the after
          photo follows.
        </Text>
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
        <FineTune edit={edits.before} linked={edits.after} />
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
            AI pins send both photos to the developer analysis server.
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
