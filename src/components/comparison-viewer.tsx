import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  IconButton,
  Notice,
  Pill,
  Segmented,
  colors,
  s,
} from "./ui";
import { ZoomFrame, useZoom, type Zoom } from "./zoom";
import { Guide } from "./guide";
import { ChangeExplainer } from "./change-explainer";
import { ChangeOverlay } from "./change-overlay";
import { RegionOutlines, type OutlineFrom } from "./region-outlines";
import { Slider } from "./slider";
import {
  FineTune,
  FramedPhoto,
  FramingEditor,
  loadFraming,
  readFraming,
  setFraming,
  useFramingEdit,
  type FramingEdit,
} from "./framed-photo";
import { useChangeMap } from "@/hooks/use-change-map";
import { useJournalMutation } from "@/hooks/use-journal";
import { usePreferences } from "@/hooks/use-preferences";
import { matchFraming, useAutoLineUp } from "@/hooks/use-auto-line-up";
import { saveAlignment } from "@/lib/repository";
import { IDENTITY, framingOf, type Framing } from "@/lib/framing";
import { mapBetweenPhotos, regionPolygon } from "@/lib/outline";
import {
  VIEW_LABELS,
  elapsedDays,
  errorMessage,
  formatDate,
  photoMeta,
  type Analysis,
  type Photo,
} from "@/lib/model";

const SEAM = 4;

/** Callbacks for stepping one side of the pair; omitted at the timeline's ends. */
export type Steps = { onOlder?: () => void; onNewer?: () => void };
type Side = "before" | "after";

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

/** "Feb 14", with the year when the photos are in different years. */
function changeDate(taken: string, withYear: boolean) {
  return new Date(`${taken.slice(0, 10)}T12:00:00`).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric", year: withYear ? "numeric" : undefined },
  );
}

function PhotoPane({
  photo,
  turn,
  zoom,
  analysis,
  regions,
  grid,
  guide,
  overlay,
  outlineFrom,
  height,
  label,
  steps,
}: {
  photo: Photo;
  turn: number;
  zoom: Zoom;
  analysis?: Analysis;
  regions: boolean;
  grid: boolean;
  guide: boolean;
  /** Drawn over the photo inside the zoom, given the guide square's side. */
  overlay?: (size: number) => ReactNode;
  /** Earlier outlines in this photo's coordinates, for its regions to morph from. */
  outlineFrom?: OutlineFrom[] | null;
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
            width={width}
            height={height}
            onError={() => setFailed(true)}
          >
            {(box) =>
              regions &&
              analysis && (
                <RegionOutlines
                  regions={analysis.result.regions}
                  box={box}
                  from={outlineFrom}
                  animationKey={`${analysis.id}:${outlineFrom ? "morph" : "fade"}`}
                />
              )
            }
          </FramedPhoto>
          {overlay?.(Math.min(width, height))}
          {guide && (
            <Guide
              view={photo.view}
              turn={turn}
              size={Math.min(width, height)}
            />
          )}
        </View>
      )}
    </ZoomFrame>
  );
}

/**
 * Before and after, each drawn on its view's guide so they line up. In
 * line-up mode both photos can be dragged, pinched and twisted onto the guide,
 * and the result is saved on each photo.
 */
