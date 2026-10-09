import type { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ColorValue,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import type { ScalpView } from "@/lib/model";

export const colors = {
  bg: "#EEF2F1",
  surface: "#FFFFFF",
  subtle: "#F3F6F5",
  ink: "#12201D",
  muted: "#66756F",
  line: "#DDE5E2",
  accent: "#1F6F5E",
  accentSoft: "#DDEEE8",
  stage: "#0F1A17",
  loupe: "#F2B544",
  danger: "#B03A48",
  dangerSoft: "#FBEDEF",
};
/** The tab bar as the navigator styles it; prototypes restore it. */
export const TAB_BAR_STYLE = {
  backgroundColor: colors.surface,
  borderTopWidth: 0,
  shadowColor: colors.stage,
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: -4 },
  elevation: 12,
} as const;
export type IconName =
  | "photos"
  | "compare"
  | "treatments"
  | "account"
  | "plus"
  | "minus"
  | "chevron"
  | "camera"
  | "upload"
  | "close"
  | "magnify"
  | "align"
  | "grid"
  | "eye"
  | "move"
  | "trash"
  | "left"
  | "right"
  | "up"
  | "down"
  | "rotateLeft"
  | "rotateRight"
  | "check"
  | "calendar"
  | "flip"
  | "turn"
  | "ghost";
