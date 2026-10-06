import { useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Button, Card, Empty, Notice, Screen, s } from "@/components/ui";
import { JournalState } from "@/components/journal-state";
import {
  FineTune,
  FramingEditor,
  readFraming,
  setFraming,
  useFramingEdit,
} from "@/components/framed-photo";
import { useJournal, useJournalMutation } from "@/hooks/use-journal";
import { usePreferences } from "@/hooks/use-preferences";
import { timelineOf } from "@/hooks/use-comparison";
import { matchFraming, useAutoLineUp } from "@/hooks/use-auto-line-up";
import { saveAlignment } from "@/lib/repository";
import { IDENTITY, framingOf, type Framing } from "@/lib/framing";
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

function LineUp({ photo }: { photo: Photo }) {
  const id = photo.id;
  const journal = useJournal();
  const { preferences, update } = usePreferences();
  const { width, height } = useWindowDimensions();
  const edit = useFramingEdit(framingOf(photo));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const save = useJournalMutation((owner: string, framing: Framing) =>
    saveAlignment(owner, id, framing),
  );
  const autoLineUp = useAutoLineUp();
  const timeline = timelineOf(journal.data?.photos ?? [], photo.view);
  // The nearest-dated photo already lined up by hand, to match against.
  const reference = timeline
    .filter(
      (p) => p.id !== id && framingOf(p)?.source !== "auto" && framingOf(p),
    )
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.taken_at) - Date.parse(photo.taken_at)) -
        Math.abs(Date.parse(b.taken_at) - Date.parse(photo.taken_at)),
    )[0];
  const unframed = timeline.filter((p) => p.id !== id && !framingOf(p)).length;
  const turn = preferences.turns[photo.view] ?? 0;
  const size = Math.round(Math.min(Math.min(width, 560) - 32, height * 0.58));

  async function match() {
    if (!reference) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const framing = await matchFraming(
        reference,
        framingOf(reference)!,
        photo,
      );
      if (!framing)
        setMessage("Couldn't match the details. Line it up by hand.");
      else {
        setFraming(edit, framing);
        setMessage(
          `Matched to ${formatDate(reference.taken_at)}. Check it against the guide.`,
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function persist() {
    setError("");
    try {
      await save.mutateAsync({ ...readFraming(edit), source: "manual" });
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
        height={size}
        style={{ borderRadius: 22 }}
      />
      <Card>
        <Text style={s.muted}>
          Drag, pinch and twist the photo until it sits on the guide. Every{" "}
          {VIEW_LABELS[photo.view].toLowerCase()} photo lined up this way will
          match.
        </Text>
        <FineTune edit={edit} />
        <View style={s.wrap}>
          {reference && (
            <Button
              label="Match lined-up photo"
              icon="align"
              variant="secondary"
              busy={busy}
              style={{ flex: 1 }}
              onPress={() => void match()}
            />
          )}
          <Button
            label="Turn guide"
            icon="turn"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() =>
              update((p) => ({
                ...p,
                turns: { ...p.turns, [photo.view]: (turn + 1) % 4 },
              }))
            }
          />
        </View>
        <View style={s.wrap}>
          <Button
            label="Reset"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => setFraming(edit, IDENTITY)}
          />
          <Button
            label="Save"
            style={{ flex: 1 }}
            busy={save.isPending}
            onPress={() => void persist()}
          />
        </View>
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
