import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  Empty,
  Icon,
  Notice,
  Screen,
  colors,
  s,
} from "@/components/ui";
import { JournalState } from "@/components/journal-state";
import { AI_MATCH, MatchChoices } from "@/components/match-choices";
import { AiBubble, ScanOverlay, useScanTour } from "@/components/scan";
import {
  FineTune,
  FramingEditor,
  settledFraming,
  snapFeedback,
  snapFraming,
  useFramingEdit,
} from "@/components/framed-photo";
import { useJournal, useJournalMutation } from "@/hooks/use-journal";
import { useViewGuide } from "@/hooks/use-preferences";
import { timelineOf } from "@/hooks/use-comparison";
import { useAutoLineUp } from "@/hooks/use-auto-line-up";
import { matchFraming, matchWithClaude, referenceFor } from "@/lib/match";
import { saveAlignment } from "@/lib/repository";
import { CLOSEUP_VIEWS, guideCarry, inspectPoints } from "@/lib/guide-art";
import { matchLines } from "@/lib/scan-script";
import {
  IDENTITY,
  compose,
  framingKey,
  framingOf,
  type Framing,
} from "@/lib/framing";
import { VIEW_LABELS, errorMessage, formatDate, type Photo } from "@/lib/model";

/** Line one photo up against its view's guide. */
export default function LineUpScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const journal = useJournal();
  const photo = journal.data?.photos.find((p) => p.id === id);
  return (
    <Screen>
      <Stack.Screen
        options={{
          title: photo
            ? `Line up ${VIEW_LABELS[photo.view].toLowerCase()}`
            : "Line up",
        }}
      />
      <JournalState
        loading={journal.isPending}
        error={journal.error}
        retry={() => void journal.refetch()}
      />
      {!photo && !journal.isPending && !journal.error && (
        <Empty icon="photos" title="Photo not found" />
      )}
      {photo && <LineUp key={photo.id} photo={photo} />}
    </Screen>
  );
}

/**
 * Matching runs on its own; the rest are what the person decides once it has.
 * "missed" and "choose" offer AI match or by hand; "hand" is dragging it on.
 */
type Phase = "matching" | "ai" | "matched" | "missed" | "choose" | "hand";

