import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { colors } from "./ui";

/** The scanner's glow: a light green that reads over skin and dark hair. */
export const SCAN = "#7CF2B6";
const SWEEP_MS = 2200;
const BRACKET = 18;

/**
 * A scan shared by every frame showing it, so beams sweep and the reticle
 * hops in step across a pair of photos. `focus` is in guide units (0 to 100,
 * unturned); move it with `look`.
 */
export type Scanner = {
  beam: SharedValue<number>;
  fx: SharedValue<number>;
  fy: SharedValue<number>;
  /** 0 hidden, 1 shown. */
  on: SharedValue<number>;
};

export function useScanner(active: boolean): Scanner & {
  look: (x: number, y: number) => void;
} {
  const reduced = useReducedMotion();
  const beam = useSharedValue(0);
  const fx = useSharedValue(50);
  const fy = useSharedValue(50);
  const on = useSharedValue(0);
  useEffect(() => {
    on.set(withTiming(active ? 1 : 0, { duration: 260 }));
    if (active && !reduced)
      beam.set(
        withRepeat(
          withSequence(
            withTiming(1, {
              duration: SWEEP_MS,
              easing: Easing.inOut(Easing.quad),
            }),
            withTiming(0, {
              duration: SWEEP_MS,
              easing: Easing.inOut(Easing.quad),
            }),
          ),
          -1,
        ),
      );
    else {
      cancelAnimation(beam);
      beam.set(0.5);
    }
  }, [active, reduced, beam, on]);
  return {
    beam,
    fx,
    fy,
    on,
    look: (x, y) => {
      fx.set(withSpring(x, { duration: 700, dampingRatio: 0.8 }));
      fy.set(withSpring(y, { duration: 700, dampingRatio: 0.8 }));
    },
  };
}

/** Guide units to the frame's pixels, turned like the guide. */
function toFrame(
  x: number,
  y: number,
  turn: number,
  size: number,
  width: number,
  height: number,
) {
  "worklet";
  const angle = (turn * Math.PI) / 2;
  const dx = (x - 50) / 100;
  const dy = (y - 50) / 100;
  return {
    x: width / 2 + (Math.cos(angle) * dx - Math.sin(angle) * dy) * size,
    y: height / 2 + (Math.sin(angle) * dx + Math.cos(angle) * dy) * size,
  };
}

/**
 * The scanner drawn over one frame: a beam sweeping the guide square, HUD
 * brackets at its corners and a reticle on the spot being looked at.
 */
export function ScanOverlay({
  scanner,
  width,
  height,
  turn,
  reticle = true,
}: {
  scanner: Scanner;
  width: number;
  height: number;
  turn: number;
  reticle?: boolean;
}) {
  const size = Math.min(width, height);
  const top = (height - size) / 2;
  const left = (width - size) / 2;
  const layer = useAnimatedStyle(() => ({ opacity: scanner.on.get() }));
  const beamStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: top + scanner.beam.get() * size - 40 }],
  }));
  const bracketStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1.12 - 0.12 * scanner.on.get() }],
  }));
  const reticleStyle = useAnimatedStyle(() => {
    const at = toFrame(
      scanner.fx.get(),
      scanner.fy.get(),
      turn,
      size,
      width,
      height,
    );
    return { transform: [{ translateX: at.x - 30 }, { translateY: at.y - 30 }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.clip, layer]}
    >
      <View style={[StyleSheet.absoluteFill, styles.tint]} />
      <Animated.View style={[styles.beam, beamStyle]}>
        <Svg width="100%" height={80}>
          <Defs>
            <LinearGradient id="scan-glow" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={SCAN} stopOpacity={0} />
              <Stop offset="0.5" stopColor={SCAN} stopOpacity={0.32} />
              <Stop offset="1" stopColor={SCAN} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height={80} fill="url(#scan-glow)" />
          <Rect y={39} width="100%" height={2} fill={SCAN} opacity={0.9} />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[
          styles.square,
          { left, top, width: size, height: size },
          bracketStyle,
        ]}
      >
        <View style={[styles.corner, styles.tl]} />
        <View style={[styles.corner, styles.tr]} />
        <View style={[styles.corner, styles.bl]} />
        <View style={[styles.corner, styles.br]} />
      </Animated.View>
      {reticle && (
        <Animated.View style={[styles.reticle, reticleStyle]}>
          <Pulse />
          <View style={[styles.tick, styles.tl]} />
          <View style={[styles.tick, styles.tr]} />
          <View style={[styles.tick, styles.bl]} />
          <View style={[styles.tick, styles.br]} />
          <View style={styles.dot} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

/** A ring that keeps breathing out of the reticle's centre. */
function Pulse() {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    t.set(withRepeat(withTiming(1, { duration: 1400 }), -1));
    return () => cancelAnimation(t);
  }, [reduced, t]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.8 * (1 - t.get()),
    transform: [{ scale: 0.3 + t.get() * 1.1 }],
  }));
  return <Animated.View style={[styles.pulse, style]} />;
}

/**
 * The AI's voice: a glowing orb and a speech bubble that types each new line
 * out. Tapping it asks for the next line.
 */
