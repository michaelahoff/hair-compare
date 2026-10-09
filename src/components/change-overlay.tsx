import { useEffect, useMemo, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { G, Rect } from "react-native-svg";
import type { ChangeMap } from "@/lib/change-map";

const FADE_MS = 250;
// A hair larger than the cell, so antialiasing leaves no seams.
const BLEED = 1.02;

/**
 * The texture change map drawn over a photo on its guide square, with the
 * same square and turn as `Guide`, so it sits on the photo's own pixels.
 * Fades in whenever a new map arrives, unless the OS asks for reduced motion.
 */
export function ChangeOverlay({
  map,
  turn,
  size,
  opacity,
}: {
  map: ChangeMap;
  turn: number;
  /** Side of the guide square, centred in the parent. */
  size: number;
  opacity: number;
}) {
  const reduced = useReducedMotion();
  const fade = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) fade.value = 1;
    else {
      fade.value = 0;
      fade.value = withTiming(1, { duration: FADE_MS });
    }
  }, [map, reduced, fade]);
  const style = useAnimatedStyle(
    () => ({ opacity: fade.value * opacity }),
    [opacity],
  );

  // Blocks are unturned guide units, so the group turns like the guide does.
  const blocks = useMemo(() => {
    const n = map.size;
    const rects: ReactNode[] = [];
    for (let row = 0; row < n; row++)
      for (let col = 0; col < n; col++) {
        const at = (row * n + col) * 4;
        const alpha = map.rgba[at + 3];
        if (!alpha) continue;
        rects.push(
          <Rect
            key={at}
            x={col}
            y={row}
            width={BLEED}
            height={BLEED}
            fill={`rgb(${map.rgba.slice(at, at + 3).join(",")})`}
            fillOpacity={alpha / 255}
          />,
        );
      }
    return rects;
  }, [map]);

  const n = map.size;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { alignItems: "center", justifyContent: "center" },
        style,
      ]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`}>
        <G transform={`rotate(${turn * 90} ${n / 2} ${n / 2})`}>{blocks}</G>
      </Svg>
    </Animated.View>
  );
}
