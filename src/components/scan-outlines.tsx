import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { guideToFrame } from "@/lib/framing";
import { resample, type Point } from "@/lib/outline";
import type { ScalpArea, Severity } from "@/lib/model";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const LABEL = 180;
const DRAW_MS = 900;
/** Each outline starts drawing this far into the one before it. */
const STAGGER = 0.55;

export const SEVERITY_COLOR: Record<Severity, string> = {
  none: "#7CF2B6",
  mild: "#F2D86B",
  moderate: "#F29A4A",
  severe: "#FF6B5E",
};

/** A region to draw, in guide units centred on the guide square (side 1). */
export type InspectShape = {
  key: string;
  area: ScalpArea;
  severity: Severity;
  points: Point[];
};

function path(points: Point[]) {
  return (
    points
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join("") + "Z"
  );
}

function perimeter(points: Point[]) {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/**
 * Regions an analysis inspected, traced onto a frame one after another, each
 * glowing in its severity's colour with an upright label. The `focus` area
 * stands out and the rest dim. Changing `drawKey` traces them again.
 */
export function ScanOutlines({
  shapes,
  width,
  height,
  turn,
  focus,
  drawKey,
}: {
  shapes: InspectShape[];
  width: number;
  height: number;
  turn: number;
  focus?: ScalpArea | null;
  drawKey?: string;
}) {
  const reduced = useReducedMotion();
  const size = Math.min(width, height);
  const progress = useSharedValue(reduced ? shapes.length : 0);
  useEffect(() => {
    if (reduced) {
      progress.set(shapes.length + 1);
      return;
    }
    progress.set(0);
    progress.set(
      withTiming(shapes.length * STAGGER + 1, {
        duration: DRAW_MS * (shapes.length * STAGGER + 1),
        easing: Easing.out(Easing.quad),
      }),
    );
  }, [drawKey, shapes.length, reduced, progress]);
  const drawn = useMemo(
    () =>
      shapes.map((shape) => {
        const points = resample(shape.points, 32).map((p) =>
          guideToFrame(p.x, p.y, turn, size, width, height),
        );
        const top = points.reduce((a, b) => (b.y < a.y ? b : a));
        return { ...shape, d: path(points), length: perimeter(points), top };
      }),
    [shapes, turn, size, width, height],
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {drawn.map((shape, i) => (
          <Outline
            key={shape.key}
            d={shape.d}
            length={shape.length}
            color={SEVERITY_COLOR[shape.severity]}
            index={i}
            progress={progress}
            dim={Boolean(focus) && focus !== shape.area}
          />
        ))}
      </Svg>
      {drawn.map((shape, i) => (
        <Label
          key={shape.key}
          at={shape.top}
          width={width}
          text={`${shape.area.replaceAll("_", " ")} · ${shape.severity}`}
          color={SEVERITY_COLOR[shape.severity]}
          index={i}
          progress={progress}
          dim={Boolean(focus) && focus !== shape.area}
        />
      ))}
    </View>
  );
}

const share = (progress: number, index: number) => {
  "worklet";
  return Math.min(1, Math.max(0, progress - index * STAGGER));
};

function Outline({
  d,
  length,
  color,
  index,
  progress,
  dim,
}: {
  d: string;
  length: number;
  color: string;
  index: number;
  progress: SharedValue<number>;
  dim: boolean;
}) {
  const stroke = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - share(progress.get(), index)),
  }));
  const fill = useAnimatedProps(() => ({
    fillOpacity: Math.max(0, share(progress.get(), index) - 0.6) * 0.45,
  }));
  const opacity = dim ? 0.3 : 1;
  return (
    <>
      <AnimatedPath
        d={d}
        fill={color}
        animatedProps={fill}
        opacity={opacity}
        stroke="none"
      />
      <AnimatedPath
        d={d}
        fill="none"
        stroke={color}
        strokeOpacity={0.35 * opacity}
        strokeWidth={9}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={[length, length]}
        animatedProps={stroke}
      />
      <AnimatedPath
        d={d}
        fill="none"
        stroke={color}
        strokeOpacity={opacity}
        strokeWidth={dim ? 1.5 : 2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={[length, length]}
        animatedProps={stroke}
      />
    </>
  );
}

function Label({
  at,
  width,
  text,
  color,
  index,
  progress,
  dim,
}: {
  at: Point;
  width: number;
  text: string;
  color: string;
  index: number;
  progress: SharedValue<number>;
  dim: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const t = share(progress.get(), index);
    return {
      opacity: Math.max(0, t * 2 - 1) * (dim ? 0.45 : 1),
      transform: [{ translateY: (1 - t) * 6 }],
    };
  });
  // Centred over the outline's highest point, kept inside the frame.
  const left = Math.max(4, Math.min(width - LABEL - 4, at.x - LABEL / 2));
  return (
    <Animated.View
      style={[styles.label, { left, top: Math.max(4, at.y - 24) }, style]}
    >
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text numberOfLines={1} style={styles.labelText}>
        {text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  label: {
    position: "absolute",
    width: LABEL,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  swatch: { width: 7, height: 7, borderRadius: 4 },
  labelText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 3,
  },
});
