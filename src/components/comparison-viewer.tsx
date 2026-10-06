import { useRef, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
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
import { useJournalMutation } from "@/hooks/use-journal";
import { usePreferences } from "@/hooks/use-preferences";
import { matchFraming, useAutoLineUp } from "@/hooks/use-auto-line-up";
import { saveAlignment } from "@/lib/repository";
import { IDENTITY, framingOf, type Framing } from "@/lib/framing";
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

function PhotoPane({
  photo,
  turn,
  zoom,
  analysis,
  regions,
  grid,
  guide,
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
              analysis?.result.regions
                .filter((r) => r.box !== null)
                .map((region, index) => {
                  const area = region.box!;
                  return (
                    <View
                      pointerEvents="none"
                      key={`${region.area}-${index}`}
                      style={{
                        position: "absolute",
                        left: area.x * box.width,
                        top: area.y * box.height,
                        width: area.width * box.width,
                        height: area.height * box.height,
                        borderColor: colors.loupe,
                        borderWidth: 2,
                        backgroundColor: "#F2B5441A",
                      }}
                    >
                      <Text style={styles.regionLabel}>
                        {region.area.replaceAll("_", " ")}
                      </Text>
                    </View>
                  );
                })
            }
          </FramedPhoto>
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
}: {
  before: Photo;
  after: Photo;
  /** Every photo of this view, for lining the rest up automatically. */
  photos: Photo[];
  paneHeight: number;
  analyses: Analysis[];
  beforeSteps?: Steps;
  afterSteps?: Steps;
}) {
  const view = after.view;
  const { preferences, update } = usePreferences();
  const turn = preferences.turns[view] ?? 0;
  const [grid, setGrid] = useState(false);
  const [guide, setGuide] = useState(false);
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
              grid={grid}
              guide={guide}
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
  regionLabel: {
    color: colors.ink,
    backgroundColor: colors.loupe,
    fontSize: 9,
    paddingHorizontal: 3,
    alignSelf: "flex-start",
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
});
