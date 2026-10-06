import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Icon, colors } from "@/components/ui";
import { useJournal } from "@/hooks/use-journal";
import type { GrayImage } from "@/lib/alignment";
import { setCapture } from "@/lib/capture-store";
import {
  FRAME_ASPECT,
  HINT_TEXT,
  LIVE_WIDTH,
  guide,
  meanOf,
  type Guidance,
} from "@/lib/ghost";
import {
  SCALP_VIEWS,
  VIEW_LABELS,
  errorMessage,
  formatDate,
  type ScalpView,
} from "@/lib/model";
import { grayCrop } from "@/lib/photos";

/** Ghost overlay strengths, cycled by the ghost button. */
const GHOST_LEVELS = [0.35, 0.6, 0];
/** Consecutive matched frames before the auto shutter fires. */
const STREAK = 2;
const MATCH = "#3DDC97";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const haptic = (run: () => Promise<void>) => void run().catch(() => {});

/** Grab a small greyscale frame from the live camera without saving a photo. */
async function grabFrame(camera: CameraView): Promise<GrayImage> {
  if (Platform.OS === "ios") {
    const ref = await camera.takePictureAsync({
      pictureRef: true,
      shutterSound: false,
    });
    try {
      return await grayCrop(
        ref,
        ref.width,
        ref.height,
        FRAME_ASPECT,
        LIVE_WIDTH,
      );
    } finally {
      ref.release();
    }
  }
  const picture = await camera.takePictureAsync({
    quality: 0.1,
    shutterSound: false,
    scale: 0.25,
  });
  try {
    return await grayCrop(
      picture.uri,
      picture.width,
      picture.height,
      FRAME_ASPECT,
      LIVE_WIDTH,
    );
  } finally {
    if (Platform.OS === "android")
      try {
        new File(picture.uri).delete();
      } catch {}
  }
}

