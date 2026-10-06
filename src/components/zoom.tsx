import { useState, type ReactNode } from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Icon, colors } from "./ui";

const MAX_SCALE = 6;
// Pinching below 1× is allowed for feel, then springs back on release.
const MIN_PINCH = 0.8;
const DOUBLE_TAP_SCALE = 2.5;
const ZOOMED = 1.01;
// Web reports the pinch focal point in page coordinates; native, in the view's.
const PAGE_FOCAL = Platform.OS === "web";
// How far a finger travels sideways before a swipe takes over, and how far
// (as a share of the frame) or how fast it must go to change photos.
const SWIPE_SLOP = 16;
const SWIPE_COMMIT = 0.22;
const SWIPE_FLING = 600;

/**
 * Zoom and pan as fractions of the frame (translation is from its centre),
 * so frames of any size, or several frames at once, can share one view.
 */
export type Zoom = {
  scale: SharedValue<number>;
  x: SharedValue<number>;
  y: SharedValue<number>;
};
export function useZoom(): Zoom {
  return {
    scale: useSharedValue(1),
    x: useSharedValue(0),
    y: useSharedValue(0),
  };
}

/** Furthest the content may shift at `scale` before an edge enters the frame. */
function reach(scale: number) {
  "worklet";
  return Math.max(0, (scale - 1) / 2);
}
function clamp(value: number, limit: number) {
  "worklet";
  return Math.min(limit, Math.max(-limit, value));
}
function reset(z: Zoom) {
  "worklet";
  z.scale.set(withTiming(1, { duration: 220 }));
  z.x.set(withTiming(0, { duration: 220 }));
  z.y.set(withTiming(0, { duration: 220 }));
}

/**
 * A frame with photo-style zoom: pinch around the fingers, drag to pan once
 * zoomed, double-tap to zoom in or back out. Frames given the same `zoom`
 * move together. Given `onOlder`/`onNewer`, swiping sideways at normal size
 * (or the edge arrows) steps through photos like a carousel.
 */
