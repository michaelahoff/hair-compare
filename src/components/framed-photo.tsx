import { useState, type ReactNode } from "react";
import { Image, StyleSheet, View, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
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
import type { Similarity } from "@/lib/alignment";
import type { Photo } from "@/lib/model";

const MIN_SCALE = 0.3;
const MAX_SCALE = 6;
const STEP_ROTATION = Math.PI / 180;
const STEP_SCALE = 1.02;

type Box = { width: number; height: number };

/**
 * A photo placed on its view's guide, in a `width` × `height` frame. Content
 * outside the frame is not clipped here, so parents decide what shows.
 */
export function FramedPhoto({
  photo,
  turn,
  width,
  height,
  onError,
  children,
}: {
  photo: Photo;
  turn: number;
  width: number;
  height: number;
  onError?: () => void;
  /** Drawn over the photo, in its coordinates, e.g. analysis regions. */
  children?: (box: Box) => ReactNode;
}) {
  const size = Math.min(width, height);
  const base = baseBox(photo);
  const box = { width: base.width * size, height: base.height * size };
  return (
    <View
      style={{ width, height, alignItems: "center", justifyContent: "center" }}
    >
      <View
        style={{
          ...box,
          transform: framedTransform(
            framingOf(photo) ?? IDENTITY,
            turn,
            size,
          ) as ViewStyle["transform"],
        }}
      >
        <Image
          source={{ uri: photo.uri }}
          onError={onError}
          style={box}
          resizeMode="stretch"
        />
        {children?.(box)}
      </View>
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
};
export function useFramingEdit(initial?: Similarity | null): FramingEdit {
  const start = initial ?? IDENTITY;
  return {
    tx: useSharedValue(start.tx),
    ty: useSharedValue(start.ty),
    rotation: useSharedValue(start.rotation),
    scale: useSharedValue(start.scale),
    touched: useSharedValue(false),
  };
}
function write(edit: FramingEdit, f: Similarity) {
  "worklet";
  edit.tx.set(f.tx);
  edit.ty.set(f.ty);
  edit.rotation.set(f.rotation);
  edit.scale.set(Math.min(MAX_SCALE, Math.max(MIN_SCALE, f.scale)));
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
  turn,
  height,
  active = false,
  onActivate,
  overlay,
  style,
}: {
  photo: Photo;
  edit: FramingEdit;
  turn: number;
  height: number;
  /** Outlines the frame, e.g. as the target of the fine-tune buttons. */
  active?: boolean;
  onActivate?: () => void;
  overlay?: ReactNode;
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
      edit.tx.set(edit.tx.get() + Math.cos(angle) * dx - Math.sin(angle) * dy);
      edit.ty.set(edit.ty.get() + Math.sin(angle) * dx + Math.cos(angle) * dy);
      edit.touched.set(true);
    });
  const pinch = Gesture.Pinch()
    .onBegin(begin)
    .onChange((e) => aroundCentre(edit, e.scaleChange, 0));
  const twist = Gesture.Rotation()
    .onBegin(begin)
    .onChange((e) => aroundCentre(edit, 1, e.rotationChange));
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
      {width > 0 && <Guide view={photo.view} turn={turn} size={size} />}
      {overlay}
    </View>
  );
}

/** Small steps for when fingers are too coarse, or there are none (web). */
export function FineTune({ edit }: { edit: FramingEdit }) {
  return (
    <View style={styles.row}>
      <IconButton
        icon="rotateLeft"
        label="Rotate left"
        onPress={() => aroundCentre(edit, 1, -STEP_ROTATION)}
      />
      <IconButton
        icon="rotateRight"
        label="Rotate right"
        onPress={() => aroundCentre(edit, 1, STEP_ROTATION)}
      />
      <IconButton
        icon="turn"
        label="Turn photo 90°"
        onPress={() => aroundCentre(edit, 1, Math.PI / 2)}
      />
      <View style={styles.divider} />
      <IconButton
        icon="minus"
        label="Shrink"
        onPress={() => aroundCentre(edit, 1 / STEP_SCALE, 0)}
      />
      <IconButton
        icon="plus"
        label="Enlarge"
        onPress={() => aroundCentre(edit, STEP_SCALE, 0)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