export function AiBubble({
  text,
  thinking = false,
  onPress,
}: {
  text: string;
  /** Still working: the orb spins and the dots tick. */
  thinking?: boolean;
  onPress?: () => void;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? text : "");
  const [line, setLine] = useState(text);
  if (line !== text) {
    setLine(text);
    setShown(reduced ? text : "");
  }
  useEffect(() => {
    if (shown.length >= text.length) return;
    const timer = setTimeout(
      () => setShown(text.slice(0, shown.length + 2)),
      18,
    );
    return () => clearTimeout(timer);
  }, [shown, text]);
  const pop = useSharedValue(0);
  useEffect(() => {
    pop.set(0);
    pop.set(withSpring(1, { duration: 420, dampingRatio: 0.6 }));
  }, [text, pop]);
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, pop.get() * 2),
    transform: [{ scale: 0.92 + 0.08 * pop.get() }],
  }));
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
      disabled={!onPress}
      onPress={onPress}
      style={styles.voice}
    >
      <Orb thinking={thinking} />
      <Animated.View style={[styles.bubble, bubbleStyle]}>
        <View style={styles.tail} />
        <Text style={styles.bubbleText}>
          {shown}
          {shown.length < text.length && <Text style={styles.caret}>▍</Text>}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function Orb({ thinking }: { thinking: boolean }) {
  const reduced = useReducedMotion();
  const spin = useSharedValue(0);
  const glow = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    spin.set(
      withRepeat(withTiming(1, { duration: thinking ? 1600 : 6000 }), -1),
    );
    glow.set(withRepeat(withTiming(1, { duration: 1100 }), -1, true));
    return () => {
      cancelAnimation(spin);
      cancelAnimation(glow);
    };
  }, [thinking, reduced, spin, glow]);
  const ring = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.get() * 360}deg` }],
  }));
  const halo = useAnimatedStyle(() => ({
    opacity: 0.25 + glow.get() * 0.35,
    transform: [{ scale: 1 + glow.get() * 0.25 }],
  }));
  return (
    <View style={styles.orb}>
      <Animated.View style={[styles.orbHalo, halo]} />
      <Animated.View style={[styles.orbRing, ring]} />
      <Text style={styles.orbStar}>✦</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  tint: { backgroundColor: "rgba(10,40,30,0.18)" },
  beam: { position: "absolute", left: 0, right: 0, top: 0, height: 80 },
  square: { position: "absolute" },
  corner: {
    position: "absolute",
    width: BRACKET,
    height: BRACKET,
    borderColor: SCAN,
  },
  tl: { left: 0, top: 0, borderLeftWidth: 2, borderTopWidth: 2 },
  tr: { right: 0, top: 0, borderRightWidth: 2, borderTopWidth: 2 },
  bl: { left: 0, bottom: 0, borderLeftWidth: 2, borderBottomWidth: 2 },
  br: { right: 0, bottom: 0, borderRightWidth: 2, borderBottomWidth: 2 },
  reticle: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 60,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  tick: {
    position: "absolute",
    width: 12,
    height: 12,
    borderColor: "#FFFFFF",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: SCAN,
  },
  pulse: {
    position: "absolute",
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: SCAN,
  },
  voice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: 360,
  },
  bubble: {
    flexShrink: 1,
    backgroundColor: "rgba(12,24,20,0.9)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(124,242,182,0.45)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tail: {
    position: "absolute",
    left: -6,
    top: "50%",
    marginTop: -6,
    width: 12,
    height: 12,
    backgroundColor: "rgba(12,24,20,0.9)",
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(124,242,182,0.45)",
    transform: [{ rotate: "45deg" }],
  },
  bubbleText: { color: "#FFFFFF", fontSize: 13, lineHeight: 18 },
  caret: { color: SCAN },
  orb: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  orbHalo: {
    position: "absolute",
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: SCAN,
  },
  orbRing: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    borderTopColor: "transparent",
    borderRightColor: SCAN,
    backgroundColor: colors.stage,
  },
  orbStar: { color: SCAN, fontSize: 15, fontWeight: "800" },
});

/**
 * Steps through `lines` every `everyMs` while `playing`, looping or stopping
 * at the last. Starts over whenever what the lines say, or `restart`, changes.
 */
export function useLines<T>(
  lines: T[],
  playing: boolean,
  {
    everyMs = 2600,
    loop = true,
    restart,
  }: { everyMs?: number; loop?: boolean; restart?: unknown } = {},
) {
  const [index, setIndex] = useState(0);
  // By content, so lines rebuilt on every render don't keep starting over.
  const said = JSON.stringify(lines);
  const [shown, setShown] = useState({ said, restart });
  if (shown.said !== said || shown.restart !== restart) {
    setShown({ said, restart });
    setIndex(0);
  }
  const count = lines.length;
  useEffect(() => {
    if (!playing || count < 2) return;
    const timer = setInterval(
      () =>
        setIndex((i) => (loop ? (i + 1) % count : Math.min(i + 1, count - 1))),
      everyMs,
    );
    return () => clearInterval(timer);
  }, [playing, said, count, everyMs, loop]);
  const at = Math.min(index, Math.max(0, lines.length - 1));
  return {
    line: lines[at] as T | undefined,
    index: at,
    next: () => setIndex((i) => (i + 1) % Math.max(1, lines.length)),
  };
}
