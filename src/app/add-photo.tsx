import { useCallback, useState } from "react";
import { Image, Switch, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  Button,
  Card,
  Field,
  Notice,
  Screen,
  Segmented,
  ViewGlyph,
  colors,
  s,
} from "@/components/ui";
import { DateField } from "@/components/date-field";
import { ViewPicker } from "@/components/view-picker";
import { useJournalMutation } from "@/hooks/use-journal";
import { useAutoLineUp } from "@/hooks/use-auto-line-up";
import { setImports, takeCapture } from "@/lib/capture-store";
import { IMPORT_LIMIT, pickLibraryPhotos } from "@/lib/library";
import { DATE_SOURCE_NOTES, type DateSource } from "@/lib/photo-date";
import { addPhoto } from "@/lib/repository";
import {
  HAIR_LENGTHS,
  errorMessage,
  localDate,
  photoTimestamp,
  validDate,
  type HairLength,
  type ScalpView,
} from "@/lib/model";

export default function AddPhotoScreen() {
  const [asset, setAsset] = useState<{
    uri: string;
    width: number;
    height: number;
  } | null>(null);
  const [view, setView] = useState<ScalpView>("top");
  const [length, setLength] = useState<HairLength | null>(null);
  const [wet, setWet] = useState(false);
  const [date, setDate] = useState(localDate());
  // Where a library photo's date came from; null for camera shots and manual edits.
  const [dateSource, setDateSource] = useState<DateSource | "missing" | null>(
    null,
  );
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const save = useJournalMutation(addPhoto);
  const autoLineUp = useAutoLineUp();
  // A photo taken on the ghost camera arrives here when the form regains focus.
  useFocusEffect(
    useCallback(() => {
      const capture = takeCapture();
      if (capture) {
        setAsset(capture);
        setView(capture.view);
        setDate(localDate());
        setDateSource(null);
      }
    }, []),
  );
  async function pickFromLibrary() {
    setError("");
    try {
      const picked = await pickLibraryPhotos(IMPORT_LIMIT);
      if (picked.length > 1) {
        setImports(picked);
        router.replace({ pathname: "/import", params: { view } });
        return;
      }
      const [photo] = picked;
      if (!photo) return;
      setAsset(photo);
      if (photo.taken) setDate(photo.taken.date);
      setDateSource(photo.taken?.source ?? "missing");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function submit() {
    if (!asset) return;
    if (!validDate(date) || date > localDate()) {
      setError("Choose a date that isn't in the future.");
      return;
    }
    setError("");
    try {
      const id = await save.mutateAsync({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        view,
        taken_at: photoTimestamp(date),
        hair_length: length,
        hair_wet: wet,
        notes: notes.trim() || null,
      });
      // It snaps onto the guide on the photo screen once matched.
      void autoLineUp.lineUp([id]);
      router.replace({ pathname: "/photo/[id]", params: { id } });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Screen>
      <View style={[s.stage, { aspectRatio: asset ? 1 : 4 / 3 }]}>
        {asset ? (
          <Image
            source={{ uri: asset.uri }}
            resizeMode="contain"
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <View
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <ViewGlyph view={view} size={140} active />
          </View>
        )}
      </View>
      <View style={s.wrap}>
        <Button
          label="Camera"
          icon="camera"
          style={{ flex: 1 }}
          disabled={save.isPending}
          onPress={() =>
            router.push({
              pathname: "/capture",
              params: { view, from: "form" },
            })
          }
        />
        <Button
          label="Library"
          icon="upload"
          variant="secondary"
          style={{ flex: 1 }}
          disabled={save.isPending}
          onPress={() => void pickFromLibrary()}
        />
      </View>
      <ViewPicker value={view} onChange={setView} />
      <Card>
        <Segmented
          values={HAIR_LENGTHS.map((value) => ({
            value,
            label: value.charAt(0).toUpperCase() + value.slice(1),
          }))}
          selected={length}
          onChange={setLength}
        />
        <View style={s.row}>
          <Text style={[s.body, { fontWeight: "600" }]}>Wet hair</Text>
          <Switch
            accessibilityLabel="Wet hair"
            value={wet}
            onValueChange={setWet}
            trackColor={{ true: colors.accent }}
          />
        </View>
        <DateField
          label="Date"
          value={date}
          onChange={(value) => {
            if (!value) return;
            setDate(value);
            setDateSource(null);
          }}
          maximumDate={localDate()}
          note={dateSource ? DATE_SOURCE_NOTES[dateSource] : undefined}
          warn={dateSource === "filename" || dateSource === "missing"}
        />
        <Field
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={2000}
        />
      </Card>
      {Boolean(error) && <Notice error>{error}</Notice>}
      <Button
        label="Save photo"
        disabled={!asset}
        busy={save.isPending}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
