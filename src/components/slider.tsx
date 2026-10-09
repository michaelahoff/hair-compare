import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { colors, s } from "./ui";

const TOUCH = 44;
const THUMB = 24;
const TRACK = 4;
// Adjustment for VoiceOver and TalkBack's increment and decrement actions.
const NUDGE = 0.1;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * A horizontal slider for a 0–1 value. Drags and taps snap to `step`. Runs its
 * handlers on the JS thread so they can set state.
 */
export function Slider({
  value,
  onChange,
  label,
  step = 0.05,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  step?: number;
}) {
  const [width, setWidth] = useState(0);
  // The thumb's centre runs from THUMB / 2 to width - THUMB / 2.
  const span = Math.max(0, width - THUMB);
  const snap = (next: number) =>
    clamp(Number((Math.round(clamp(next) / step) * step).toFixed(4)));
  const set = (x: number) => {
    if (!span) return;
    const next = snap((x - THUMB / 2) / span);
    if (next !== value) onChange(next);
  };
  // Only sideways drags slide; a vertical one still scrolls the screen, and
  // a tap jumps straight to the spot.
  const pan = Gesture.Pan()
    .activeOffsetX([-4, 4])
    .failOffsetY([-10, 10])
    .runOnJS(true)
    .onStart((e) => set(e.x))
    .onUpdate((e) => set(e.x));
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e, success) => {
      if (success) set(e.x);
    });
  const percent = Math.round(value * 100);

  return (
    <View style={{ gap: 6 }}>
      <View style={s.row}>
        <Text style={s.label}>{label}</Text>
        <Text style={[s.muted, s.mono]}>{percent}%</Text>
      </View>
      <GestureDetector gesture={Gesture.Race(pan, tap)}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "increment")
              onChange(snap(value + NUDGE));
            else if (nativeEvent.actionName === "decrement")
              onChange(snap(value - NUDGE));
          }}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={styles.touch}
        >
          <View style={styles.track} />
          <View style={[styles.fill, { width: value * span }]} />
          <View style={[styles.thumb, { left: value * span }]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  touch: { height: TOUCH, justifyContent: "center" },
  track: {
    position: "absolute",
    left: THUMB / 2,
    right: THUMB / 2,
    top: (TOUCH - TRACK) / 2,
    height: TRACK,
    borderRadius: TRACK / 2,
    backgroundColor: colors.line,
  },
  fill: {
    position: "absolute",
    left: THUMB / 2,
    top: (TOUCH - TRACK) / 2,
    height: TRACK,
    borderRadius: TRACK / 2,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: "absolute",
    top: (TOUCH - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.accent,
    shadowColor: colors.stage,
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
});
