/**
 * PROTOTYPE A · "Atlas". The home is the head: five regions, each with its
 * own freshness. Dates come second. Porcelain, ink, copper; serif display.
 */
import { useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import { Icon } from "@/components/ui";
import {
  VIEW_LABELS,
  elapsedDays,
  type Journal,
  type Photo,
  type ScalpView,
} from "@/lib/model";
import { FONT, VIEWS, ago, byDateDesc, latestOf, shortDate } from "./shared";

export const atlas = {
  bg: "#F2F4F7",
  surface: "#FFFFFF",
  ink: "#16222B",
  muted: "#6B7682",
  line: "#DCE2E8",
  copper: "#B5622B",
  copperSoft: "#F5E6DB",
  teal: "#1E6A5A",
  tealSoft: "#DCEBE6",
};

export type Freshness = "none" | "fresh" | "aging" | "due";
export function freshness(latest?: Photo): Freshness {
  if (!latest) return "none";
  const days = elapsedDays(latest.taken_at);
  return days <= 35 ? "fresh" : days <= 90 ? "aging" : "due";
}
export const FRESH_LABEL: Record<Freshness, string> = {
  none: "Not started",
  fresh: "Up to date",
  aging: "Due soon",
  due: "Overdue",
};
const FRESH_COLOR: Record<Freshness, string> = {
  none: atlas.muted,
  fresh: atlas.teal,
  aging: atlas.copper,
  due: atlas.copper,
};

/** react-native-svg takes onPress natively and onClick on the web. */
const press = (fn: () => void) =>
  (Platform.OS === "web" ? { onClick: fn } : { onPress: fn }) as object;

/** Top-down head. Each region is a target coloured by how fresh its photos are. */
export type HeadPalette = {
  ink: string;
  surface: string;
  none: string;
  fresh: string;
  aging: string;
  due: string;
};
const ATLAS_HEAD: HeadPalette = {
  ink: atlas.ink,
  surface: atlas.surface,
  none: "#E6EAEF",
  fresh: atlas.teal,
  aging: "#D9A784",
  due: atlas.copper,
};
export function HeadMap({
  size,
  selected,
  fresh,
  onSelect,
  palette = ATLAS_HEAD,
}: {
  size: number;
  selected: ScalpView;
  fresh: Record<ScalpView, Freshness>;
  onSelect: (view: ScalpView) => void;
  palette?: HeadPalette;
}) {
  const paint = (view: ScalpView) => {
    const f = fresh[view];
    const on = view === selected;
    return {
      fill: palette[f],
      fillOpacity: f === "fresh" ? (on ? 1 : 0.85) : 1,
      stroke: on ? palette.ink : "transparent",
      strokeWidth: on ? 2.2 : 0,
      ...press(() => onSelect(view)),
    };
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M45 14q5-6 10 0" stroke={palette.ink} strokeWidth={1.4} fill="none" />
      <Ellipse cx={50} cy={53} rx={33} ry={39} stroke={palette.ink} strokeWidth={1.4} fill={palette.surface} />
      <Path d="M17 44c-4 2-4 10 0 12 M83 44c4 2 4 10 0 12" stroke={palette.ink} strokeWidth={1.4} fill="none" />
      <Path
        d="M32 29Q50 16 68 29"
        fill="none"
        stroke={paint("hairline").fill}
        strokeOpacity={paint("hairline").fillOpacity}
        strokeWidth={selected === "hairline" ? 11 : 8}
        strokeLinecap="round"
        {...press(() => onSelect("hairline"))}
      />
      <Ellipse cx={26} cy={37} rx={6} ry={8.5} {...paint("left_temple")} />
      <Ellipse cx={74} cy={37} rx={6} ry={8.5} {...paint("right_temple")} />
      <Circle cx={50} cy={47} r={11.5} {...paint("top")} />
      <Circle cx={50} cy={72} r={10.5} {...paint("crown")} />
    </Svg>
  );
}

export function VariantAtlas({ journal }: { journal: Journal }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const latest = Object.fromEntries(
    VIEWS.map((v) => [v, latestOf(journal.photos, v)]),
  ) as Record<ScalpView, Photo | undefined>;
  const fresh = Object.fromEntries(
    VIEWS.map((v) => [v, freshness(latest[v])]),
  ) as Record<ScalpView, Freshness>;
  // Open on the region that most needs a photo, then the one shot most recently.
  const rank: Freshness[] = ["due", "aging", "none", "fresh"];
  const initial =
    [...VIEWS].sort(
      (a, b) =>
        rank.indexOf(fresh[a]) - rank.indexOf(fresh[b]) ||
        (latest[b]?.taken_at ?? "").localeCompare(latest[a]?.taken_at ?? ""),
    )[0] ?? "top";
  const [view, setView] = useState<ScalpView>(initial);
  const timeline = byDateDesc(
    journal.photos.filter((p) => p.view === view),
  ).reverse();
  const first = byDateDesc(journal.photos).at(-1);
  const total = journal.photos.length;
  const map = Math.min(176, (width - 32 - 36) * 0.46);
  return (
    <View style={{ flex: 1, backgroundColor: atlas.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          paddingBottom: 110,
        }}
      >
        <View style={{ maxWidth: 560, width: "100%", alignSelf: "center", gap: 18 }}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Photos</Text>
              <Text style={styles.sub}>
                {first
                  ? `Day ${elapsedDays(first.taken_at) + 1} · ${total} photos`
                  : "Your scalp, region by region"}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 4 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Import photos" onPress={() => router.push("/import")} style={styles.iconBtn}>
                <Icon name="upload" color={atlas.ink} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Account" onPress={() => router.push("/account")} style={styles.iconBtn}>
                <Icon name="account" color={atlas.ink} />
              </Pressable>
            </View>
          </View>

          <View style={styles.hero}>
            <View style={{ flexDirection: "row", gap: 18, alignItems: "center" }}>
              <HeadMap size={map} selected={view} fresh={fresh} onSelect={setView} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={[styles.eyebrow, { color: FRESH_COLOR[fresh[view]] }]}>
                  {FRESH_LABEL[fresh[view]].toUpperCase()}
                </Text>
                <Text style={styles.region}>{VIEW_LABELS[view]}</Text>
                <Text style={styles.body}>
                  {timeline.length
                    ? `${timeline.length} photo${timeline.length === 1 ? "" : "s"} · last ${ago(timeline.at(-1)!.taken_at)}`
                    : "No photos of this region yet"}
                </Text>
                {timeline.length > 1 && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.navigate("/compare")}
                    style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
                  >
                    <Text style={styles.link}>
                      Compare {elapsedDays(timeline[0].taken_at, timeline.at(-1)!.taken_at)} days
                    </Text>
                    <Icon name="chevron" size={16} color={atlas.teal} />
                  </Pressable>
                )}
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Photograph ${VIEW_LABELS[view].toLowerCase()}`}
              onPress={() => router.push({ pathname: "/capture", params: { view } })}
              style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Icon name="camera" color="#FFF" />
              <Text style={styles.ctaText}>Photograph {VIEW_LABELS[view].toLowerCase()}</Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -16 }}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          >
            {timeline.map((photo, i) => (
              <Pressable
                key={photo.id}
                accessibilityRole="button"
                accessibilityLabel={`${VIEW_LABELS[photo.view]}, ${shortDate(photo.taken_at)}`}
                onPress={() => router.push({ pathname: "/photo/[id]", params: { id: photo.id } })}
                style={{ width: 88, gap: 6 }}
              >
                <Image source={{ uri: photo.uri }} style={styles.film} resizeMode="cover" />
                <Text style={[styles.filmDate, i === timeline.length - 1 && { color: atlas.ink, fontWeight: "700" }]}>
                  {shortDate(photo.taken_at)}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${VIEW_LABELS[view].toLowerCase()} photo`}
              onPress={() => router.push({ pathname: "/capture", params: { view } })}
              style={[styles.film, styles.filmAdd]}
            >
              <Icon name="plus" color={atlas.muted} />
            </Pressable>
          </ScrollView>

          <View style={styles.list}>
            {VIEWS.map((v, i) => {
              const p = latest[v];
              const count = journal.photos.filter((x) => x.view === v).length;
              const on = v === view;
              return (
                <Pressable
                  key={v}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setView(v)}
                  style={[styles.row, i > 0 && { borderTopWidth: 1, borderColor: atlas.line }, on && { backgroundColor: "#F7F8FA" }]}
                >
                  {p ? (
                    <Image source={{ uri: p.uri }} style={styles.thumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.thumb, { backgroundColor: atlas.bg, alignItems: "center", justifyContent: "center" }]}>
                      <Icon name="camera" size={18} color={atlas.muted} />
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowName}>{VIEW_LABELS[v]}</Text>
                    <Text style={styles.rowMeta}>
                      {p ? `${count} · last ${shortDate(p.taken_at)}` : "No photos yet"}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={[styles.dot, { backgroundColor: FRESH_COLOR[fresh[v]] }]} />
                    <Text style={[styles.rowMeta, { color: FRESH_COLOR[fresh[v]], fontWeight: "600" }]}>
                      {FRESH_LABEL[fresh[v]]}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  title: { fontFamily: FONT.serif, fontSize: 36, color: atlas.ink, letterSpacing: -0.5, lineHeight: 40 },
  sub: { fontSize: 13, color: atlas.muted, fontWeight: "500", marginTop: 2 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: atlas.surface, borderWidth: 1, borderColor: atlas.line },
  hero: { backgroundColor: atlas.surface, borderRadius: 28, padding: 18, gap: 18, borderWidth: 1, borderColor: atlas.line },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  region: { fontFamily: FONT.serif, fontSize: 30, color: atlas.ink, lineHeight: 34, letterSpacing: -0.4 },
  body: { fontSize: 14, color: atlas.muted, lineHeight: 20 },
  link: { fontSize: 14, color: atlas.teal, fontWeight: "700" },
  cta: { minHeight: 52, borderRadius: 16, backgroundColor: atlas.copper, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  ctaText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  film: { width: 88, height: 106, borderRadius: 14, backgroundColor: atlas.line },
  filmAdd: { borderWidth: 1.5, borderStyle: "dashed", borderColor: "#C3CBD3", backgroundColor: "transparent", alignItems: "center", justifyContent: "center" },
  filmDate: { fontSize: 12, color: atlas.muted, fontWeight: "500", textAlign: "center" },
  list: { backgroundColor: atlas.surface, borderRadius: 22, borderWidth: 1, borderColor: atlas.line, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, paddingVertical: 12 },
  thumb: { width: 52, height: 60, borderRadius: 12, backgroundColor: atlas.line },
  rowName: { fontFamily: FONT.serif, fontSize: 19, color: atlas.ink },
  rowMeta: { fontSize: 13, color: atlas.muted },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
