/**
 * PROTOTYPE B · "Darkroom". Photo-first and immersive: the newest photo is
 * the hero, then a filmstrip per region. Warm black with the brand's amber.
 */
import { useId } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Icon } from "@/components/ui";
import {
  VIEW_LABELS,
  elapsedDays,
  formatDate,
  photoMeta,
  type Journal,
  type Photo,
} from "@/lib/model";
import { VIEWS, ago, byDateDesc, shortDate } from "./shared";

export const dark = {
  bg: "#121015",
  surface: "#1C1922",
  raised: "#27222F",
  ink: "#F3EFE8",
  muted: "#9A939F",
  line: "#2E2938",
  amber: "#F2B544",
  amberInk: "#2A1D03",
};

function Fade({ height, from = 0 }: { height: number | `${number}%`; from?: number }) {
  // One gradient id per instance: the DOM dedupes ids across every Svg on the page.
  const id = `fade-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <Svg
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height }}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
    >
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={dark.bg} stopOpacity={from} />
          <Stop offset="1" stopColor={dark.bg} stopOpacity={0.96} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

export function VariantDarkroom({ journal }: { journal: Journal }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const all = byDateDesc(journal.photos);
  const latest = all[0];
  const sameView = latest ? all.filter((p) => p.view === latest.view) : [];
  const previous = sameView[1];
  const first = sameView.at(-1);
  const heroW = Math.min(width, 560) - 32;
  const rows = [...VIEWS]
    .map((view) => ({ view, photos: all.filter((p) => p.view === view) }))
    .sort(
      (a, b) =>
        Number(!a.photos.length) - Number(!b.photos.length) ||
        (b.photos[0]?.taken_at ?? "").localeCompare(a.photos[0]?.taken_at ?? ""),
    );
  return (
    <View style={{ flex: 1, backgroundColor: dark.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 110 }}>
        <View style={{ maxWidth: 560, width: "100%", alignSelf: "center", gap: 22 }}>
          <View style={styles.header}>
            <Text style={styles.wordmark}>FOLLICLE</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Import photos" onPress={() => router.push("/import")} style={styles.iconBtn}>
                <Icon name="upload" color={dark.ink} size={19} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Account" onPress={() => router.push("/account")} style={styles.iconBtn}>
                <Icon name="account" color={dark.ink} size={19} />
              </Pressable>
            </View>
          </View>

          {latest ? (
            <View style={{ alignSelf: "center", width: heroW }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Latest photo, ${VIEW_LABELS[latest.view]}, ${formatDate(latest.taken_at)}`}
                onPress={() => router.push({ pathname: "/photo/[id]", params: { id: latest.id } })}
                style={[styles.hero, { width: heroW, height: heroW * 1.05 }]}
              >
                <Image source={{ uri: latest.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                <Fade height="62%" />
                <View style={styles.heroTag}>
                  <Text style={styles.heroTagText}>LATEST · {VIEW_LABELS[latest.view].toUpperCase()}</Text>
                </View>
                <View style={styles.heroBody}>
                  <View style={{ flex: 1, gap: 4, paddingRight: first && first.id !== latest.id ? 72 : 0 }}>
                    <Text style={styles.heroDate}>{formatDate(latest.taken_at)}</Text>
                    <Text style={styles.heroMeta}>
                      {previous ? `${elapsedDays(previous.taken_at, latest.taken_at)} days since previous` : "First of this region"}
                      {" · "}
                      {photoMeta(latest, false)}
                    </Text>
                  </View>
                </View>
              </Pressable>
              {first && first.id !== latest.id && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Compare with ${formatDate(first.taken_at)}`}
                  onPress={() => router.navigate("/compare")}
                  style={styles.inset}
                >
                  <Image source={{ uri: first.uri }} style={styles.insetImage} resizeMode="cover" />
                  <Text style={styles.insetText}>vs {shortDate(first.taken_at)}</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={[styles.hero, styles.heroEmpty, { width: heroW, height: heroW * 0.9 }]}>
              <Icon name="camera" size={34} color={dark.amber} />
              <Text style={styles.heroDate}>Your first photo</Text>
              <Text style={[styles.heroMeta, { textAlign: "center" }]}>
                Same light, same angle, every few weeks. The app lines them up.
              </Text>
            </View>
          )}

          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              onPress={() => router.push("/capture")}
              style={({ pressed }) => [styles.primary, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Icon name="camera" color={dark.amberInk} />
              <Text style={styles.primaryText}>Take photo</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Import photos"
              onPress={() => router.push("/import")}
              style={styles.secondary}
            >
              <Icon name="upload" color={dark.ink} />
            </Pressable>
          </View>

          {rows.map(({ view, photos }) => (
            <View key={view} style={{ gap: 10 }}>
              <View style={styles.rowHead}>
                <Text style={styles.rowTitle}>{VIEW_LABELS[view]}</Text>
                <Text style={styles.rowMeta}>
                  {photos.length ? `${photos.length} · ${ago(photos[0].taken_at)}` : "none yet"}
                </Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                {photos.map((photo: Photo) => (
                  <Pressable
                    key={photo.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${VIEW_LABELS[photo.view]}, ${formatDate(photo.taken_at)}`}
                    onPress={() => router.push({ pathname: "/photo/[id]", params: { id: photo.id } })}
                    style={styles.tile}
                  >
                    <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    <Fade height="55%" />
                    <Text style={styles.tileDate}>{shortDate(photo.taken_at)}</Text>
                  </Pressable>
                ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${VIEW_LABELS[view].toLowerCase()} photo`}
                  onPress={() => router.push({ pathname: "/capture", params: { view } })}
                  style={[styles.tile, styles.tileAdd]}
                >
                  <Icon name="plus" color={dark.muted} />
                  {!photos.length && <Text style={styles.tileAddText}>First {VIEW_LABELS[view].toLowerCase()}</Text>}
                </Pressable>
              </ScrollView>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  wordmark: { color: dark.muted, fontSize: 13, fontWeight: "800", letterSpacing: 3.5 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: dark.surface },
  hero: { alignSelf: "center", borderRadius: 28, overflow: "hidden", backgroundColor: dark.surface, justifyContent: "flex-end" },
  heroEmpty: { alignItems: "center", justifyContent: "center", gap: 10, padding: 32, borderWidth: 1, borderColor: dark.line },
  heroTag: { position: "absolute", top: 14, left: 14, backgroundColor: "rgba(18,16,21,0.7)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  heroTagText: { color: dark.amber, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  heroBody: { flexDirection: "row", alignItems: "flex-end", gap: 12, padding: 18 },
  heroDate: { color: dark.ink, fontSize: 30, fontWeight: "800", letterSpacing: -0.8, lineHeight: 34 },
  heroMeta: { color: dark.muted, fontSize: 13, fontWeight: "500", lineHeight: 18 },
  inset: { position: "absolute", right: 18, bottom: 18, alignItems: "center", gap: 4 },
  insetImage: { width: 56, height: 56, borderRadius: 14, borderWidth: 2, borderColor: dark.amber },
  insetText: { color: dark.ink, fontSize: 11, fontWeight: "700" },
  primary: { flex: 1, minHeight: 54, borderRadius: 999, backgroundColor: dark.amber, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  primaryText: { color: dark.amberInk, fontSize: 16, fontWeight: "800" },
  secondary: { width: 54, height: 54, borderRadius: 27, backgroundColor: dark.surface, alignItems: "center", justifyContent: "center" },
  rowHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 16 },
  rowTitle: { color: dark.ink, fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },
  rowMeta: { color: dark.muted, fontSize: 13, fontWeight: "500" },
  tile: { width: 104, height: 130, borderRadius: 16, overflow: "hidden", backgroundColor: dark.surface, justifyContent: "flex-end", padding: 10 },
  tileDate: { color: dark.ink, fontSize: 12, fontWeight: "700" },
  tileAdd: { borderWidth: 1.5, borderStyle: "dashed", borderColor: dark.line, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", gap: 6 },
  tileAddText: { color: dark.muted, fontSize: 11, fontWeight: "600", textAlign: "center" },
});