function LineUp({ photo }: { photo: Photo }) {
  const id = photo.id;
  const journal = useJournal();
  const {
    turn,
    variant: guide,
    turnGuide,
    setVariant,
  } = useViewGuide(photo.view);
  const { width, height } = useWindowDimensions();
  const edit = useFramingEdit(framingOf(photo));
  const timeline = timelineOf(journal.data?.photos ?? [], photo.view);
  const reference = referenceFor(photo, timeline);
  // An unframed photo with something to match against matches straight away.
  const [phase, setPhase] = useState<Phase>(
    !framingOf(photo) && reference ? "matching" : "hand",
  );
  const [byClaude, setByClaude] = useState(false);
  const [triedClaude, setTriedClaude] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const save = useJournalMutation((owner: string, framing: Framing) =>
    saveAlignment(owner, id, framing),
  );
  // Saved elsewhere meanwhile, e.g. by pinning it on the pair screen: show
  // that framing, so Save here can't put back the old one.
  const stored = framingOf(photo);
  const storedKey = framingKey(stored);
  const [shownKey, setShownKey] = useState(storedKey);
  if (shownKey !== storedKey) {
    setShownKey(storedKey);
    if (stored) setPhase("hand");
  }
  const seen = useRef(storedKey);
  useEffect(() => {
    if (seen.current === storedKey) return;
    seen.current = storedKey;
    if (!stored) return;
    snapFraming(edit, stored);
    edit.touched.set(false);
  }, [storedKey, stored, edit]);
  const autoLineUp = useAutoLineUp();
  const unframed = timeline.filter((p) => p.id !== id && !framingOf(p)).length;
  /**
   * The other picture. The view's lined-up photos, this one included, are
   * carried onto it, so this photo moves with it rather than snapping back.
   */
  function switchGuide() {
    const next = guide === "closeup" ? "head" : "closeup";
    const carry = guideCarry(photo.view, guide, next);
    if (stored) seen.current = framingKey(compose(carry, stored));
    snapFraming(edit, compose(carry, settledFraming(edit)));
    setVariant(next).catch((e) => setError(errorMessage(e)));
  }
  const size = Math.round(Math.min(Math.min(width, 560) - 32, height * 0.58));
  const scanning = phase === "matching" || phase === "ai";
  const date = reference ? formatDate(reference.taken_at) : null;
  // The reticle hops from landmark to landmark while it looks.
  const tour = useScanTour(
    matchLines(photo.view, guide, date, phase === "ai"),
    {
      scanning,
      points: inspectPoints(photo.view, guide),
      everyMs: 1900,
    },
  );

  async function match(withClaude: boolean) {
    if (!reference) return;
    setPhase(withClaude ? "ai" : "matching");
    setMessage("");
    setError("");
    if (withClaude) setTriedClaude(true);
    try {
      const framing = await (withClaude ? matchWithClaude : matchFraming)(
        reference,
        framingOf(reference)!,
        photo,
      );
      if (!framing) {
        setMessage(
          withClaude
            ? "Claude couldn't find enough of the same spots in both photos."
            : "Couldn't match this one automatically.",
        );
        setPhase("missed");
        return;
      }
      snapFraming(edit, framing);
      snapFeedback();
      setByClaude(withClaude);
      setPhase("matched");
    } catch (e) {
      setError(errorMessage(e));
      setPhase("missed");
    }
  }
  const started = useRef(false);
  useEffect(() => {
    if (started.current || phase !== "matching") return;
    started.current = true;
    void match(false);
  });

  async function persist() {
    setError("");
    try {
      await save.mutateAsync({
        ...settledFraming(edit),
        source: "manual",
        pins: framingOf(photo)?.pins,
      });
      if (unframed) {
        setSaved(true);
        setMessage("Saved.");
      } else router.back();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function lineUpRest() {
    setError("");
    try {
      // Fresh data: this photo's new framing is the reference.
      const { data } = await journal.refetch();
      const { lined, missed } = await autoLineUp.run(
        timelineOf(data?.photos ?? [], photo.view),
      );
      setSaved(false);
      setMessage(
        missed
          ? `Lined up ${lined}. ${missed} couldn't be matched, so line ${missed === 1 ? "it" : "those"} up by hand.`
          : `Lined up ${lined} ${lined === 1 ? "photo" : "photos"}.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <FramingEditor
        photo={photo}
        edit={edit}
        turn={turn}
        guide={guide}
        height={size}
        style={{ borderRadius: 22 }}
        overlay={(frameWidth) => (
          <>
            {scanning && (
              <ScanOverlay
                scanner={tour.scanner}
                width={frameWidth}
                height={size}
                turn={turn}
              />
            )}
            {scanning && tour.line && (
              <View pointerEvents="none" style={styles.voice}>
                <AiBubble text={tour.line} thinking />
              </View>
            )}
            {!scanning && (
              <View style={styles.corner}>
                {CLOSEUP_VIEWS.includes(photo.view) && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      guide === "closeup"
                        ? "Use the whole-head guide"
                        : "Use the close-up guide"
                    }
                    onPress={switchGuide}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>
                      {guide === "closeup" ? "Close-up" : "Whole head"}
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Turn guide"
                  onPress={turnGuide}
                  style={styles.round}
                >
                  <Icon name="turn" size={18} color="#FFF" />
                </Pressable>
              </View>
            )}
          </>
        )}
      />
      <Card>
        {scanning && (
          <Text style={s.body}>
            {phase === "ai"
              ? `Claude is matching this to ${date}…`
              : `Matching to ${date}…`}
          </Text>
        )}
        {phase === "matched" && (
          <>
            <Text style={s.body}>
              {byClaude ? "Claude matched" : "Matched"} it to {date}. Does it
              sit on the guide?
            </Text>
            <View style={s.wrap}>
              <Button
                label="Not right?"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => setPhase("choose")}
              />
              <Button
                label="Save"
                icon="check"
                style={{ flex: 1 }}
                busy={save.isPending}
                onPress={() => void persist()}
              />
            </View>
          </>
        )}
        {(phase === "missed" || phase === "choose") && (
          <>
            <Text style={s.body}>
              {phase === "missed"
                ? "Couldn't match this one automatically."
                : "Try another way."}
            </Text>
            {AI_MATCH && !triedClaude ? (
              <MatchChoices
                onAi={() => void match(true)}
                onHand={() => setPhase("hand")}
              />
            ) : (
              <Button
                label="Line it up by hand"
                icon="move"
                onPress={() => setPhase("hand")}
              />
            )}
          </>
        )}
        {phase === "hand" && (
          <>
            <Text style={s.muted}>
              Drag, pinch and twist the photo until it sits on the{" "}
              {guide === "closeup" ? "whorl" : "head"} in the guide.
            </Text>
            <FineTune edit={edit} />
            <View style={s.wrap}>
              <Button
                label="Reset"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => snapFraming(edit, IDENTITY)}
              />
              <Button
                label="Save"
                icon="check"
                style={{ flex: 1 }}
                busy={save.isPending}
                onPress={() => void persist()}
              />
            </View>
            {reference && (
              <View style={styles.links}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void match(false)}
                  style={styles.link}
                >
                  <Text style={styles.linkText}>Match to {date}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: "/adjust",
                      params: { ref: reference.id, id: photo.id },
                    })
                  }
                  style={styles.link}
                >
                  <Text style={styles.linkText}>Pin to {date}</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </Card>
      {Boolean(message) && <Notice>{message}</Notice>}
      {Boolean(error) && <Notice error>{error}</Notice>}
      {saved && unframed > 0 && (
        <Card>
          <Text style={s.body}>
            {unframed} other {VIEW_LABELS[photo.view].toLowerCase()}{" "}
            {unframed === 1 ? "photo isn't" : "photos aren't"} lined up yet.
            They can be matched to this one.
          </Text>
          <View style={s.wrap}>
            <Button
              label="Done"
              variant="secondary"
              style={{ flex: 1 }}
              disabled={Boolean(autoLineUp.progress)}
              onPress={() => router.back()}
            />
            <Button
              label={
                autoLineUp.progress
                  ? `${autoLineUp.progress.done + 1} of ${autoLineUp.progress.total}…`
                  : "Line them up"
              }
              icon="align"
              busy={Boolean(autoLineUp.progress)}
              style={{ flex: 1 }}
              onPress={() => void lineUpRest()}
            />
          </View>
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  voice: { position: "absolute", left: 12, right: 12, bottom: 12 },
  corner: {
    position: "absolute",
    top: 10,
    right: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  round: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,26,23,0.6)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  chip: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    justifyContent: "center",
    backgroundColor: "rgba(15,26,23,0.6)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  chipText: { color: "#FFF", fontSize: 13, fontWeight: "700" },
  links: { flexDirection: "row", justifyContent: "center", gap: 20 },
  link: { paddingVertical: 4 },
  linkText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
});
