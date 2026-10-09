import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Pill } from "./ui";
import { ZoomFrame, useZoom } from "./zoom";
import { FramedPhoto } from "./framed-photo";
import { useViewGuide } from "@/hooks/use-preferences";
import type { Photo } from "@/lib/model";

/**
 * The photo as it sits on its view's guide, the way Compare shows it. While a
 * new photo is being matched it shows as taken, then snaps into place.
 */
export function LinedUpPhoto({
  photo,
  height,
  matching,
  onOriginal,
}: {
  photo: Photo;
  height: number;
  matching: boolean;
  onOriginal: () => void;
}) {
  const zoom = useZoom();
  const { turn, variant } = useViewGuide(photo.view);
  return (
    <ZoomFrame
      zoom={zoom}
      height={height}
      style={{ borderRadius: 22 }}
      overlay={
        <View style={styles.tag}>
          {matching ? (
            <View style={styles.matching}>
              <ActivityIndicator size="small" color="#FFF" />
              <Text style={styles.tagText}>Lining up…</Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show the original photo"
              hitSlop={8}
              onPress={onOriginal}
            >
              <Pill tone="dark">Lined up · Show original</Pill>
            </Pressable>
          )}
        </View>
      }
    >
      {(width) => (
        <FramedPhoto
          photo={photo}
          turn={turn}
          variant={variant}
          width={width}
          height={height}
          unframed="contain"
        />
      )}
    </ZoomFrame>
  );
}

const styles = StyleSheet.create({
  tag: { position: "absolute", top: 10, left: 10 },
  matching: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(15,26,23,0.72)",
  },
  tagText: { color: "#FFF", fontSize: 12, fontWeight: "700" },
});