const paths: Record<IconName, string> = {
  photos: "M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4 M15 8h.01",
  compare: "M4 3h16v8H4z M4 13h16v8H4z",
  treatments: "M8 3h8v4H8z M6 7h12v14H6z M9 14h6 M12 11v6",
  account: "M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M4 21v-2a8 8 0 0 1 16 0v2",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  chevron: "M9 6l6 6-6 6",
  camera: "M3 7h4l2-3h6l2 3h4v13H3z M8 13a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
  upload: "M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6",
  close: "M6 6l12 12 M18 6L6 18",
  magnify: "M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M15 15l6 6 M7 10h6 M10 7v6",
  align: "M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 12h8 M12 8v8",
  grid: "M3 3h18v18H3z M9 3v18 M15 3v18 M3 9h18 M3 15h18",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  move: "M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
  left: "M19 12H5 M11 6l-6 6 6 6",
  right: "M5 12h14 M13 6l6 6-6 6",
  up: "M12 19V5 M6 11l6-6 6 6",
  down: "M12 5v14 M6 13l6 6 6-6",
  rotateLeft: "M4 4v6h6 M5 15a8 8 0 1 0 2-8.5L4 10",
  rotateRight: "M20 4v6h-6 M19 15a8 8 0 1 1-2-8.5L20 10",
  check: "M5 12l4 4L19 6",
  calendar: "M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4",
  flip: "M20 8h-9a5 5 0 0 0 0 10h1 M17 5l3 3-3 3 M4 16h9a5 5 0 0 0 0-10h-1 M7 19l-3-3 3-3",
  turn: "M4 11h9v10H4z M9 7a8 8 0 0 1 11 4 M20 5v6h-6",
  ghost:
    "M6 20V10a6 6 0 0 1 12 0v10l-2-2-2 2-2-2-2 2-2-2z M10 10.5h.01 M14 10.5h.01",
};
export function Icon({
  name,
  size = 20,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: ColorValue;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={paths[name]}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
/** Top-down head with the photographed area highlighted. */
export function ViewGlyph({
  view,
  size = 40,
  active = false,
}: {
  view: ScalpView;
  size?: number;
  active?: boolean;
}) {
  const stroke = active ? colors.accent : colors.muted;
  const fill = active ? colors.accent : "#B7C4BF";
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <Path d="M17 6.5l3-3 3 3" stroke={stroke} strokeWidth={1.5} />
      <Ellipse
        cx={20}
        cy={21}
        rx={12.5}
        ry={14.5}
        stroke={stroke}
        strokeWidth={1.5}
      />
      <Path
        d="M7.5 18c-2 1-2 5 0 6 M32.5 18c2 1 2 5 0 6"
        stroke={stroke}
        strokeWidth={1.5}
      />
      {view === "top" && <Circle cx={20} cy={18} r={6} fill={fill} />}
      {view === "crown" && <Circle cx={20} cy={27} r={6} fill={fill} />}
      {view === "hairline" && (
        <Path
          d="M11 14Q20 6 29 14"
          stroke={fill}
          strokeWidth={4}
          strokeLinecap="round"
        />
      )}
      {view === "left_temple" && (
        <Ellipse cx={12} cy={15} rx={3.5} ry={5} fill={fill} />
      )}
      {view === "right_temple" && (
        <Ellipse cx={28} cy={15} rx={3.5} ry={5} fill={fill} />
      )}
    </Svg>
  );
}
export function Button({
  label,
  onPress,
  icon,
  variant = "primary",
  disabled = false,
  busy = false,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const foreground =
    variant === "primary"
      ? "#FFF"
      : variant === "danger"
        ? colors.danger
        : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor:
            variant === "primary"
              ? colors.accent
              : variant === "secondary"
                ? colors.surface
                : variant === "danger"
                  ? colors.dangerSoft
                  : "transparent",
          borderWidth: variant === "secondary" ? 1 : 0,
          borderColor: colors.line,
          opacity: disabled || busy ? 0.45 : pressed ? 0.75 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : icon ? (
        <Icon name={icon} color={foreground} size={19} />
      ) : null}
      <Text style={[s.buttonText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}
export function IconButton({
  icon,
  label,
  onPress,
  active = false,
  disabled = false,
  busy = false,
  color = colors.ink,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled || busy}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        s.iconButton,
        active && { backgroundColor: colors.accentSoft },
        { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Icon name={icon} color={active ? colors.accent : color} />
      )}
    </Pressable>
  );
}
/** Floating action button, pinned above the tab bar. */
export function Fab({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        s.fab,
        { transform: [{ scale: pressed ? 0.94 : 1 }] },
      ]}
    >
      <Icon name={icon} size={26} color="#FFF" />
    </Pressable>
  );
}
export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[s.card, style]}>{children}</View>;
}
export function Pill({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "accent" | "dark" }>) {
  return (
    <View
      style={[
        s.pill,
        tone === "accent" && { backgroundColor: colors.accentSoft },
        tone === "dark" && { backgroundColor: "rgba(15,26,23,0.72)" },
      ]}
    >
      <Text
        style={[
          s.pillText,
          tone === "accent" && { color: colors.accent },
          tone === "dark" && { color: "#FFF" },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#9AA8A2"
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 84, textAlignVertical: "top" },
          props.style,
        ]}
      />
    </View>
  );
}
export function Chips<T extends string>({
  values,
  selected,
  onChange,
}: {
  values: readonly { value: T; label: string }[];
  selected: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -16 }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
    >
      {values.map(({ value, label }) => {
        const on = selected === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(value)}
            style={[s.chip, on && { backgroundColor: colors.ink }]}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: on ? "#FFF" : colors.ink,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
export function Segmented<T extends string>({
  values,
  selected,
  onChange,
}: {
  values: readonly { value: T; label: string }[];
  selected: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <View style={s.segmented}>
      {values.map(({ value, label }) => {
        const on = selected === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(value)}
            style={[s.segment, on && s.segmentOn]}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: on ? colors.ink : colors.muted,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
export function Notice({
  children,
  error = false,
}: PropsWithChildren<{ error?: boolean }>) {
  return (
    <View
      accessibilityRole={error ? "alert" : undefined}
      style={[s.notice, error && { backgroundColor: colors.dangerSoft }]}
    >
      <Text
        style={{
          color: error ? colors.danger : colors.ink,
          fontSize: 14,
          lineHeight: 20,
        }}
      >
        {children}
      </Text>
    </View>
  );
}
/** Scrollable page body. Titles come from the navigator header. */
export function Screen({
  children,
  fab,
}: PropsWithChildren<{ fab?: ReactNode }>) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: fab ? 112 : 40,
          flexGrow: 1,
        }}
      >
        <View
          style={{ width: "100%", maxWidth: 560, alignSelf: "center", gap: 16 }}
        >
          {children}
        </View>
      </ScrollView>
      {fab}
    </View>
  );
}
export function SectionTitle({
  children,
  detail,
}: PropsWithChildren<{ detail?: string }>) {
  return (
    <View style={[s.row, { marginTop: 4 }]}>
      <Text style={s.sectionTitle}>{children}</Text>
      {detail && <Text style={s.muted}>{detail}</Text>}
    </View>
  );
}
export function Empty({
  icon,
  title,
  action,
}: {
  icon: IconName;
  title: string;
  action?: ReactNode;
}) {
  return (
    <View
      style={{
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        paddingVertical: 72,
      }}
    >
      <View style={s.emptyIcon}>
        <Icon name={icon} size={32} color={colors.accent} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: "600", color: colors.ink }}>
        {title}
      </Text>
      {action}
    </View>
  );
}
export function HeaderButtons({ children }: PropsWithChildren) {
  return (
    <View style={{ flexDirection: "row", gap: 4, marginHorizontal: 8 }}>
      {children}
    </View>
  );
}
const shadow = {
  shadowColor: "#0F1A17",
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;
export const s = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22, color: colors.ink },
  muted: { fontSize: 14, lineHeight: 20, color: colors.muted },
  label: { fontSize: 13, fontWeight: "600", color: colors.muted },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: colors.ink,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 16,
    gap: 14,
    ...shadow,
  },
  stage: {
    backgroundColor: colors.stage,
    borderRadius: 22,
    overflow: "hidden",
  },
  button: {
    minHeight: 50,
    paddingHorizontal: 18,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.subtle,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
    fontVariant: ["tabular-nums"],
  },
  input: {
    minHeight: 48,
    backgroundColor: colors.subtle,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.ink,
    fontSize: 16,
  },
  chip: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: colors.surface,
    justifyContent: "center",
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.subtle,
    borderRadius: 12,
    padding: 3,
  },
  segment: {
    flex: 1,
    height: 36,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentOn: { backgroundColor: colors.surface, ...shadow },
  notice: { padding: 12, borderRadius: 14, backgroundColor: colors.surface },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
});
