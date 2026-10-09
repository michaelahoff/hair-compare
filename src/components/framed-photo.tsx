import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { IconButton, colors } from "./ui";
import { Guide } from "./guide";
import {
  IDENTITY,
  baseBox,
  compose,
  framedTransform,
  framingOf,
} from "@/lib/framing";
import { useLineUpState } from "@/hooks/use-auto-line-up";
import type { Similarity } from "@/lib/alignment";
import type { GuideStyle } from "@/lib/guide-art";
import type { Photo } from "@/lib/model";

const MIN_SCALE = 0.3;
const MAX_SCALE = 6;
const STEP_ROTATION = Math.PI / 180;
const STEP_SCALE = 1.02;

type Box = { width: number; height: number };

/** How a photo lands on the guide: quick, with a slight settle. */
export const SNAP = { duration: 480, dampingRatio: 0.72 } as const;

/** A short tap as a photo snaps into place; nothing where unsupported. */
export function snapFeedback() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    () => {},
  );
}

/**
 * Where a photo is drawn, in guide units on screen axes (the view's turn
 * already applied), so the frame's size only matters when drawing.
 */
type Placement = { x: number; y: number; angle: number; scale: number };

/**
 * How a photo with no framing is drawn: on the guide like a framed one
 * ("guide"), or upright and whole ("contain") or filling the frame ("cover"),
 * as a plain photo would be.
 */
export type Unframed = "guide" | "contain" | "cover";

function placementOf(
  framing: Similarity | null,
  turn: number,
  unframed: Unframed,
  frame: Box,
  base: Box,
): Placement {
  const angle = (turn * Math.PI) / 2;
  if (framing) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return {
      x: c * framing.tx - s * framing.ty,
      y: s * framing.tx + c * framing.ty,
      angle: framing.rotation + angle,
      scale: framing.scale,
    };
  }
  if (unframed === "guide") return { x: 0, y: 0, angle, scale: 1 };
  const size = Math.min(frame.width, frame.height);
  const scale =
    unframed === "cover"
      ? Math.max(
          frame.width / (base.width * size),
          frame.height / (base.height * size),
        )
      : 1;
  return { x: 0, y: 0, angle: 0, scale };
}

/**
 * A placement on the UI thread that springs to each new placement of the
 * same photo, and jumps when the photo itself changes.
 */
function useSnappedPlacement(id: string, target: Placement) {
  const x = useSharedValue(target.x);
  const y = useSharedValue(target.y);
  const angle = useSharedValue(target.angle);
  const scale = useSharedValue(target.scale);
  const shown = useRef({ id, ...target });
  const { x: toX, y: toY, angle: toAngle, scale: toScale } = target;
  useEffect(() => {
    const from = shown.current;
    shown.current = { id, x: toX, y: toY, angle: toAngle, scale: toScale };
    if (
      from.x === toX &&
      from.y === toY &&
      from.angle === toAngle &&
      from.scale === toScale
    )
      return;
    const snap = from.id === id;
    const move = (value: SharedValue<number>, to: number) =>
      value.set(snap ? withSpring(to, SNAP) : to);
    move(x, toX);
    move(y, toY);
    move(scale, toScale);
    // Turn the short way round rather than unwinding whole turns.
    const turns = Math.round((angle.get() - toAngle) / (2 * Math.PI));
    move(angle, snap ? toAngle + turns * 2 * Math.PI : toAngle);
  }, [id, toX, toY, toAngle, toScale, x, y, angle, scale]);
  return { x, y, angle, scale };
}

/**
 * A photo placed on its view's guide, in a `width` × `height` frame. Content
 * outside the frame is not clipped here, so parents decide what shows. When
 * the photo's framing changes, it snaps to the new one.
 */
export function FramedPhoto({
  photo,
  turn,
  width,
  height,
  unframed = "guide",
  onError,
  children,
}: {
  photo: Photo;
  turn: number;
  width: number;
  height: number;
  unframed?: Unframed;
  onError?: () => void;
  /** Drawn over the photo, in its coordinates, e.g. analysis regions. */
  children?: (box: Box) => ReactNode;
}) {
  const size = Math.min(width, height);
  const base = baseBox(photo);
  const box = { width: base.width * size, height: base.height * size };
  const placement = useSnappedPlacement(
    photo.id,
    placementOf(framingOf(photo), turn, unframed, { width, height }, base),
  );
  const placed = useAnimatedStyle(() => ({
    transform: [
      { translateX: placement.x.get() * size },
      { translateY: placement.y.get() * size },
      { rotate: `${placement.angle.get()}rad` },
      { scale: placement.scale.get() },
    ],
  }));
  return (
    <View
      style={{ width, height, alignItems: "center", justifyContent: "center" }}
    >
      <Animated.View style={[box, placed]}>
        <Image
          source={{ uri: photo.uri }}
          onError={onError}
          style={box}
          resizeMode="stretch"
        />
        {children?.(box)}
      </Animated.View>
    </View>
  );
}

