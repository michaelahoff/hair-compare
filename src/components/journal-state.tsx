import { ActivityIndicator, View } from "react-native";
import { Button, Notice, colors } from "./ui";
import { errorMessage } from "@/lib/model";

export function JournalState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  if (loading)
    return (
      <ActivityIndicator
        style={{ paddingVertical: 48 }}
        color={colors.accent}
        accessibilityLabel="Loading"
      />
    );
  if (error)
    return (
      <View style={{ gap: 10 }}>
        <Notice error>{errorMessage(error)}</Notice>
        <Button label="Retry" variant="secondary" onPress={retry} />
      </View>
    );
  return null;
}
