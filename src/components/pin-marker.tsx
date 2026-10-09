import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { readFraming, type FramingEdit } from "./framed-photo";
import {
  baseBox,
  frameDeltaToPhoto,
  guideToFrame,
  photoPointToGuide,
} from "@/lib/framing";
import type { Point } from "@/lib/outline";

/** Pin colours, in the order pins are added. */
export const PIN_COLORS = [
  "#7CF2B6",
  "#F2D86B",
  "#7CC8F2",
  "#F29A4A",
  "#C79BF2",
  "#FF6B5E",
  "#9BF2E8",
  "#F2A6D8",
];
const RING = 30;

/**
 * A pin on a photo being lined up, riding along as the photo moves. Dragging
 * it moves it by the finger's travel rather than to the finger, so the finger
 * never hides the spot. `onMove` gets its new place in photo fractions.
 */
export function PinMarker({
  id,
  n,
  name,
  color,
  at,
  photo,
  edit,
  turn,
  width,
  height,
  onMove,
}: {
  id: string;
  /** The pin's number, shown on it; its name shows while it is dragged. */
  n: number;
  name: string;
  color: string;
  at: Point;
  photo: { width: number; height: number };
  edit: FramingEdit;
  turn: number;
  /** The frame the photo is drawn in. */
  width: number;
  height: number;
  onMove: (id: string, at: Point) => void;
}) {
  const size = Math.min(width, height);
  const base = baseBox(photo);
  const fx = useSharedValue(at.x);
  const fy = useSharedValue(at.y);
  const lift = useSharedValue(0);
  useEffect(() => {
    fx.set(at.x);
    fy.set(at.y);
  }, [at.x, at.y, fx, fy]);

  const tap = () =>
    Haptics.selectionAsync().catch(() => {});
  const drop = (x: number, y: number) => onMove(id, { x, y });
  const drag = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      lift.set(withSpring(1, { duration: 250, dampingRatio: 0.7 }));
      scheduleOnRN(tap);
    })
    .onChange((e) => {
      const d = frameDeltaToPhoto(
        e.changeX,
        e.changeY,
        turn,
        size,
        base,
        readFraming(edit),
      );
      fx.set(Math.min(1, Math.max(0, fx.get() + d.x)));
      fy.set(Math.min(1, Math.max(0, fy.get() + d.y)));
    })
    .onFinalize(() => {
      lift.set(withSpring(0, { duration: 300, dampingRatio: 0.7 }));
      scheduleOnRN(drop, fx.get(), fy.get());
    });

  const placed = useAnimatedStyle(() => {
    const g = photoPointToGuide(fx.get(), fy.get(), base, readFraming(edit));
    const at = guideToFrame(g.x, g.y, turn, size, width, height);
    return {
      transform: [
        { translateX: at.x - RING / 2 },
        { translateY: at.y - RING / 2 },
      ],
    };
  });
  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + lift.get() * 0.35 }],
  }));
  const hairs = useAnimatedStyle(() => ({ opacity: lift.get() }));
  const naming = useAnimatedStyle(() => ({
    opacity: lift.get(),
    transform: [{ translateY: (1 - lift.get()) * -4 }],
  }));

  return (
    <Animated.View style={[styles.pin, placed]}>
      <GestureDetector gesture={drag}>
        <Animated.View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`${name} pin. Drag onto the ${name.toLowerCase()}.`}
          hitSlop={12}
          style={[styles.ring, { borderColor: color }, ring]}
        >
          <Animated.View
            pointerEvents="none"
            style={[styles.hairH, { backgroundColor: color }, hairs]}
          />
          <Animated.View
            pointerEvents="none"
            style={[styles.hairV, { backgroundColor: color }, hairs]}
          />
          <View style={[styles.dot, { backgroundColor: color }]} />
        </Animated.View>
      </GestureDetector>
      <View pointerEvents="none" style={[styles.badge, { backgroundColor: color }]}>
        <Text style={styles.badgeText}>{n}</Text>
      </View>
      <Animated.View pointerEvents="none" style={[styles.tag, naming]}>
        <Text numberOfLines={1} style={[styles.tagText, { color }]}>
          {name}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pin: {
    position: "absolute",
    left: 0,
    top: 0,
    width: RING,
    height: RING,
    alignItems: "center",
  },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12,24,20,0.15)",
  },
  dot: { width: 4, height: 4, borderRadius: 2 },
  hairH: { position: "absolute", width: 64, height: 1 },
  hairV: { position: "absolute", width: 1, height: 64 },
  badge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 10, fontWeight: "800", color: "#0F1A17" },
  tag: {
    position: "absolute",
    top: -26,
    left: (RING - 120) / 2,
    width: 120,
    alignItems: "center",
  },
  tagText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowRadius: 3,
  },
});