/**
 * A small photo as it sits on the guide once lined up; until then, the plain
 * photo filling the tile, with a spinner while it is being matched.
 */
export function FramedThumb({
  photo,
  turn,
  width,
  height,
  style,
}: {
  photo: Photo;
  turn: number;
  width: number;
  height: number;
  style?: StyleProp<ViewStyle>;
}) {
  const lineUp = useLineUpState(photo.id);
  return (
    <View style={[styles.thumb, { width, height }, style]}>
      <FramedPhoto
        photo={photo}
        turn={turn}
        width={width}
        height={height}
        unframed="cover"
      />
      {(lineUp === "queued" || lineUp === "matching") && (
        <View style={styles.pending}>
          <ActivityIndicator size="small" color="#FFF" />
        </View>
      )}
    </View>
  );
}

/** A framing being edited, live on the UI thread. */
export type FramingEdit = {
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  rotation: SharedValue<number>;
  scale: SharedValue<number>;
  /** Changed since it was loaded. */
  touched: SharedValue<boolean>;
  /** Where a snap is heading, until the photo is moved by hand. */
  goal: SharedValue<Similarity | null>;
};
export function useFramingEdit(initial?: Similarity | null): FramingEdit {
  const start = initial ?? IDENTITY;
  return {
    tx: useSharedValue(start.tx),
    ty: useSharedValue(start.ty),
    rotation: useSharedValue(start.rotation),
    scale: useSharedValue(start.scale),
    touched: useSharedValue(false),
    goal: useSharedValue<Similarity | null>(null),
  };
}
function write(edit: FramingEdit, f: Similarity) {
  "worklet";
  edit.tx.set(f.tx);
  edit.ty.set(f.ty);
  edit.rotation.set(f.rotation);
  edit.scale.set(Math.min(MAX_SCALE, Math.max(MIN_SCALE, f.scale)));
  edit.goal.set(null);
}
export function readFraming(edit: FramingEdit): Similarity {
  "worklet";
  return {
    tx: edit.tx.get(),
    ty: edit.ty.get(),
    rotation: edit.rotation.get(),
    scale: edit.scale.get(),
  };
}
/** The framing to save: where a snap is heading, or else where the photo is. */
export function settledFraming(edit: FramingEdit): Similarity {
  return edit.goal.get() ?? readFraming(edit);
}
/** Start editing from `framing`, or from the unframed placement. */
export function loadFraming(edit: FramingEdit, framing: Similarity | null) {
  write(edit, framing ?? IDENTITY);
  edit.touched.set(false);
}
/** Replace the framing as an edit. */
export function setFraming(edit: FramingEdit, framing: Similarity) {
  write(edit, framing);
  edit.touched.set(true);
}
/** Replace the framing as an edit, springing the photo onto it. */
export function snapFraming(edit: FramingEdit, framing: Similarity) {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, framing.scale));
  // Turn the short way round rather than unwinding whole turns.
  const turns = Math.round(
    (edit.rotation.get() - framing.rotation) / (2 * Math.PI),
  );
  edit.tx.set(withSpring(framing.tx, SNAP));
  edit.ty.set(withSpring(framing.ty, SNAP));
  edit.rotation.set(withSpring(framing.rotation + turns * 2 * Math.PI, SNAP));
  edit.scale.set(withSpring(scale, SNAP));
  edit.goal.set({ ...framing, scale });
  edit.touched.set(true);
}
/** Scale and turn about the centre of the guide. */
function aroundCentre(edit: FramingEdit, scale: number, rotation: number) {
  "worklet";
  const current = readFraming(edit);
  const k =
    Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * scale)) /
    current.scale;
  write(edit, compose({ tx: 0, ty: 0, rotation, scale: k }, current));
  edit.touched.set(true);
}

/**
 * A photo to drag, pinch and twist onto its view's guide. Pinch and twist
 * pivot on the centre of the guide.
 */
