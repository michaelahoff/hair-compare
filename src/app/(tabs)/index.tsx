/**
 * PROTOTYPE: three redesigns of this screen render here behind `?variant=`
 * (a · Atlas, b · Darkroom, c · Ledger, d · Hybrid, current). `?demo=1` seeds sample
 * data on web. See src/components/prototypes/photos-home/.
 */
import { useLayoutEffect, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import { demoJournal } from "@/components/prototypes/photos-home/demo-data";
import {
  VariantAtlas,
  atlas,
} from "@/components/prototypes/photos-home/variant-atlas";
import {
  VariantDarkroom,
  dark,
} from "@/components/prototypes/photos-home/variant-darkroom";
import {
  VariantLedger,
  ledger,
} from "@/components/prototypes/photos-home/variant-ledger";
import { VariantHybrid } from "@/components/prototypes/photos-home/variant-hybrid";
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
  TAB_BAR_STYLE,
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
  type Journal,
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

const VARIANTS = [
  { key: "a", name: "Atlas · by region" },
  { key: "b", name: "Darkroom · by recency" },
  { key: "c", name: "Ledger · by day" },
  { key: "d", name: "Hybrid · ledger + atlas" },
  { key: "current", name: "Current design" },
] as const;

export default function PhotosScreen() {
  const journal = useJournal();
  const params = useLocalSearchParams<{ variant?: string; demo?: string }>();
  const variant = VARIANTS.some((v) => v.key === params.variant)
    ? params.variant!
    : "d";
  const empty = !journal.isPending && !journal.data?.photos.length;
  const demo = params.demo ? params.demo === "1" : empty;
  const navigation = useNavigation() as {
    setOptions: (options: Record<string, unknown>) => void;
  };
  useLayoutEffect(() => {
    const chrome = {
      a: { bg: atlas.bg, bar: atlas.surface, on: atlas.copper, off: atlas.muted },
      b: { bg: dark.bg, bar: dark.surface, on: dark.amber, off: dark.muted },
      c: { bg: ledger.paper, bar: ledger.surface, on: ledger.moss, off: ledger.muted },
      d: { bg: ledger.paper, bar: ledger.surface, on: ledger.moss, off: ledger.muted },
    }[variant];
    navigation.setOptions(
      chrome
        ? {
            headerShown: false,
            sceneStyle: { backgroundColor: chrome.bg },
            tabBarStyle: { ...TAB_BAR_STYLE, backgroundColor: chrome.bar },
            tabBarActiveTintColor: chrome.on,
            tabBarInactiveTintColor: chrome.off,
          }
        : {
            headerShown: true,
            sceneStyle: { backgroundColor: colors.bg },
            tabBarStyle: TAB_BAR_STYLE,
            tabBarActiveTintColor: colors.accent,
            tabBarInactiveTintColor: colors.muted,
          },
    );
  }, [navigation, variant]);
  const data = demo ? demoJournal() : journal.data;
  return (
    <View style={{ flex: 1 }}>
      {variant === "current" ? (
        <CurrentPhotos override={demo ? data : undefined} />
      ) : !data ? null : variant === "a" ? (
        <VariantAtlas journal={data} />
      ) : variant === "b" ? (
        <VariantDarkroom journal={data} />
      ) : variant === "c" ? (
        <VariantLedger journal={data} />
      ) : (
        <VariantHybrid journal={data} />
      )}
      <PrototypeSwitcher variants={VARIANTS} current={variant} demo={demo} />
    </View>
  );
}

/** The design as shipped, kept for comparison. */
function CurrentPhotos({ override }: { override?: Journal }) {
  const journal = useJournal();
  const [view, setView] = useState<ScalpView | "all">("all");
  const { width } = useWindowDimensions();
  const tile = (Math.min(width, 560) - 32 - GAP * (COLUMNS - 1)) / COLUMNS;
  const all = [...(override ?? journal.data)?.photos ?? []].sort((a, b) =>
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
