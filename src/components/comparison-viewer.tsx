import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { Button, Card, Icon, IconButton, Notice, Pill, colors, s } from "./ui";
import { ZoomFrame, useZoom, type Zoom } from "./zoom";
import { Guide } from "./guide";
import { ChangeExplainer } from "./change-explainer";
import { ChangeOverlay } from "./change-overlay";
import { Slider } from "./slider";
import { FramedPhoto, snapFeedback } from "./framed-photo";
import { AiBubble, ScanOverlay, useScanTour } from "./scan";
import { ScanOutlines, type InspectShape } from "./scan-outlines";
import { AI_MATCH, MatchChoices } from "./match-choices";
import { useChangeMap } from "@/hooks/use-change-map";
import { useAccount, useJournalMutation } from "@/hooks/use-journal";
import { useViewGuide } from "@/hooks/use-preferences";
import {
  isLiningUp,
  useAutoLineUp,
  useLineUpState,
} from "@/hooks/use-auto-line-up";
import { matchWithClaude } from "@/lib/match";
import { analyzePhoto } from "@/lib/repository";
import { DEV_ANALYSIS_URL } from "@/lib/dev-analysis";
import { IDENTITY, framingOf, placedOn } from "@/lib/framing";
import { inspectPoints, type GuideStyle } from "@/lib/guide-art";
import { photoToGuide, regionPolygon } from "@/lib/outline";
import {
  contextLines,
  matchLines,
  resultLines,
  verdictText,
  type BubbleLine,
} from "@/lib/scan-script";
import {
  VIEW_LABELS,
  elapsedDays,
  errorMessage,
  formatDate,
  photoMeta,
  shortDate,
  type Analysis,
  type Photo,
  type Treatment,
} from "@/lib/model";

const SEAM = 4;

/** Callbacks for stepping one side of the pair; omitted at the timeline's ends. */
export type Steps = { onOlder?: () => void; onNewer?: () => void };

function Labels({ photo, label }: { photo: Photo; label: string }) {
  return (
    <>
      <View pointerEvents="none" style={styles.tags}>
        <Pill tone="dark">
          {label} · {formatDate(photo.taken_at)}
        </Pill>
      </View>
      <View pointerEvents="none" style={styles.meta}>
        <Pill tone="dark">{photoMeta(photo, false)}</Pill>
      </View>
    </>
  );
}

function PhotoPane({
  photo,
  turn,
  zoom,
  grid,
  variant,
  showGuide,
  overlay,
  height,
  label,
  steps,
}: {
  photo: Photo;
  turn: number;
  zoom: Zoom;
  grid: boolean;
  /** The view's guide picture, which the photo is shown on. */
  variant: GuideStyle;
  /** Draw that picture over the photo. */
  showGuide: boolean;
  /** Drawn over the photo inside the zoom, given the frame's size. */
  overlay?: (width: number, height: number) => ReactNode;
  height: number;
  label: string;
  steps?: Steps;
}) {
  const [failed, setFailed] = useState(false);
  const [shownUri, setShownUri] = useState(photo.uri);
  if (shownUri !== photo.uri) {
    setShownUri(photo.uri);
    setFailed(false);
  }
  return (
    <ZoomFrame
      zoom={zoom}
      height={height}
      onOlder={steps?.onOlder}
      onNewer={steps?.onNewer}
      stepLabel={`${label.toLowerCase()} photo`}
      overlay={
        <>
          {grid && (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {[1, 2].map((line) => (
                <View
                  key={`v${line}`}
                  style={[styles.gridV, { left: `${(line * 100) / 3}%` }]}
                />
              ))}
              {[1, 2].map((line) => (
                <View
                  key={`h${line}`}
                  style={[styles.gridH, { top: `${(line * 100) / 3}%` }]}
                />
              ))}
            </View>
          )}
          <Labels photo={photo} label={label} />
          {failed && (
            <Text style={[s.muted, styles.failed]}>Photo failed to load</Text>
          )}
        </>
      }
    >
      {(width) => (
        <View style={{ width, height }}>
          <FramedPhoto
            photo={photo}
            turn={turn}
            variant={variant}
            width={width}
            height={height}
            onError={() => setFailed(true)}
          />
          {overlay?.(width, height)}
          {showGuide && (
            <Guide
              view={photo.view}
              turn={turn}
              size={Math.min(width, height)}
              variant={variant}
            />
          )}
        </View>
      )}
    </ZoomFrame>
  );
}

