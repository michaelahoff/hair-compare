import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { timelineOf } from "@/hooks/use-comparison";
import { changeMapQuery, changeResult } from "@/hooks/use-change-map";
import { guideStyleOf, usePreferences } from "@/hooks/use-preferences";
import { framingOf } from "@/lib/framing";
import { SCALP_VIEWS, type Photo, type ScalpView } from "@/lib/model";
import { framedPairs, regionTrend, type Trend } from "@/lib/trend";

export type RegionTrend = {
  status: "none" | "idle" | "loading" | "ready";
  trend: Trend;
  /** Framed photos in the region. */
  framed: number;
  since?: Photo;
  latest?: Photo;
};

/**
 * Each region's texture trend for the head map. A region's pairs are only
 * computed once it has been selected this session, so first load does not
 * run every region's pixel work.
 */
export function useRegionTrends(
  photos: Photo[],
  selected: ScalpView,
): Record<ScalpView, RegionTrend> {
  const [visited, setVisited] = useState<ReadonlySet<ScalpView>>(
    () => new Set([selected]),
  );
  // Remember a selection during render, as comparison-viewer does for its pair.
  if (!visited.has(selected)) setVisited(new Set([...visited, selected]));
  // Maps are compared on each view's picture, as Compare shows them.
  const { preferences } = usePreferences();

  const regions = SCALP_VIEWS.map((view) => {
    const timeline = timelineOf(photos, view);
    const framed = timeline.filter((p) => framingOf(p) !== null);
    return { view, framed, pairs: framedPairs(framed) };
  });
  const flat = regions.flatMap(({ view, pairs }) =>
    pairs.map(([before, after]) => ({ view, before, after })),
  );
  const results = useQueries({
    queries: flat.map(({ view, before, after }) =>
      changeMapQuery(
        before,
        after,
        guideStyleOf(preferences, view),
        visited.has(view),
      ),
    ),
  });

  return Object.fromEntries(
    regions.map(({ view, framed }): [ScalpView, RegionTrend] => {
      const base = {
        framed: framed.length,
        since: framed.at(0),
        latest: framed.at(-1),
      };
      if (framed.length < 2)
        return [view, { ...base, status: "none", trend: "unknown" }];
      if (!visited.has(view))
        return [view, { ...base, status: "idle", trend: "unknown" }];
      const own = flat.flatMap((pair, i) =>
        pair.view === view ? [{ ...pair, query: results[i] }] : [],
      );
      if (own.some((p) => !p.query.data && !p.query.error))
        return [view, { ...base, status: "loading", trend: "unknown" }];
      // Errored pairs drop out; if every pair errored the trend is unknown.
      const changes = own.flatMap(({ query, before, after }) => {
        if (!query.data) return [];
        const { map, confidence } = changeResult(query.data, before, after);
        return [{ gained: map.gained, lost: map.lost, confidence }];
      });
      return [
        view,
        { ...base, status: "ready", trend: regionTrend(changes).trend },
      ];
    }),
  ) as Record<ScalpView, RegionTrend>;
}
