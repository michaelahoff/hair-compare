import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, colors, s } from "./ui";

const EXPLANATION =
  "This compares hair texture between the two photos after lining them up. Green means more texture in the later photo, amber means less. It reacts to haircuts, wet hair, lighting and how well the photos are lined up, so treat it as a pointer to look closer, not a measurement.";

/** What the texture change map does and does not show, in a bottom sheet. */
export function ChangeExplainer({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityLabel="Close explanation"
        style={styles.backdrop}
        onPress={onClose}
      />
      <View
        pointerEvents="box-none"
        style={[styles.anchor, { paddingBottom: insets.bottom + 12 }]}
      >
        <View style={styles.sheet}>
          <Text style={s.sectionTitle}>What this is</Text>
          <Text style={s.body}>{EXPLANATION}</Text>
          <Button label="Close" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(15,26,23,0.45)",
  },
  anchor: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 12,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: 28,
    padding: 20,
    gap: 16,
    shadowColor: colors.stage,
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
});
