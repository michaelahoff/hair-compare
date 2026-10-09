import { Text, View } from "react-native";
import { Button, s } from "./ui";
import { DEV_ANALYSIS_URL } from "@/lib/dev-analysis";

/** Whether Claude can match photos: development builds with the analysis server set. */
export const AI_MATCH = Boolean(DEV_ANALYSIS_URL);

/**
 * The ways on when matching the photo details missed or looks wrong: ask
 * Claude to find the same spots in both photos, or line it up by hand.
 */
export function MatchChoices({
  busy,
  onAi,
  onHand,
}: {
  busy?: boolean;
  onAi: () => void;
  onHand: () => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={s.wrap}>
        {AI_MATCH && (
          <Button
            label="AI match"
            icon="eye"
            busy={busy}
            style={{ flex: 1 }}
            onPress={onAi}
          />
        )}
        <Button
          label="By hand"
          icon="move"
          variant="secondary"
          disabled={busy}
          style={{ flex: 1 }}
          onPress={onHand}
        />
      </View>
      {AI_MATCH && (
        <Text style={[s.muted, { fontSize: 12, lineHeight: 16 }]}>
          AI match sends both photos to the developer analysis server at{" "}
          {DEV_ANALYSIS_URL}.
        </Text>
      )}
    </View>
  );
}