type Status = "done" | "working" | "attention" | "todo" | "locked";

/** One step of comparing: a numbered badge showing how it stands, and its body. */
function Step({
  n,
  title,
  status,
  children,
}: {
  n: number;
  title: string;
  status: Status;
  children?: ReactNode;
}) {
  return (
    <View style={styles.step}>
      <View
        style={[
          styles.badge,
          status === "done" && { backgroundColor: colors.accent },
          status === "attention" && { backgroundColor: colors.rust },
          status === "locked" && { opacity: 0.4 },
        ]}
      >
        {status === "working" ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : status === "done" ? (
          <Icon name="check" size={16} color="#FFF" />
        ) : (
          <Text
            style={[
              styles.badgeText,
              status === "attention" && { color: "#FFF" },
            ]}
          >
            {status === "attention" ? "!" : n}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={[styles.stepTitle, status === "locked" && s.muted]}>
          {title}
        </Text>
        {children}
      </View>
    </View>
  );
}

/**
 * Before and after, each drawn on its view's guide so they line up, and the
 * two steps of comparing them: line them up (on its own, else by Claude or by
 * hand), then analyse, with the scan, its commentary and what it found drawn
 * over both photos.
 */
export function ComparisonViewer({
  before,
  after,
  photos,
  paneHeight,
  analyses,
  treatments,
  beforeSteps,
  afterSteps,
  changeRequest,
  onWatch,
}: {
  before: Photo;
  after: Photo;
  /** Every photo of this view, for lining up. */
  photos: Photo[];
  paneHeight: number;
  analyses: Analysis[];
  treatments: Treatment[];
  beforeSteps?: Steps;
  afterSteps?: Steps;
  /** Changes whenever another screen asks to open in Change mode. */
  changeRequest?: string;
  /** Bring the photos into view, as a scan over them starts. */
  onWatch?: () => void;
}) {
  const view = after.view;
  const { owner } = useAccount();
  const { turn, variant: guideStyle } = useViewGuide(view);
  const [grid, setGrid] = useState(false);
  const [guide, setGuide] = useState(false);
  const [change, setChange] = useState(Boolean(changeRequest));
  const [shownRequest, setShownRequest] = useState(changeRequest);
  if (changeRequest && changeRequest !== shownRequest) {
    setShownRequest(changeRequest);
    setChange(true);
  }
  const [opacity, setOpacity] = useState(0.8);
  const [explain, setExplain] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [triedAi, setTriedAi] = useState<string[]>([]);
  const [replay, setReplay] = useState(0);
  const [error, setError] = useState("");
  // One zoom drives both panes so the same region is always in view.
  const zoom = useZoom();
  const autoLineUp = useAutoLineUp();
  const analyze = useJournalMutation(analyzePhoto);
  const shown: Record<"before" | "after", Photo> = { before, after };
  const pair = `${before.id}-${after.id}`;
  const [shownPair, setShownPair] = useState(pair);
  if (shownPair !== pair) {
    setShownPair(pair);
    setError("");
  }

  // Step 1: line the pair up, as soon as it's shown.
  const states = {
    before: useLineUpState(before.id),
    after: useLineUpState(after.id),
  };
  const framed = Boolean(framingOf(before) && framingOf(after));
  const target = !framingOf(after) ? after : !framingOf(before) ? before : null;
  const other = target === after ? before : after;
  const matching =
    aiBusy ||
    Object.values(states).some(isLiningUp);
  const missed =
    !framed &&
    !matching &&
    Boolean(target) &&
    states[target === after ? "after" : "before"] === "missed";
  const unframed = photos.filter((p) => !framingOf(p)).length;
  const { pairUp } = autoLineUp;
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (started.current === pair) return;
    started.current = pair;
    pairUp([before, after], photos, guideStyle).catch((e) =>
      setError(errorMessage(e)),
    );
  }, [pair, before, after, photos, pairUp, guideStyle]);

  async function aiMatch() {
    if (!target) return;
    setAiBusy(true);
    setError("");
    setTriedAi((ids) => [...ids, target.id]);
    onWatch?.();
    try {
      // An unplaced photo stays as taken on the picture shown and anchors the
      // match; it is matched from on the whole head, like every match.
      const kept = framingOf(other)
        ? other
        : {
            ...other,
            alignment: { ...IDENTITY, ...placedOn(view, guideStyle) },
          };
      if (kept !== other) await autoLineUp.place(other.id, kept.alignment!);
      const framing = await matchWithClaude(other, framingOf(kept)!, target);
      if (framing) {
        await autoLineUp.place(target.id, framing);
        snapFeedback();
      } else
        setError(
          "Claude couldn't find enough of the same spots in both photos. Line it up by hand.",
        );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAiBusy(false);
    }
  }
  /**
   * Both photos together, moved as one or pinned feature to feature. The
   * photo still to match follows the one already lined up; else the after
   * photo follows the before.
   */
  function adjust() {
    const [fixed, moving] = target ? [other, target] : [before, after];
    router.push({
      pathname: "/adjust",
      params: { ref: fixed.id, id: moving.id },
    });
  }

  // Step 2: analyse the after photo against this before photo.
  const pairAnalysis = analyses
    .filter((a) => a.photo_id === after.id && a.previous_photo_id === before.id)
    .at(-1);
  const canAnalyze = owner !== "local" || Boolean(DEV_ANALYSIS_URL);
  const analyzing = analyze.isPending;
  const changeMap = useChangeMap(
    before,
    after,
    guideStyle,
    (change || analyzing) && framed,
  );
  const changeReady =
    change && changeMap.status === "ready" ? changeMap.result : null;
  async function runAnalysis() {
    setError("");
    onWatch?.();
    try {
      await analyze.mutateAsync({ photoId: after.id, previousId: before.id });
      snapFeedback();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  // What the AI bubble says, and where the scanner looks.
  const mode = matching
    ? "match"
    : analyzing
      ? "analyze"
      : pairAnalysis && framed
        ? "result"
        : null;
  const texture = changeMap.result?.map;
  const lines: BubbleLine[] = useMemo(() => {
    if (mode === "match")
      return matchLines(
        view,
        guideStyle,
        formatDate(other.taken_at),
        aiBusy,
      ).map((text) => ({ text }));
    if (mode === "analyze")
      return contextLines({ before, after, treatments, texture });
    if (mode === "result" && pairAnalysis)
      return resultLines(pairAnalysis.result);
    return [];
  }, [
    mode,
    view,
    guideStyle,
    other,
    aiBusy,
    before,
    after,
    treatments,
    texture,
    pairAnalysis,
  ]);
  const { scanner, ...speech } = useScanTour(lines, {
    scanning: mode === "match" || mode === "analyze",
    speaking: Boolean(mode),
    points: inspectPoints(view, guideStyle),
    everyMs: mode === "result" ? 4600 : 2400,
    loop: mode !== "result",
    restart: replay,
  });

  // What the analysis inspected, on the guide, so it lands on both photos.
  const shapes: InspectShape[] = useMemo(() => {
    const framing = framingOf(after, guideStyle);
    if (!pairAnalysis || !framing) return [];
    return pairAnalysis.result.regions.flatMap((region, i) => {
      const polygon = regionPolygon(region);
      return polygon
        ? [
            {
              key: `${region.area}-${i}`,
              area: region.area,
              severity: region.severity,
              points: photoToGuide(polygon, after, framing),
            },
          ]
        : [];
    });
  }, [pairAnalysis, after, guideStyle]);
  // Once the findings have been read out, the bubble tucks away to a button.
  const reading = pairAnalysis ? `${pairAnalysis.id}:${replay}` : "";
  const [heard, setHeard] = useState("");
  const onLast = mode === "result" && speech.index === lines.length - 1;
  useEffect(() => {
    if (!onLast) return;
    const timer = setTimeout(() => setHeard(reading), 6000);
    return () => clearTimeout(timer);
  }, [onLast, reading]);
  const quiet = mode === "result" && heard === reading;
  const focus =
    mode === "result" && !quiet ? (speech.line?.area ?? null) : null;

  const withYear = before.taken_at.slice(0, 4) !== after.taken_at.slice(0, 4);
  const [fromDate, toDate] = [before, after].map((p) =>
    shortDate(p.taken_at, withYear),
  );
  const verdict = pairAnalysis?.result.change_since_previous.assessment;

  return (
    <View style={{ gap: 12 }}>
      <View style={[s.stage, { gap: SEAM }]}>
        {(["before", "after"] as const).map((side) => (
          <PhotoPane
            key={side}
            photo={shown[side]}
            turn={turn}
            zoom={zoom}
            grid={grid}
            variant={guideStyle}
            showGuide={guide}
            overlay={(width, height) => (
              <>
                {side === "after" && changeReady && (
                  <ChangeOverlay
                    map={changeReady.map}
                    turn={turn}
                    size={Math.min(width, height)}
                    opacity={opacity}
                  />
                )}
                {mode === "result" && pairAnalysis && (
                  <ScanOutlines
                    shapes={shapes}
                    width={width}
                    height={height}
                    turn={turn}
                    focus={focus}
                    drawKey={`${pairAnalysis.id}:${replay}`}
                  />
                )}
                {(mode === "analyze" ||
                  (mode === "match" && target?.id === shown[side].id)) && (
                  <ScanOverlay
                    scanner={scanner}
                    width={width}
                    height={height}
                    turn={turn}
                  />
                )}
              </>
            )}
            height={paneHeight}
            label={side === "before" ? "Before" : "After"}
            steps={side === "before" ? beforeSteps : afterSteps}
          />
        ))}
        {mode && speech.line && !quiet ? (
          <View
            style={[styles.voice, { bottom: paneHeight + SEAM / 2 - 22 }]}
          >
            <AiBubble
              text={speech.line.text}
              thinking={mode !== "result"}
              onPress={
                mode === "result"
                  ? onLast
                    ? () => setHeard(reading)
                    : speech.next
                  : undefined
              }
            />
          </View>
        ) : (
          <View style={[styles.seamRow, { top: paneHeight + SEAM / 2 - 15 }]}>
            <View pointerEvents="none" style={styles.seam}>
              <Text style={styles.seamText}>
                {elapsedDays(before.taken_at, after.taken_at)} days
              </Text>
            </View>
            {quiet && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Read the findings again"
                onPress={() => setReplay((n) => n + 1)}
                style={[styles.seam, styles.findings]}
              >
                <Text style={[styles.seamText, { color: "#7CF2B6" }]}>
                  ✦ Findings
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <Card style={{ gap: 16 }}>
        <Step
          n={1}
          title="Line up"
          status={
            framed ? "done" : matching ? "working" : missed ? "attention" : "todo"
          }
        >
          {matching && (
            <Text style={s.muted}>
              {aiBusy
                ? "Claude is finding the same spots in both photos…"
                : "Matching the photos…"}
            </Text>
          )}
          {framed && (
            <View style={styles.inline}>
              <Text style={[s.muted, { flexShrink: 1 }]}>
                The photos are lined up.
              </Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={adjust}
              >
                <Text style={styles.link}>Adjust</Text>
              </Pressable>
            </View>
          )}
          {missed && target && (
            <>
              <Text style={s.body}>
                Couldn&apos;t match the {formatDate(target.taken_at)} photo
                automatically.
              </Text>
              {AI_MATCH && !triedAi.includes(target.id) ? (
                <MatchChoices onAi={() => void aiMatch()} onHand={adjust} />
              ) : (
                <Button label="Line up by hand" icon="move" onPress={adjust} />
              )}
            </>
          )}
          {framed && unframed > 0 && (
            <Pressable
              accessibilityRole="button"
              disabled={Boolean(autoLineUp.progress)}
              onPress={() =>
                void autoLineUp.run(photos).catch((e) => setError(errorMessage(e)))
              }
            >
              <Text style={styles.link}>
                {autoLineUp.progress
                  ? `Lining up ${autoLineUp.progress.done + 1} of ${autoLineUp.progress.total}…`
                  : `Line up the other ${unframed} ${VIEW_LABELS[view].toLowerCase()} ${unframed === 1 ? "photo" : "photos"}`}
              </Text>
            </Pressable>
          )}
        </Step>
        <Step
          n={2}
          title="Analyze"
          status={
            analyzing
              ? "working"
              : pairAnalysis
                ? "done"
                : framed
                  ? "todo"
                  : "locked"
          }
        >
          {!framed && (
            <Text style={s.muted}>Once both photos are lined up.</Text>
          )}
          {framed && analyzing && (
            <Text style={s.muted}>Scanning both photos…</Text>
          )}
          {framed && pairAnalysis && !analyzing && (
            <View style={styles.inline}>
              <Text style={[s.body, { flexShrink: 1, fontWeight: "700" }]}>
                {verdict && verdictText(verdict)}
                <Text style={s.muted}>
                  {"  "}
                  {pairAnalysis.result.confidence} confidence
                </Text>
              </Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setReplay((n) => n + 1)}
              >
                <Text style={styles.link}>Replay</Text>
              </Pressable>
            </View>
          )}
          {framed &&
            !analyzing &&
            (canAnalyze ? (
              <>
                <Button
                  label={pairAnalysis ? "Analyze again" : "Analyze"}
                  icon="eye"
                  variant={pairAnalysis ? "secondary" : "primary"}
                  onPress={() => void runAnalysis()}
                />
                <Text style={styles.small}>
                  Sends both photos, your notes and treatments to{" "}
                  {DEV_ANALYSIS_URL
                    ? `the developer analysis server at ${DEV_ANALYSIS_URL}`
                    : "the AI provider"}
                  .
                </Text>
              </>
            ) : (
              <>
                <Text style={s.muted}>Analysis needs an account.</Text>
                <Button
                  label="Sign in"
                  variant="secondary"
                  onPress={() => router.push("/account")}
                />
              </>
            ))}
        </Step>
      </Card>

      <Card style={styles.toolbar}>
        <IconButton
          icon="ghost"
          label="Guide"
          active={guide}
          onPress={() => setGuide(!guide)}
        />
        <IconButton
          icon="grid"
          label="Grid"
          active={grid}
          onPress={() => setGrid(!grid)}
        />
        <IconButton
          icon="change"
          label="Change"
          active={change}
          onPress={() => setChange(!change)}
        />
      </Card>
      {change && (
        <Card>
          {changeMap.status === "unframed" ? (
            <Text style={s.body}>Line up both photos to see change</Text>
          ) : (
            <>
              <View style={s.row}>
                <Text style={[s.body, styles.caption]}>
                  {`Texture change, ${fromDate} → ${toDate}`}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setExplain(true)}
                >
                  <Text style={styles.link}>What this is</Text>
                </Pressable>
              </View>
              <Slider
                value={opacity}
                onChange={setOpacity}
                label="Overlay opacity"
              />
              {changeMap.result?.reason && (
                <Text style={s.muted}>{changeMap.result.reason}</Text>
              )}
              {changeMap.status === "loading" && (
                <Text style={s.muted}>Comparing texture…</Text>
              )}
              {changeMap.error && (
                <Text style={styles.error}>
                  {errorMessage(changeMap.error)}
                </Text>
              )}
            </>
          )}
        </Card>
      )}
      <ChangeExplainer visible={explain} onClose={() => setExplain(false)} />
      {Boolean(error) && <Notice error>{error}</Notice>}
    </View>
  );
}

const styles = StyleSheet.create({
  tags: { position: "absolute", top: 10, left: 10 },
  meta: { position: "absolute", bottom: 10, left: 10 },
  failed: { position: "absolute", alignSelf: "center", top: "45%" },
  gridV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "#FFFFFF66",
  },
  gridH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#FFFFFF66",
  },
  seamRow: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
  },
  findings: { backgroundColor: colors.stage, borderColor: "#7CF2B6" },
  seam: {
    height: 30,
    paddingHorizontal: 14,
    borderRadius: 15,
    backgroundColor: colors.surface,
    justifyContent: "center",
    borderWidth: 3,
    borderColor: colors.stage,
  },
  seamText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  voice: {
    position: "absolute",
    left: 12,
    right: 12,
    alignItems: "center",
  },
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  badgeText: { fontSize: 13, fontWeight: "800", color: colors.ink },
  stepTitle: { fontSize: 16, fontWeight: "700", color: colors.ink, marginTop: 3 },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  small: { fontSize: 12, lineHeight: 16, color: colors.muted },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 6,
    borderRadius: 999,
  },
  caption: { flexShrink: 1, fontWeight: "600" },
  link: { fontSize: 14, fontWeight: "600", color: colors.accent },
  error: { fontSize: 14, lineHeight: 20, color: colors.danger },
});