export function ComparisonViewer({
  before,
  after,
  photos,
  paneHeight,
  analyses,
  beforeSteps,
  afterSteps,
  changeRequest,
}: {
  before: Photo;
  after: Photo;
  /** Every photo of this view, for lining the rest up automatically. */
  photos: Photo[];
  paneHeight: number;
  analyses: Analysis[];
  beforeSteps?: Steps;
  afterSteps?: Steps;
  /** Changes whenever another screen asks to open in Change mode. */
  changeRequest?: string;
}) {
  const view = after.view;
  const { preferences, update } = usePreferences();
  const turn = preferences.turns[view] ?? 0;
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
  const [regions, setRegions] = useState(false);
  const [lining, setLining] = useState(false);
  const [active, setActive] = useState<Side>("after");
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // One zoom drives both panes so the same region is always in view.
  const zoom = useZoom();
  const edits: Record<Side, FramingEdit> = {
    before: useFramingEdit(),
    after: useFramingEdit(),
  };
  const shown: Record<Side, Photo> = { before, after };
  const save = useJournalMutation(
    (owner: string, input: { id: string; framing: Framing }) =>
      saveAlignment(owner, input.id, input.framing),
  );
  const autoLineUp = useAutoLineUp();
  // Edits belong to a pair; view settings and zoom carry across pairs.
  const pair = `${before.id}-${after.id}`;
  const currentPair = useRef(pair);
  useEffect(() => {
    currentPair.current = pair;
  }, [pair]);
  const [shownPair, setShownPair] = useState(pair);
  if (shownPair !== pair) {
    setShownPair(pair);
    setLining(false);
    setMessage("");
    setError("");
  }
  const earlierAnalysis = analyses
    .filter((a) => a.photo_id === before.id)
    .at(-1);
  const laterAnalysis = analyses.filter((a) => a.photo_id === after.id).at(-1);
  const unframed = photos.filter((p) => !framingOf(p)).length;
  const other: Side = active === "before" ? "after" : "before";
  // Photos never wait on this: the overlay only joins once it is ready.
  const changeShown = change && !lining;
  const changeMap = useChangeMap(before, after, changeShown);
  const changeReady =
    changeShown && changeMap.status === "ready" ? changeMap.result : null;
  // In Change mode the after photo's outlines grow out of the before photo's,
  // carried across on both framings; without both assessments they fade in.
  const outlineFrom = useMemo(() => {
    const from = framingOf(before);
    const to = framingOf(after);
    if (!changeShown || !earlierAnalysis || !laterAnalysis || !from || !to)
      return null;
    return earlierAnalysis.result.regions.flatMap((region) => {
      const points = regionPolygon(region);
      return points
        ? [
            {
              area: region.area,
              points: mapBetweenPhotos(points, before, from, after, to),
            },
          ]
        : [];
    });
  }, [changeShown, earlierAnalysis, laterAnalysis, before, after]);
  const withYear = before.taken_at.slice(0, 4) !== after.taken_at.slice(0, 4);
  const [fromDate, toDate] = [before, after].map((p) =>
    changeDate(p.taken_at, withYear),
  );

  function startLining() {
    loadFraming(edits.before, framingOf(before));
    loadFraming(edits.after, framingOf(after));
    setMessage("");
    setError("");
    setLining(true);
  }
  async function match() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const framing = await matchFraming(
        shown[other],
        readFraming(edits[other]),
        shown[active],
      );
      if (currentPair.current !== pair) return;
      if (!framing)
        setMessage("Couldn't match the details. Line this one up by hand.");
      else {
        setFraming(edits[active], framing);
        setMessage(
          `Matched to the ${other} photo. Check it against the guide.`,
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function persist() {
    setError("");
    try {
      for (const side of ["before", "after"] as const)
        if (edits[side].touched.get())
          await save.mutateAsync({
            id: shown[side].id,
            framing: { ...readFraming(edits[side]), source: "manual" },
          });
      setLining(false);
      setOffer(true);
      setMessage("Saved. These photos will open lined up from now on.");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function lineUpRest() {
    setError("");
    setMessage("");
    try {
      const { lined, missed } = await autoLineUp.run(photos);
      setOffer(false);
      setMessage(
        missed
          ? `Lined up ${lined}. ${missed} couldn't be matched, so line ${missed === 1 ? "it" : "those"} up by hand.`
          : `Lined up ${lined} ${lined === 1 ? "photo" : "photos"}. Swipe through to check them.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  function turnGuide() {
    update((p) => ({ ...p, turns: { ...p.turns, [view]: (turn + 1) % 4 } }));
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={[s.stage, { gap: SEAM }]}>
        {(["before", "after"] as const).map((side) =>
          lining ? (
            <FramingEditor
              key={side}
              photo={shown[side]}
              edit={edits[side]}
              turn={turn}
              height={paneHeight}
              active={active === side}
              onActivate={() => setActive(side)}
              overlay={
                <Labels
                  photo={shown[side]}
                  label={side === "before" ? "Before" : "After"}
                />
              }
            />
          ) : (
            <PhotoPane
              key={side}
              photo={shown[side]}
              turn={turn}
              zoom={zoom}
              analysis={side === "before" ? earlierAnalysis : laterAnalysis}
              regions={regions}
              outlineFrom={side === "after" ? outlineFrom : null}
              grid={grid}
              guide={guide}
              overlay={
                side === "after" && changeReady
                  ? (size) => (
                      <ChangeOverlay
                        map={changeReady.map}
                        turn={turn}
                        size={size}
                        opacity={opacity}
                      />
                    )
                  : undefined
              }
              height={paneHeight}
              label={side === "before" ? "Before" : "After"}
              steps={side === "before" ? beforeSteps : afterSteps}
            />
          ),
        )}
        <View
          pointerEvents="none"
          style={[styles.seam, { top: paneHeight + SEAM / 2 - 15 }]}
        >
          <Text style={styles.seamText}>
            {elapsedDays(before.taken_at, after.taken_at)} days
          </Text>
        </View>
      </View>
      {lining ? (
        <Card>
          <Text style={s.muted}>
            Drag, pinch and twist each photo onto the guide. The buttons adjust
            the outlined photo.
          </Text>
          <Segmented
            values={[
              { value: "before", label: "Before" },
              { value: "after", label: "After" },
            ]}
            selected={active}
            onChange={setActive}
          />
          <FineTune edit={edits[active]} />
          <View style={s.wrap}>
            <Button
              label={`Match to ${other}`}
              icon="align"
              variant="secondary"
              busy={busy}
              style={{ flex: 1 }}
              onPress={() => void match()}
            />
            <Button
              label="Turn guide"
              icon="turn"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={turnGuide}
            />
          </View>
          <View style={s.wrap}>
            <Button
              label="Reset"
              variant="ghost"
              style={{ flex: 1 }}
              onPress={() => setFraming(edits[active], IDENTITY)}
            />
            <Button
              label="Cancel"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => setLining(false)}
            />
            <Button
              label="Save"
              style={{ flex: 1 }}
              busy={save.isPending}
              onPress={() => void persist()}
            />
          </View>
        </Card>
      ) : (
        <Card style={styles.toolbar}>
          <IconButton
            icon="grid"
            label="Grid"
            active={grid}
            onPress={() => setGrid(!grid)}
          />
          <IconButton
            icon="ghost"
            label="Guide"
            active={guide}
            onPress={() => setGuide(!guide)}
          />
          <IconButton
            icon="change"
            label="Change"
            active={change}
            onPress={() => setChange(!change)}
          />
          {(earlierAnalysis || laterAnalysis) && (
            <IconButton
              icon="eye"
              label="Regions"
              active={regions}
              onPress={() => setRegions(!regions)}
            />
          )}
          <IconButton icon="move" label="Line up" onPress={startLining} />
        </Card>
      )}
      {changeShown && (
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
      {Boolean(message) && <Notice>{message}</Notice>}
      {Boolean(error) && <Notice error>{error}</Notice>}
      {offer && unframed > 0 && (
        <Card>
          <Text style={s.body}>
            {unframed} other {VIEW_LABELS[view].toLowerCase()}{" "}
            {unframed === 1 ? "photo isn't" : "photos aren't"} lined up yet.
            They can be matched to the photos already lined up.
          </Text>
          <Button
            label={
              autoLineUp.progress
                ? `Lining up ${autoLineUp.progress.done + 1} of ${autoLineUp.progress.total}…`
                : "Line them up automatically"
            }
            icon="align"
            busy={Boolean(autoLineUp.progress)}
            onPress={() => void lineUpRest()}
          />
        </Card>
      )}
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
  seam: {
    position: "absolute",
    alignSelf: "center",
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