export function ZoomFrame({
  zoom: z,
  height,
  style,
  overlay,
  onOlder,
  onNewer,
  stepLabel = "photo",
  children,
}: {
  zoom: Zoom;
  height: number;
  style?: ViewStyle;
  overlay?: ReactNode;
  /** Omitted at the start of the timeline. */
  onOlder?: () => void;
  /** Omitted at the end of the timeline. */
  onNewer?: () => void;
  /** Names what the arrows step through, e.g. "before photo". */
  stepLabel?: string;
  /** Receives the measured frame width. */
  children: (width: number) => ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const swipeX = useSharedValue(0);
  const hasOlder = Boolean(onOlder);
  const hasNewer = Boolean(onNewer);
  const step = (direction: number) => (direction < 0 ? onOlder : onNewer)?.();
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  useAnimatedReaction(
    () => z.scale.get() > ZOOMED,
    (now, before) => {
      if (now !== before) scheduleOnRN(setZoomed, now);
    },
  );

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      focalX.set((e.focalX - originX.get()) / width - 0.5);
      focalY.set((e.focalY - originY.get()) / height - 0.5);
    })
    .onChange((e) => {
      const fx = (e.focalX - originX.get()) / width - 0.5;
      const fy = (e.focalY - originY.get()) / height - 0.5;
      const scale = z.scale.get();
      const next = Math.min(
        MAX_SCALE,
        Math.max(MIN_PINCH, scale * e.scaleChange),
      );
      // Follow the fingers as they move, then scale about the point between them.
      const x = z.x.get() + fx - focalX.get();
      const y = z.y.get() + fy - focalY.get();
      const k = next / scale;
      z.scale.set(next);
      z.x.set(clamp(fx - k * (fx - x), reach(next)));
      z.y.set(clamp(fy - k * (fy - y), reach(next)));
      focalX.set(fx);
      focalY.set(fy);
    })
    .onEnd(() => {
      if (z.scale.get() < 1) reset(z);
    });
  // One finger pans only when zoomed in; otherwise the page keeps scrolling.
  const pan = Gesture.Pan()
    .maxPointers(1)
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (z.scale.get() > ZOOMED) state.activate();
      else state.fail();
    })
    .onChange((e) => {
      const limit = reach(z.scale.get());
      z.x.set(clamp(z.x.get() + e.changeX / width, limit));
      z.y.set(clamp(z.y.get() + e.changeY / height, limit));
    });
  // Dragging right reveals the older photo, as in a photo carousel.
  const swipe = Gesture.Pan()
    .enabled(hasOlder || hasNewer)
    .maxPointers(1)
    .activeOffsetX([-SWIPE_SLOP, SWIPE_SLOP])
    .failOffsetY([-SWIPE_SLOP, SWIPE_SLOP])
    .onChange((e) => {
      if (z.scale.get() > ZOOMED) return;
      const blocked = e.translationX > 0 ? !hasOlder : !hasNewer;
      swipeX.set(e.translationX * (blocked ? 0.2 : 1));
    })
    .onEnd((e) => {
      if (z.scale.get() > ZOOMED) return;
      const direction = e.translationX > 0 ? -1 : 1;
      const far =
        Math.abs(e.translationX) > width * SWIPE_COMMIT ||
        Math.abs(e.velocityX) > SWIPE_FLING;
      if (far && (direction < 0 ? hasOlder : hasNewer))
        scheduleOnRN(step, direction);
    })
    .onFinalize(() => {
      swipeX.set(withTiming(0, { duration: 180 }));
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    // Read the point while the finger is down: web reports none once it lifts.
    .onBegin((e) => {
      if (PAGE_FOCAL) {
        // The first finger of any touch, pinches included, begins the tap,
        // so this locates the frame on the page before a pinch starts.
        originX.set(e.absoluteX - e.x);
        originY.set(e.absoluteY - e.y);
      }
      focalX.set(e.x / width - 0.5);
      focalY.set(e.y / height - 0.5);
    })
    .onEnd((_e, success) => {
      if (!success) return;
      if (z.scale.get() > ZOOMED) return reset(z);
      // Keep the tapped point where it is while zooming in on it.
      const limit = reach(DOUBLE_TAP_SCALE);
      const x = clamp(focalX.get() * (1 - DOUBLE_TAP_SCALE), limit);
      const y = clamp(focalY.get() * (1 - DOUBLE_TAP_SCALE), limit);
      z.scale.set(withTiming(DOUBLE_TAP_SCALE, { duration: 220 }));
      z.x.set(withTiming(x, { duration: 220 }));
      z.y.set(withTiming(y, { duration: 220 }));
    });

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: z.x.get() * width + swipeX.get() },
      { translateY: z.y.get() * height },
      { scale: z.scale.get() },
    ],
  }));
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[
        { height, overflow: "hidden", backgroundColor: colors.stage },
        style,
      ]}
    >
      <GestureDetector
        gesture={Gesture.Simultaneous(pinch, pan, swipe, doubleTap)}
      >
        <View style={StyleSheet.absoluteFill}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { alignItems: "center", justifyContent: "center" },
              zoomStyle,
            ]}
          >
            {width > 0 && children(width)}
          </Animated.View>
        </View>
      </GestureDetector>
      {overlay}
      {/* Outside the gesture surface so the zoom gestures never swallow their presses. */}
      {onOlder && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Older ${stepLabel}`}
          hitSlop={8}
          onPress={onOlder}
          style={[styles.arrow, { left: 8, top: height / 2 - 16 }]}
        >
          <Icon name="left" size={18} color="#FFF" />
        </Pressable>
      )}
      {onNewer && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Newer ${stepLabel}`}
          hitSlop={8}
          onPress={onNewer}
          style={[styles.arrow, { right: 8, top: height / 2 - 16 }]}
        >
          <Icon name="right" size={18} color="#FFF" />
        </Pressable>
      )}
      {zoomed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reset zoom"
          hitSlop={8}
          onPress={() => reset(z)}
          style={styles.badge}
        >
          <Text style={styles.badgeText}>1×</Text>
        </Pressable>
      ) : (
        <View pointerEvents="none" style={styles.badge}>
          <Icon name="magnify" size={16} color="#FFF" />
        </View>
      )}
    </View>
  );
}

/** A single photo with pinch zoom. */
export function ZoomableImage({
  uri,
  height,
}: {
  uri: string;
  height: number;
}) {
  const zoom = useZoom();
  return (
    <ZoomFrame zoom={zoom} height={height} style={{ borderRadius: 22 }}>
      {(width) => (
        <Image
          source={{ uri }}
          resizeMode="contain"
          accessibilityLabel="Photo. Pinch or double-tap to zoom."
          style={{ width, height }}
        />
      )}
    </ZoomFrame>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    right: 10,
    bottom: 10,
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: 14,
    backgroundColor: "rgba(15,26,23,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  arrow: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(15,26,23,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFF", fontSize: 12, fontWeight: "700" },
});
