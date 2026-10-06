import { Pressable, Text, View } from "react-native";
import { ViewGlyph, colors } from "./ui";
import { SCALP_VIEWS, VIEW_LABELS, type ScalpView } from "@/lib/model";

/** One button per scalp view, each showing the photographed area. */
export function ViewPicker({
  value,
  onChange,
  compact = false,
  disabled = false,
}: {
  value: ScalpView | null;
  onChange: (view: ScalpView) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {SCALP_VIEWS.map((view) => {
        const on = value === view;
        return (
          <Pressable
            key={view}
            accessibilityRole="button"
            accessibilityLabel={VIEW_LABELS[view]}
            accessibilityState={{ selected: on, disabled }}
            disabled={disabled}
            onPress={() => onChange(view)}
            style={{
              flex: 1,
              alignItems: "center",
              gap: compact ? 2 : 4,
              paddingVertical: compact ? 6 : 10,
              borderRadius: compact ? 12 : 16,
              backgroundColor: on
                ? colors.accentSoft
                : compact
                  ? colors.subtle
                  : colors.surface,
              borderWidth: 2,
              borderColor: on ? colors.accent : "transparent",
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <ViewGlyph view={view} size={compact ? 24 : 34} active={on} />
            <Text
              numberOfLines={1}
              style={{
                fontSize: compact ? 10 : 11,
                fontWeight: "600",
                color: on ? colors.accent : colors.muted,
              }}
            >
              {VIEW_LABELS[view].replace(" temple", "")}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