export default function CaptureScreen() {
  const params = useLocalSearchParams<{ view?: ScalpView; from?: string }>();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const journal = useJournal();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [view, setView] = useState<ScalpView>(params.view ?? "top");
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [level, setLevel] = useState(0);
  const [auto, setAuto] = useState(true);
  const [ready, setReady] = useState(false);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const [ghostPixels, setGhostPixels] = useState<{
    id: string;
    gray: GrayImage;
  } | null>(null);

  const ghost = (journal.data?.photos ?? [])
    .filter((p) => p.view === view)
    .sort((a, b) => b.taken_at.localeCompare(a.taken_at))[0];
  const mirrored = facing === "front";
  const ghostGray =
    ghost && ghostPixels?.id === ghost.id ? ghostPixels.gray : null;

  // The capture box is 3:4, as wide as the screen allows in portrait.
  const boxHeight = Math.min(
    (Math.min(window.width, 520) - 24) / FRAME_ASPECT,
    window.height - insets.top - insets.bottom - 250,
  );
  const boxWidth = boxHeight * FRAME_ASPECT;

  // Everything the frame loop needs, without restarting it on each render.
  const live = useRef({
    ready: false,
    ghost: null as GrayImage | null,
    ghostMean: 0,
    mirrored: false,
    auto: true,
    capturing: false,
    streak: 0,
    view: view,
    from: params.from,
  });
  useEffect(() => {
    Object.assign(live.current, {
      ready,
      ghost: ghostGray,
      ghostMean: ghostGray ? meanOf(ghostGray) : 0,
      mirrored,
      auto,
      capturing,
      view,
      from: params.from,
    });
  }, [ready, ghostGray, mirrored, auto, capturing, view, params.from]);

  // Greyscale pixels of the ghost, cropped exactly like a live frame.
  useEffect(() => {
    let alive = true;
    live.current.streak = 0;
    if (ghost)
      grayCrop(ghost.uri, ghost.width, ghost.height, FRAME_ASPECT, LIVE_WIDTH)
        .then((gray) => alive && setGhostPixels({ id: ghost.id, gray }))
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ghost]);

  // Outline that tracks where the ghost's content currently sits.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const rotation = useSharedValue(0);
  const scale = useSharedValue(1);
  const visible = useSharedValue(0);
  const flash = useSharedValue(0);
  useEffect(() => {
    const confident = guidance && guidance.hint !== "no-match";
    const timing = { duration: 220 };
    visible.set(withTiming(confident ? 1 : 0, timing));
    if (!guidance || !confident) return;
    tx.set(withTiming(guidance.offset.tx * boxWidth, timing));
    ty.set(withTiming(guidance.offset.ty * boxWidth, timing));
    rotation.set(withTiming(guidance.offset.rotation, timing));
    scale.set(withTiming(guidance.offset.scale, timing));
  }, [guidance, boxWidth, tx, ty, rotation, scale, visible]);
  const outlineStyle = useAnimatedStyle(() => ({
    opacity: visible.get(),
    transform: [
      { translateX: tx.get() },
      { translateY: ty.get() },
      { rotate: `${rotation.get()}rad` },
      { scale: scale.get() },
    ],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.get() }));

  async function shoot() {
    const state = live.current;
    if (state.capturing || !camera.current) return;
    state.capturing = true;
    setCapturing(true);
    flash.set(
      withSequence(
        withTiming(0.9, { duration: 60 }),
        withTiming(0, { duration: 260 }),
      ),
    );
    haptic(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    );
    try {
      const picture = await camera.current.takePictureAsync({ quality: 1 });
      setCapture({
        uri: picture.uri,
        width: picture.width,
        height: picture.height,
        view: state.view,
      });
      if (state.from === "form" && router.canGoBack()) router.back();
      else router.replace("/add-photo");
    } catch (e) {
      setError(errorMessage(e));
      state.capturing = false;
      setCapturing(false);
    }
  }
  const shootRef = useRef(shoot);
  useEffect(() => {
    shootRef.current = shoot;
  });

  // Frame loop: grab, compare with the ghost, guide, and fire when it holds.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        while (alive) {
          const state = live.current;
          if (
            !state.ready ||
            !state.ghost ||
            state.capturing ||
            !camera.current
          ) {
            await sleep(200);
            continue;
          }
          try {
            const frame = await grabFrame(camera.current);
            if (!alive || state.ghost !== live.current.ghost) continue;
            const result = guide(state.ghost, frame, {
              mirrored: state.mirrored,
              ghostMean: state.ghostMean,
            });
            setGuidance(result);
            state.streak = result.matched ? state.streak + 1 : 0;
            if (state.streak === 1) haptic(() => Haptics.selectionAsync());
            if (state.auto && state.streak >= STREAK) void shootRef.current();
          } catch {
            await sleep(500);
          }
          await sleep(80);
        }
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  const hint = guidance?.hint;
  const matched = Boolean(guidance?.matched);
  const close = () =>
    router.canGoBack() ? router.back() : router.replace("/");

  if (!permission) return <View style={styles.screen} />;
  if (!permission.granted)
    return (
      <View style={[styles.screen, styles.center, { padding: 32, gap: 18 }]}>
        <StatusBar style="light" />
        <Icon name="camera" size={44} color="#FFF" />
        <Text style={styles.permissionText}>Camera access needed</Text>
        <Button
          label={permission.canAskAgain ? "Allow camera" : "Open settings"}
          onPress={() =>
            permission.canAskAgain
              ? void requestPermission()
              : void Linking.openSettings()
          }
        />
        <Pressable accessibilityRole="button" onPress={close} hitSlop={8}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>
    );

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: insets.bottom + 12 },
      ]}
    >
      <StatusBar style="light" />
      <View style={styles.topBar}>
        <RoundButton icon="close" label="Close camera" onPress={close} />
        <Text style={styles.ghostDate} numberOfLines={1}>
          {ghost ? `Ghost · ${formatDate(ghost.taken_at)}` : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {params.from !== "form" && (
            <RoundButton
              icon="upload"
              label="Choose from library"
              onPress={() => router.replace("/add-photo")}
            />
          )}
          <RoundButton
            icon="flip"
            label="Switch camera"
            onPress={() => {
              setReady(false);
              setGuidance(null);
              setFacing(facing === "back" ? "front" : "back");
            }}
          />
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.views}
      >
        {SCALP_VIEWS.map((value) => {
          const on = value === view;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setView(value);
                setGuidance(null);
              }}
              style={[styles.view, on && styles.viewOn]}
            >
              <Text style={[styles.viewText, on && { color: colors.stage }]}>
                {VIEW_LABELS[value]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.box, { width: boxWidth, height: boxHeight }]}>
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing={facing}
          animateShutter={false}
          onCameraReady={() => setReady(true)}
          onMountError={(e) => setError(e.message)}
        />
        {ghost && GHOST_LEVELS[level] > 0 && (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Image
              source={{ uri: ghost.uri }}
              resizeMode="cover"
              style={[
                StyleSheet.absoluteFill,
                {
                  opacity: GHOST_LEVELS[level],
                  transform: mirrored ? [{ scaleX: -1 }] : [],
                },
              ]}
            />
          </View>
        )}
        {ghost && (
          <>
            <View pointerEvents="none" style={styles.reticleWrap}>
              <View
                style={[
                  styles.reticle,
                  styles.target,
                  { width: boxWidth * 0.5, height: boxHeight * 0.5 },
                ]}
              />
            </View>
            <View pointerEvents="none" style={styles.reticleWrap}>
              <Animated.View
                style={[
                  styles.reticle,
                  {
                    width: boxWidth * 0.5,
                    height: boxHeight * 0.5,
                    borderColor: matched ? MATCH : colors.loupe,
                  },
                  outlineStyle,
                ]}
              />
            </View>
          </>
        )}
        <View pointerEvents="none" style={styles.hintWrap}>
          {(ghost ? hint : true) && (
            <View
              style={[
                styles.hint,
                hint === "hold" && { backgroundColor: MATCH },
              ]}
            >
              <Text
                style={[
                  styles.hintText,
                  hint === "hold" && { color: colors.stage },
                ]}
              >
                {!ghost
                  ? `First ${VIEW_LABELS[view].toLowerCase()} photo`
                  : hint
                    ? HINT_TEXT[hint]
                    : ""}
              </Text>
            </View>
          )}
        </View>
        {Boolean(error) && (
          <View
            style={[StyleSheet.absoluteFill, styles.center, { padding: 24 }]}
          >
            <Text style={styles.permissionText}>{error}</Text>
          </View>
        )}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "#FFF" },
            flashStyle,
          ]}
        />
      </View>

      <View style={[styles.meter, { width: boxWidth }]}>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              {
                width: `${Math.round((guidance?.match ?? 0) * 100)}%`,
                backgroundColor: matched ? MATCH : colors.loupe,
              },
            ]}
          />
        </View>
        <Text style={styles.percent}>
          {ghost ? `${Math.round((guidance?.match ?? 0) * 100)}%` : ""}
        </Text>
      </View>

      <View style={styles.controls}>
        <RoundButton
          icon="ghost"
          label={`Ghost ${Math.round(GHOST_LEVELS[level] * 100)}%`}
          active={GHOST_LEVELS[level] > 0}
          disabled={!ghost}
          onPress={() => setLevel((level + 1) % GHOST_LEVELS.length)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          disabled={capturing || !ready}
          onPress={() => void shoot()}
          style={({ pressed }) => [
            styles.shutter,
            matched && { borderColor: MATCH },
            { transform: [{ scale: pressed ? 0.94 : 1 }] },
          ]}
        >
          <View
            style={[styles.shutterInner, matched && { backgroundColor: MATCH }]}
          />
        </Pressable>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Auto capture"
          accessibilityState={{ checked: auto, disabled: !ghost }}
          aria-checked={auto}
          disabled={!ghost}
          onPress={() => setAuto(!auto)}
          style={[
            styles.auto,
            auto && ghost && styles.autoOn,
            !ghost && { opacity: 0.35 },
          ]}
        >
          <Text
            style={[styles.autoText, auto && ghost && { color: colors.stage }]}
          >
            AUTO
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  active = false,
  disabled = false,
}: {
  icon: "close" | "flip" | "ghost" | "upload";
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        active && { backgroundColor: "rgba(255,255,255,0.24)" },
        { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
      ]}
    >
      <Icon name={icon} size={22} color="#FFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#060B0A", alignItems: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  permissionText: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  cancel: { color: "rgba(255,255,255,0.75)", fontSize: 16, fontWeight: "600" },
  topBar: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  ghostDate: {
    flex: 1,
    textAlign: "center",
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "600",
  },
  views: { gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  view: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  viewOn: { backgroundColor: "#FFF" },
  viewText: { color: "#FFF", fontSize: 13, fontWeight: "600" },
  box: {
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: colors.stage,
  },
  reticleWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  reticle: { borderRadius: 24, borderWidth: 3 },
  target: {
    borderStyle: "dashed",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.75)",
  },
  hintWrap: {
    position: "absolute",
    top: 14,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  hint: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(6,11,10,0.7)",
  },
  hintText: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  meter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 3 },
  percent: {
    width: 40,
    textAlign: "right",
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  controls: {
    flex: 1,
    width: "100%",
    maxWidth: 420,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },
  round: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#FFF",
  },
  auto: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  autoOn: { backgroundColor: "#FFF" },
  autoText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});
