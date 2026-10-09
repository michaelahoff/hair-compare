import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { colors } from "./ui";
import {
  OUTLINE_POINTS,
  centroid,
  lerpPoints,
  regionPolygon,
  resample,
  toPath,
  type Point,
  type RegionShape,
} from "@/lib/outline";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const MORPH_MS = 600;

/** An earlier outline, already in the current photo's fractions. */
export type OutlineFrom = { area: string; points: Point[] };

type Shape = {
  key: string;
  area: string;
  /** The outline to morph from, or null to fade in. */
  from: Point[] | null;
  /** The outline the region ends on. Both are resampled to the same count. */
  to: Point[];
};

/**
 * Regions as soft polygons over a photo, in its pixel `box`. A region whose
 * area is in `from` morphs from that outline; the others fade in. Changing
 * `animationKey` plays the animation again. Reduced motion shows the end state
 * straight away.
 */
export function RegionOutlines({
  regions,
  box,
  from,
  animationKey,
}: {
  regions: RegionShape[];
  box: { width: number; height: number };
  from?: OutlineFrom[] | null;
  animationKey?: string;
}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      progress.set(1);
      return;
    }
    progress.set(0);
    progress.set(withTiming(1, { duration: MORPH_MS }));
  }, [animationKey, reduced, progress]);

  const shapes = useMemo(() => toShapes(regions, from), [regions, from]);
  const { width, height } = box;
  return (
    <View pointerEvents="none" style={[styles.layer, { width, height }]}>
      <Svg
        pointerEvents="none"
        width={width}
        height={height}
        style={styles.layer}
      >
        {shapes.map((shape) => (
          <Outline
            key={shape.key}
            shape={shape}
            progress={progress}
            width={width}
            height={height}
          />
        ))}
      </Svg>
      {shapes.map((shape) => (
        <Label
          key={shape.key}
          shape={shape}
          progress={progress}
          width={width}
          height={height}
        />
      ))}
    </View>
  );
}

/** Each region with an outline, resampled, and the outline it follows. */
function toShapes(
  regions: RegionShape[],
  from?: OutlineFrom[] | null,
): Shape[] {
  const seen = new Map<string, number>();
  const shapes: Shape[] = [];
  regions.forEach((region, index) => {
    const polygon = regionPolygon(region);
    if (!polygon) return;
    // The nth region of an area morphs from the nth earlier outline of it.
    const nth = seen.get(region.area) ?? 0;
    seen.set(region.area, nth + 1);
    const earlier = from?.filter((f) => f.area === region.area)[nth];
    shapes.push({
      key: `${region.area}-${index}`,
      area: region.area,
      from: earlier ? resample(earlier.points, OUTLINE_POINTS) : null,
      to: resample(polygon, OUTLINE_POINTS),
    });
  });
  return shapes;
}

type RegionProps = {
  shape: Shape;
  progress: SharedValue<number>;
  width: number;
  height: number;
};

/**
 * The region's polygon. Morphing regions interpolate point by point; fading
 * ones stay put and fade. The worklet only reads plain arrays and numbers.
 */
function Outline({ shape, progress, width, height }: RegionProps) {
  const { from, to } = shape;
  const animatedProps = useAnimatedProps(() => {
    const t = progress.get();
    return {
      d: toPath(from ? lerpPoints(from, to, t) : to, width, height),
      opacity: from ? 1 : t,
    };
  });
  return (
    <AnimatedPath
      animatedProps={animatedProps}
      fill={colors.loupe}
      fillOpacity={0.12}
      stroke={colors.loupe}
      strokeWidth={2}
      strokeLinejoin="round"
    />
  );
}

/**
 * The area name at the polygon's centre. The label sits centred in a box-sized
 * layer and is moved by an offset from that centre, so its width need not be
 * measured.
 */
function Label({ shape, progress, width, height }: RegionProps) {
  const { area, from, to } = shape;
  const animatedStyle = useAnimatedStyle(() => {
    const t = progress.get();
    const at = centroid(from ? lerpPoints(from, to, t) : to);
    return {
      opacity: from ? 1 : t,
      transform: [
        { translateX: (at.x - 0.5) * width },
        { translateY: (at.y - 0.5) * height },
      ],
    };
  });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.centre]}>
      <Animated.View style={animatedStyle}>
        <Text style={styles.label}>{area.replaceAll("_", " ")}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: 0, top: 0 },
  centre: { alignItems: "center", justifyContent: "center" },
  label: {
    color: colors.ink,
    backgroundColor: colors.loupe,
    fontSize: 9,
    paddingHorizontal: 3,
  },
});
