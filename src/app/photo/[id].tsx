import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  Empty,
  HeaderButtons,
  IconButton,
  Notice,
  Pill,
  Screen,
  colors,
  s,
} from "@/components/ui";
import { ZoomableImage } from "@/components/zoom";
import { snapFeedback } from "@/components/framed-photo";
import { LinedUpPhoto } from "@/components/lined-up-photo";
import { JournalState } from "@/components/journal-state";
import { AnalysisCard } from "@/components/analysis-card";
import {
  useAccount,
  useJournal,
  useJournalMutation,
} from "@/hooks/use-journal";
import { useComparison } from "@/hooks/use-comparison";
import { isLiningUp, useLineUpState } from "@/hooks/use-auto-line-up";
import { analyzePhoto, deletePhoto } from "@/lib/repository";
import { DEV_ANALYSIS_URL } from "@/lib/dev-analysis";
import { framingOf } from "@/lib/framing";
import {
  HAIR_LENGTHS,
  VIEW_LABELS,
  errorMessage,
  formatDate,
} from "@/lib/model";

export default function PhotoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const journal = useJournal();
  const { owner } = useAccount();
  const { width, height } = useWindowDimensions();
  const photo = journal.data?.photos.find((p) => p.id === id);
  const assessment = journal.data?.analyses
    .filter((a) => a.photo_id === id)
    .at(-1);
  const comparison = useComparison(journal.data?.photos ?? []);
  const remove = useJournalMutation(deletePhoto);
  const analyze = useJournalMutation(analyzePhoto);
  const [confirm, setConfirm] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [original, setOriginal] = useState(false);
  const lineUp = useLineUpState(id);
  const matching = isLiningUp(lineUp);
  // A tap as the photo lands, when that happens while it's on screen.
  const wasMatching = useRef(matching);
  useEffect(() => {
    if (wasMatching.current && lineUp === "lined") snapFeedback();
    wasMatching.current = matching;
  }, [lineUp, matching]);
  async function destroy() {
    if (!photo) return;
    setError("");
    try {
      await remove.mutateAsync(photo);
      router.replace("/");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function assess() {
    setError("");
    try {
      await analyze.mutateAsync({ photoId: id });
      setConsent(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const length = HAIR_LENGTHS.find((l) => l === photo?.hair_length);
  return (
    <Screen>
      <Stack.Screen
        options={{
          title: photo ? formatDate(photo.taken_at) : "",
          headerRight: () =>
            photo && (
              <HeaderButtons>
                <IconButton
                  icon="trash"
                  label="Delete photo"
                  color={colors.danger}
                  onPress={() => setConfirm(true)}
                />
              </HeaderButtons>
            ),
        }}
      />
      <JournalState
        loading={journal.isPending}
        error={journal.error}
        retry={() => void journal.refetch()}
      />
      {!photo && !journal.isPending && !journal.error && (
        <Empty icon="photos" title="Photo not found" />
      )}
      {photo && (
        <>
          {(framingOf(photo) || matching) && !original ? (
            <LinedUpPhoto
              photo={photo}
              matching={matching && !framingOf(photo)}
              height={Math.round(
                Math.min(Math.min(width, 560) - 32, height * 0.62),
              )}
              onOriginal={() => setOriginal(true)}
            />
          ) : (
            <View>
              <ZoomableImage
                uri={photo.uri}
                height={Math.round(
                  Math.min(
                    ((Math.min(width, 560) - 32) * photo.height) / photo.width,
                    height * 0.62,
                  ),
                )}
              />
              {framingOf(photo) && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Show the photo lined up"
                  hitSlop={8}
                  onPress={() => setOriginal(false)}
                  style={styles.tag}
                >
                  <Pill tone="dark">Original · Show lined up</Pill>
                </Pressable>
              )}
            </View>
          )}
          {lineUp === "missed" && !framingOf(photo) && (
            <Notice>
              Couldn&apos;t line this photo up automatically. Use Line up to
              place it on the guide.
            </Notice>
          )}
          {confirm && (
            <Card style={{ backgroundColor: colors.dangerSoft }}>
              <Text style={[s.body, { fontWeight: "600" }]}>
                Delete this photo?
              </Text>
              <View style={s.wrap}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  style={{ flex: 1 }}
                  disabled={remove.isPending}
                  onPress={() => setConfirm(false)}
                />
                <Button
                  label="Delete"
                  variant="danger"
                  style={{ flex: 1, backgroundColor: colors.surface }}
                  busy={remove.isPending}
                  disabled={analyze.isPending}
                  onPress={() => void destroy()}
                />
              </View>
            </Card>
          )}
          <Card>
            <View style={s.wrap}>
              <Pill tone="accent">{VIEW_LABELS[photo.view]}</Pill>
              {length && (
                <Pill>{length.charAt(0).toUpperCase() + length.slice(1)}</Pill>
              )}
              <Pill>{photo.hair_wet ? "Wet" : "Dry"}</Pill>
            </View>
            {Boolean(photo.notes) && <Text style={s.body}>{photo.notes}</Text>}
            <Button
              label="Compare"
              icon="compare"
              onPress={() => {
                comparison.focus(photo);
                router.navigate("/compare");
              }}
            />
            <View style={s.wrap}>
              <Button
                label={framingOf(photo) ? "Re-line up" : "Line up"}
                icon="move"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() =>
                  router.push({
                    pathname: "/line-up",
                    params: { id: photo.id },
                  })
                }
              />
              <Button
                label={assessment ? "Re-analyze" : "Analyze"}
                icon="eye"
                variant="secondary"
                style={{ flex: 1 }}
                disabled={consent}
                onPress={() => setConsent(true)}
              />
            </View>
          </Card>
          {consent &&
            (owner === "local" && !DEV_ANALYSIS_URL ? (
              <Card>
                <Text style={s.body}>Analysis needs an account.</Text>
                <View style={s.wrap}>
                  <Button
                    label="Cancel"
                    variant="secondary"
                    style={{ flex: 1 }}
                    onPress={() => setConsent(false)}
                  />
                  <Button
                    label="Sign in"
                    style={{ flex: 1 }}
                    onPress={() => router.push("/account")}
                  />
                </View>
              </Card>
            ) : (
              <Card>
                <Text style={s.body}>
                  Sends this photo, the previous {VIEW_LABELS[photo.view]}{" "}
                  photo, your notes and treatments{" "}
                  {DEV_ANALYSIS_URL
                    ? `to the developer analysis server at ${DEV_ANALYSIS_URL}.`
                    : "to the AI provider."}
                </Text>
                <View style={s.wrap}>
                  <Button
                    label="Cancel"
                    variant="secondary"
                    style={{ flex: 1 }}
                    disabled={analyze.isPending}
                    onPress={() => setConsent(false)}
                  />
                  <Button
                    label="Send"
                    style={{ flex: 1 }}
                    busy={analyze.isPending}
                    onPress={() => void assess()}
                  />
                </View>
              </Card>
            ))}
          {Boolean(error) && <Notice error>{error}</Notice>}
          {assessment && <AnalysisCard analysis={assessment} />}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tag: { position: "absolute", top: 10, left: 10 },
});
