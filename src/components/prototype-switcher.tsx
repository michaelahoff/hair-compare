/**
 * PROTOTYPE ONLY. Floating bar that cycles UI variants on a route through a
 * `?variant=` search param. Never rendered in production builds.
 */
import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

export type PrototypeVariant = { key: string; name: string };

export function PrototypeSwitcher({
  variants,
  current,
  demo,
}: {
  variants: readonly PrototypeVariant[];
  current: string;
  /** Whether sample data is switched on; omit to hide the toggle. */
  demo?: boolean;
}) {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length];
    router.setParams({ variant: next.key });
  };
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (process.env.NODE_ENV === "production") return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous variant"
          onPress={() => go(-1)}
          style={styles.arrow}
        >
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <Text style={styles.label}>
            {variants[index].key.toUpperCase()} · {variants[index].name}
          </Text>
          <Text style={styles.sub}>
            prototype {index + 1}/{variants.length}
            {demo !== undefined && ` · ${demo ? "sample data" : "your data"}`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next variant"
          onPress={() => go(1)}
          style={styles.arrow}
        >
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
        {demo !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={demo ? "Use your data" : "Use sample data"}
            onPress={() => router.setParams({ demo: demo ? "0" : "1" })}
            style={[styles.toggle, demo && styles.toggleOn]}
          >
            <Text style={[styles.toggleText, demo && { color: "#5B21B6" }]}>
              demo
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    pointerEvents: "box-none",
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 10,
    alignItems: "center",
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#5B21B6",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  arrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  arrowText: { color: "#FFF", fontSize: 22, lineHeight: 24, fontWeight: "700" },
  label: { color: "#FFF", fontSize: 13, fontWeight: "800" },
  sub: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "600" },
  toggle: {
    marginLeft: 2,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
  },
  toggleOn: { backgroundColor: "#FFF", borderColor: "#FFF" },
  toggleText: { color: "#FFF", fontSize: 12, fontWeight: "700" },
});
