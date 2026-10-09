import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { randomUUID } from "expo-crypto";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Empty,
  Icon,
  IconButton,
  Notice,
  Screen,
  SectionTitle,
  Segmented,
  colors,
  s,
} from "@/components/ui";
import { DateField } from "@/components/date-field";
import { ViewPicker } from "@/components/view-picker";
import { journalKey, useAccount } from "@/hooks/use-journal";
import { useAutoLineUp } from "@/hooks/use-auto-line-up";
import { takeImports } from "@/lib/capture-store";
import {
  IMPORT_LIMIT,
  pickLibraryPhotos,
  type LibraryPhoto,
} from "@/lib/library";
import { DATE_SOURCE_NOTES, type DateSource } from "@/lib/photo-date";
import { addPhoto } from "@/lib/repository";
import {
  HAIR_LENGTHS,
  SCALP_VIEWS,
  errorMessage,
  localDate,
  photoTimestamp,
  type HairLength,
  type ScalpView,
} from "@/lib/model";

type Item = Omit<LibraryPhoto, "taken"> & {
  key: string;
  date: string | null;
  source: DateSource | "missing" | null;
  view: ScalpView;
  status: "ready" | "saving" | "saved" | "failed";
  error?: string;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Oldest first so the import reads like the journal; undated photos last. */
function byDate(a: Item, b: Item) {
  return (a.date ?? "9999").localeCompare(b.date ?? "9999");
}

function ImportRow({
  item,
  locked,
  onChange,
  onRemove,
}: {
  item: Item;
  locked: boolean;
  onChange: (patch: Partial<Item>) => void;
  onRemove: () => void;
}) {
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View style={styles.thumb}>
          <Image
            source={{ uri: item.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={item.key}
          />
          {(item.status === "saving" || item.status === "saved") && (
            <View style={styles.overlay}>
              {item.status === "saving" ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Icon name="check" size={28} color="#FFF" />
              )}
            </View>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <DateField
            label="Taken"
            value={item.date}
            placeholder={item.date ? undefined : "Set date"}
            onChange={(date) => date && onChange({ date, source: null })}
            maximumDate={localDate()}
            note={item.source ? DATE_SOURCE_NOTES[item.source] : undefined}
            warn={item.source === "filename" || item.source === "missing"}
            disabled={locked}
          />
        </View>
        {!locked && (
          <IconButton
            icon="close"
            label="Remove photo"
            color={colors.muted}
            onPress={onRemove}
          />
        )}
      </View>
      <ViewPicker
        value={item.view}
        onChange={(view) => onChange({ view })}
        compact
        disabled={locked}
      />
      {item.error && <Notice error>{item.error}</Notice>}
    </Card>
  );
}

export default function ImportScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const initialView = SCALP_VIEWS.find((v) => v === params.view) ?? "top";
  const [items, setItems] = useState<Item[]>([]);
  const [length, setLength] = useState<HairLength | null>(null);
  const [wet, setWet] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const launched = useRef(false);
  const { owner } = useAccount();
  const cache = useQueryClient();
  const autoLineUp = useAutoLineUp();

  const add = useCallback(
    (photos: LibraryPhoto[], view: ScalpView) =>
      setItems((current) =>
        [
          ...current,
          ...photos.map(({ taken, ...photo }) => ({
            ...photo,
            key: randomUUID(),
            date: taken?.date ?? null,
            source: taken?.source ?? ("missing" as const),
            view,
            status: "ready" as const,
          })),
        ].sort(byDate),
      ),
    [],
  );
  const choose = useCallback(
    async (limit: number, view: ScalpView) => {
      setError("");
      try {
        add(await pickLibraryPhotos(limit), view);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [add],
  );
  // Photos picked on the single-photo form arrive here; otherwise open the
  // library straight away so the screen is never an extra tap.
  useFocusEffect(
    useCallback(() => {
      const handed = takeImports();
      if (handed.length) {
        launched.current = true;
        add(handed, initialView);
      } else if (!launched.current) {
        launched.current = true;
        void choose(IMPORT_LIMIT, initialView);
      }
    }, [add, choose, initialView]),
  );

  const patch = (key: string, change: Partial<Item>) =>
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );
  const queued = items.filter((item) => item.status !== "saved");
  const undated = queued.filter((item) => !item.date).length;
  const sharedView = items.every((item) => item.view === items[0]?.view)
    ? (items[0]?.view ?? null)
    : null;
  const saved = items.length - queued.length;

  async function importAll() {
    setError("");
    setRunning(true);
    let failed = 0;
    const added: string[] = [];
    for (const item of queued) {
      patch(item.key, { status: "saving", error: undefined });
      try {
        const id = await addPhoto(owner, {
          uri: item.uri,
          width: item.width,
          height: item.height,
          view: item.view,
          taken_at: photoTimestamp(item.date ?? ""),
          hair_length: length,
          hair_wet: wet,
          notes: null,
        });
        added.push(id);
        patch(item.key, { status: "saved" });
      } catch (e) {
        failed += 1;
        patch(item.key, { status: "failed", error: errorMessage(e) });
      }
    }
    // Refresh once rather than after every photo.
    await cache.invalidateQueries({ queryKey: journalKey(owner) });
    // They snap onto the guide in the journal as each is matched.
    void autoLineUp.lineUp(added);
    setRunning(false);
    if (!failed) {
      if (router.canGoBack()) router.back();
      else router.replace("/");
      return;
    }
    setItems((current) => current.filter((item) => item.status !== "saved"));
    setError(
      `${plural(queued.length - failed, "photo")} imported. ${plural(failed, "photo")} couldn't be saved: check the notes below and try again.`,
    );
  }

  if (!items.length)
    return (
      <Screen>
        {Boolean(error) && <Notice error>{error}</Notice>}
        <Empty
          icon="upload"
          title="Import photos from your library"
          action={
            <Button
              label="Choose photos"
              icon="upload"
              onPress={() => void choose(IMPORT_LIMIT, initialView)}
            />
          }
        />
      </Screen>
    );

  return (
    <Screen>
      <Card>
        <Text style={s.label}>View for every photo</Text>
        <ViewPicker
          value={sharedView}
          onChange={(view) =>
            setItems((current) => current.map((item) => ({ ...item, view })))
          }
          compact
          disabled={running}
        />
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
            disabled={running}
            onValueChange={setWet}
            trackColor={{ true: colors.accent }}
          />
        </View>
      </Card>
      <SectionTitle detail={`${items.length} of ${IMPORT_LIMIT}`}>
        Photos
      </SectionTitle>
      {items.map((item) => (
        <ImportRow
          key={item.key}
          item={item}
          locked={running || item.status === "saved"}
          onChange={(change) => patch(item.key, change)}
          onRemove={() =>
            setItems((current) => current.filter((i) => i.key !== item.key))
          }
        />
      ))}
      {items.length < IMPORT_LIMIT && !running && (
        <Button
          label="Add more photos"
          icon="plus"
          variant="secondary"
          onPress={() =>
            void choose(IMPORT_LIMIT - items.length, sharedView ?? initialView)
          }
        />
      )}
      {undated > 0 && (
        <Notice>{`Set a date for ${plural(undated, "photo")} to import.`}</Notice>
      )}
      {Boolean(error) && <Notice error>{error}</Notice>}
      <Button
        label={
          running
            ? `Importing ${Math.min(saved + 1, items.length)} of ${items.length}`
            : `Import ${plural(queued.length, "photo")}`
        }
        busy={running}
        disabled={undated > 0 || !queued.length}
        onPress={() => void importAll()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  thumb: {
    width: 76,
    height: 92,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: colors.stage,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,26,23,0.55)",
  },
});
