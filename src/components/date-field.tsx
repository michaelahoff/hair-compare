import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CalendarSheet } from "./calendar-sheet";
import { IconButton, colors, s } from "./ui";
import { formatDate } from "@/lib/model";

/** A text-field-shaped date input that opens the in-app calendar. */
export function DateField({
  label,
  value,
  onChange,
  placeholder,
  minimumDate,
  maximumDate,
  note,
  warn = false,
  disabled = false,
}: {
  label: string;
  /** Calendar day as YYYY-MM-DD, or null when empty. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Shown when empty; also makes the field clearable. */
  placeholder?: string;
  minimumDate?: string;
  maximumDate?: string;
  /** A line under the field, e.g. where a prefilled date came from. */
  note?: string;
  /** Draw attention to the note: the date needs checking. */
  warn?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.input, s.row, { paddingVertical: 0, paddingRight: 2 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value ? formatDate(value) : (placeholder ?? "not set")}`}
          accessibilityHint={note}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => setOpen(true)}
          style={{ flex: 1, minHeight: 48, justifyContent: "center" }}
        >
          <Text
            style={{ fontSize: 16, color: value ? colors.ink : colors.muted }}
          >
            {value ? formatDate(value) : placeholder}
          </Text>
        </Pressable>
        {placeholder && value && !disabled && (
          <IconButton
            icon="close"
            label={`Clear ${label}`}
            color={colors.muted}
            onPress={() => onChange(null)}
          />
        )}
      </View>
      {note && (
        <Text
          style={[
            s.label,
            { fontWeight: "500", color: warn ? colors.danger : colors.muted },
          ]}
        >
          {note}
        </Text>
      )}
      {open && (
        <CalendarSheet
          value={value}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onClose={() => setOpen(false)}
          onSelect={(day) => {
            onChange(day);
            setOpen(false);
          }}
        />
      )}
    </View>
  );
}
