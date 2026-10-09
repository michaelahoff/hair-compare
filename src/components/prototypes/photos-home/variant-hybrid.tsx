/**
 * PROTOTYPE D · "Hybrid". The Ledger's dated log as the body, the Atlas head
 * as a lens in the middle, and the span strip on top. The head's selected
 * region drives the strip above and rings its photos in the log below.
 */
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui";
import {
  VIEW_LABELS,
  type Journal,
  type Photo,
  type ScalpView,
} from "@/lib/model";
import { FONT, VIEWS, ago, latestOf } from "./shared";
import {
  FRESH_LABEL,
  HeadMap,
  freshness,
  type Freshness,
  type HeadPalette,
} from "./variant-atlas";
import {
  LedgerHeader,
  LedgerLog,
  ProgressStrip,
  ledger,
} from "./variant-ledger";

const HEAD: HeadPalette = {
  ink: ledger.ink,
  surface: ledger.surface,
  none: "#DCE3DE",
  fresh: ledger.moss,
  aging: "#D9A784",
  due: ledger.rust,
};
const TONE: Record<Freshness, string> = {
  none: ledger.muted,
  fresh: ledger.moss,
  aging: ledger.rust,
  due: ledger.rust,
};

export function VariantHybrid({ journal }: { journal: Journal }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const latest = Object.fromEntries(
    VIEWS.map((v) => [v, latestOf(journal.photos, v)]),
  ) as Record<ScalpView, Photo | undefined>;
  const fresh = Object.fromEntries(
    VIEWS.map((v) => [v, freshness(latest[v])]),
  ) as Record<ScalpView, Freshness>;
  const rank: Freshness[] = ["due", "aging", "none", "fresh"];
  const initial =
    [...VIEWS].sort(
      (a, b) =>
        rank.indexOf(fresh[a]) - rank.indexOf(fresh[b]) ||
        (latest[b]?.taken_at ?? "").localeCompare(latest[a]?.taken_at ?? ""),
    )[0] ?? "top";
  const [view, setView] = useState<ScalpView>(initial);
  const regionPhotos = journal.photos.filter((p) => p.view === view);
  // The strip follows the selected region, else the longest record.
  const spanPhotos =
    regionPhotos.length > 1
      ? regionPhotos
      : VIEWS.map((v) => journal.photos.filter((p) => p.view === v))
          .filter((ps) => ps.length > 1)
          .sort((a, b) => b.length - a.length)[0];
  const map = Math.min(168, (Math.min(width, 560) - 32 - 36) * 0.44);
  return (
    <View style={{ flex: 1, backgroundColor: ledger.paper }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          paddingBottom: 110,
        }}
      >
        <View style={{ maxWidth: 560, width: "100%", alignSelf: "center", gap: 16 }}>
          <LedgerHeader journal={journal} />

          {spanPhotos ? (
            <ProgressStrip photos={spanPhotos} />
          ) : (
            <View style={styles.stripEmpty}>
              <Text style={styles.stripEmptyText}>
                Two photos of one region start the comparison.
              </Text>
            </View>
          )}

          <View style={styles.head}>
            <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
              <HeadMap size={map} selected={view} fresh={fresh} onSelect={setView} palette={HEAD} />
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={[styles.eyebrow, { color: TONE[fresh[view]] }]}>
                  {FRESH_LABEL[fresh[view]].toUpperCase()}
                </Text>
                <Text style={styles.region}>{VIEW_LABELS[view]}</Text>
                <Text style={styles.meta}>
                  {regionPhotos.length
                    ? `${regionPhotos.length} photo${regionPhotos.length === 1 ? "" : "s"} · last ${ago(latest[view]!.taken_at)}`
                    : "Tap a region to switch"}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Photograph ${VIEW_LABELS[view].toLowerCase()}`}
                  onPress={() => router.push({ pathname: "/capture", params: { view } })}
                  style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
                >
                  <Icon name="camera" size={18} color="#FFF" />
                  <Text style={styles.ctaText}>Photograph</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.legend}>
              {VIEWS.map((v) => (
                <Pressable
                  key={v}
                  accessibilityRole="button"
                  accessibilityState={{ selected: v === view }}
                  onPress={() => setView(v)}
                  style={[styles.legendItem, v === view && styles.legendOn]}
                >
                  <View style={[styles.legendDot, { backgroundColor: HEAD[fresh[v]] }]} />
                  <Text style={[styles.legendText, v === view && { color: ledger.ink }]}>
                    {VIEW_LABELS[v]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <LedgerLog journal={journal} highlight={view} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  stripEmpty: { backgroundColor: ledger.surface, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: ledger.line },
  stripEmptyText: { fontSize: 13, color: ledger.muted, textAlign: "center" },
  head: { backgroundColor: ledger.surface, borderRadius: 22, padding: 16, gap: 12, borderWidth: 1, borderColor: ledger.line },
  eyebrow: { fontFamily: FONT.mono, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  region: { fontSize: 26, fontWeight: "800", letterSpacing: -0.6, color: ledger.ink, lineHeight: 30 },
  meta: { fontSize: 13, color: ledger.muted, lineHeight: 18 },
  cta: { marginTop: 6, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, height: 42, paddingHorizontal: 16, borderRadius: 999, backgroundColor: ledger.moss },
  ctaText: { color: "#FFF", fontSize: 14, fontWeight: "700" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 6, borderTopWidth: 1, borderColor: ledger.line, paddingTop: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 30, borderRadius: 999, backgroundColor: ledger.paper },
  legendOn: { backgroundColor: ledger.mossSoft },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, fontWeight: "600", color: ledger.muted },
});