export function FramingEditor({
  photo,
  edit,
  linked,
  turn,
  height,
  guide = "head",
  active = false,
  onActivate,
  overlay,
  style,
}: {
  photo: Photo;
  edit: FramingEdit;
  /** Another photo's edit that every gesture moves too, keeping the two lined up. */
  linked?: FramingEdit;
  turn: number;
  height: number;
  guide?: GuideStyle;
  /** Outlines the frame, e.g. as the target of the fine-tune buttons. */
  active?: boolean;
  onActivate?: () => void;
  /** Drawn over the photo and guide; a function is given the frame's width. */
  overlay?: ReactNode | ((width: number) => ReactNode);
  style?: ViewStyle;
}) {
  const [width, setWidth] = useState(0);
  const size = Math.min(width, height);
  const base = baseBox(photo);
  const angle = (-turn * Math.PI) / 2;
  const activate = () => onActivate?.();
  const begin = () => {
    "worklet";
    scheduleOnRN(activate);
  };
  // Track the finger from the first pixel, so the photo never lags it.
  const pan = Gesture.Pan()
    .minDistance(0)
    .maxPointers(2)
    .onBegin(begin)
    .onChange((e) => {
      // Screen movement, back in the guide's unturned units.
      const dx = e.changeX / size;
      const dy = e.changeY / size;
      for (const each of linked ? [edit, linked] : [edit]) {
        each.tx.set(each.tx.get() + Math.cos(angle) * dx - Math.sin(angle) * dy);
        each.ty.set(each.ty.get() + Math.sin(angle) * dx + Math.cos(angle) * dy);
        each.goal.set(null);
        each.touched.set(true);
      }
    });
  const pinch = Gesture.Pinch()
    .onBegin(begin)
    .onChange((e) => {
      aroundCentre(edit, e.scaleChange, 0);
      if (linked) aroundCentre(linked, e.scaleChange, 0);
    });
  const twist = Gesture.Rotation()
    .onBegin(begin)
    .onChange((e) => {
      aroundCentre(edit, 1, e.rotationChange);
      if (linked) aroundCentre(linked, 1, e.rotationChange);
    });
  const placed = useAnimatedStyle(() => ({
    transform: framedTransform(
      readFraming(edit),
      turn,
      size,
    ) as ViewStyle["transform"],
  }));
  const box = { width: base.width * size, height: base.height * size };
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[
        styles.frame,
        { height },
        active && { borderColor: colors.loupe },
        style,
      ]}
    >
      <GestureDetector gesture={Gesture.Simultaneous(pan, pinch, twist)}>
        <View style={[StyleSheet.absoluteFill, styles.centre]}>
          {width > 0 && (
            <Animated.View style={[box, placed]}>
              <Image
                source={{ uri: photo.uri }}
                accessibilityLabel="Photo. Drag, pinch and twist to fit the guide."
                style={box}
                resizeMode="stretch"
              />
            </Animated.View>
          )}
        </View>
      </GestureDetector>
      {width > 0 && (
        <Guide view={photo.view} turn={turn} size={size} style={guide} />
      )}
      {typeof overlay === "function" ? width > 0 && overlay(width) : overlay}
    </View>
  );
}

/** Small steps for when fingers are too coarse, or there are none (web). */
export function FineTune({
  edit,
  linked,
}: {
  edit: FramingEdit;
  /** Moved by the same steps, as in `FramingEditor`. */
  linked?: FramingEdit;
}) {
  const step = (scale: number, rotation: number) => {
    aroundCentre(edit, scale, rotation);
    if (linked) aroundCentre(linked, scale, rotation);
  };
  return (
    <View style={styles.row}>
      <IconButton
        icon="rotateLeft"
        label="Rotate left"
        onPress={() => step(1, -STEP_ROTATION)}
      />
      <IconButton
        icon="rotateRight"
        label="Rotate right"
        onPress={() => step(1, STEP_ROTATION)}
      />
      <IconButton
        icon="turn"
        label="Turn photo 90°"
        onPress={() => step(1, Math.PI / 2)}
      />
      <View style={styles.divider} />
      <IconButton
        icon="minus"
        label="Shrink"
        onPress={() => step(1 / STEP_SCALE, 0)}
      />
      <IconButton
        icon="plus"
        label="Enlarge"
        onPress={() => step(STEP_SCALE, 0)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.stage,
  },
  pending: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,26,23,0.55)",
  },
  frame: {
    overflow: "hidden",
    backgroundColor: colors.stage,
    borderWidth: 2,
    borderColor: "transparent",
  },
  centre: { alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: colors.line,
    marginHorizontal: 8,
  },
});
