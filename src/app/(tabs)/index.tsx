import { useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useJournal } from "@/hooks/use-journal";
import {
  Button,
  Chips,
  Empty,
  Fab,
  Icon,
  Pill,
  Screen,
  SectionTitle,
  colors,
  s,
} from "@/components/ui";
import { JournalState } from "@/components/journal-state";
import { FramedPhoto } from "@/components/framed-photo";
import { useComparison } from "@/hooks/use-comparison";
import {
  VIEW_LABELS,
  elapsedDays,
  formatDate,
  type Photo,
  type ScalpView,
} from "@/lib/model";

const COLUMNS = 3;
const GAP = 6;

function monthOf(photo: Photo) {
  return new Date(`${photo.taken_at.slice(0, 10)}T12:00:00`).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" },
  );
}

/** The pair last chosen on Compare (first and latest until then), lined up. */
function ProgressCard({ photos }: { photos: Photo[] }) {
  const comparison = useComparison(photos);
  const [side, setSide] = useState(0);
  const { before, after } = comparison.pairOf(comparison.view);
  if (!comparison.ready || !before || !after || before.id === after.id)
    return null;
  const view = after.view;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Compare ${VIEW_LABELS[view]}: ${formatDate(before.taken_at)} to ${formatDate(after.taken_at)}`}
      onPress={() => router.navigate("/compare")}
      style={({ pressed }) => [
        styles.progress,
        { transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      <View style={s.row}>
        <Text style={styles.progressTitle}>{VIEW_LABELS[view]}</Text>
        <Icon name="chevron" color="#FFF" />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {[before, after].map((photo, index) => (
          <View key={photo.id} style={{ flex: 1, gap: 6 }}>
            <View
              style={styles.progressImage}
              onLayout={(e) => setSide(e.nativeEvent.layout.width)}
            >
              {side > 0 && (
                <FramedPhoto
                  photo={photo}
                  turn={comparison.turns[view] ?? 0}
                  width={side}
                  height={side}
                />
              )}
            </View>
            <Text style={styles.progressDate}>
              {index ? "After" : "Before"} · {formatDate(photo.taken_at)}
            </Text>
          </View>
        ))}
        <View style={styles.progressDays}>
          <Text style={styles.progressDaysText}>
            {elapsedDays(before.taken_at, after.taken_at)}
          </Text>
          <Text style={styles.progressDaysUnit}>days</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function PhotosScreen() {
  const journal = useJournal();
  const [view, setView] = useState<ScalpView | "all">("all");
  const { width } = useWindowDimensions();
  const tile = (Math.min(width, 560) - 32 - GAP * (COLUMNS - 1)) / COLUMNS;
  const all = [...(journal.data?.photos ?? [])].sort((a, b) =>
    b.taken_at.localeCompare(a.taken_at),
  );
  const photos = all.filter((p) => view === "all" || p.view === view);
  const months = new Map<string, Photo[]>();
  for (const photo of photos) {
    const month = monthOf(photo);
    months.set(month, [...(months.get(month) ?? []), photo]);
  }
  return (
    <Screen
      fab={
        <Fab
          icon="camera"
          label="Take photo"
          onPress={() => router.push("/capture")}
        />
      }
    >
      <JournalState
        loading={journal.isPending}
        error={journal.error}
        retry={() => void journal.refetch()}
      />
      {!all.length && !journal.isPending && !journal.error ? (
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
      ) : (
        <>
          <ProgressCard photos={all} />
          <Chips
            values={[
              { value: "all", label: "All" },
              ...Object.entries(VIEW_LABELS).map(([value, label]) => ({
                value: value as ScalpView,
                label,
              })),
            ]}
            selected={view}
            onChange={setView}
          />
          {[...months].map(([month, items]) => (
            <View key={month} style={{ gap: 10 }}>
              <SectionTitle detail={String(items.length)}>{month}</SectionTitle>
              <View
                style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}
              >
                {items.map((photo) => (
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
                    style={({ pressed }) => ({
                      width: tile,
                      height: tile * 1.2,
                      borderRadius: 16,
                      overflow: "hidden",
                      backgroundColor: colors.stage,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <Image
                      source={{ uri: photo.uri }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="cover"
                    />
                    <Text style={styles.tileDay}>
                      {Number(photo.taken_at.slice(8, 10))}
                    </Text>
                    {view === "all" && (
                      <View style={styles.tileView}>
                        <Pill tone="dark">{VIEW_LABELS[photo.view]}</Pill>
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          {!photos.length && view !== "all" && (
            <Empty
              icon="photos"
              title={`No ${VIEW_LABELS[view].toLowerCase()} photos`}
            />
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: {
    backgroundColor: colors.stage,
    borderRadius: 24,
    padding: 16,
    gap: 14,
  },
  progressTitle: {
    color: "#FFF",
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  progressImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 14,
    backgroundColor: "#22302C",
    overflow: "hidden",
  },
  progressDate: { color: "#B9C7C2", fontSize: 12, fontWeight: "600" },
  progressDays: {
    position: "absolute",
    left: "50%",
    top: "42%",
    marginLeft: -32,
    marginTop: -32,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.loupe,
    borderWidth: 4,
    borderColor: colors.stage,
    alignItems: "center",
    justifyContent: "center",
  },
  progressDaysText: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.stage,
    fontVariant: ["tabular-nums"],
    lineHeight: 20,
  },
  progressDaysUnit: { fontSize: 10, fontWeight: "700", color: colors.stage },
  tileDay: {
    position: "absolute",
    left: 10,
    bottom: 6,
    color: "#FFF",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowRadius: 6,
  },
  tileView: { position: "absolute", top: 8, left: 8 },
});
