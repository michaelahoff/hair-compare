import { Platform } from "react-native";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import { colors } from "@/components/ui";
import { elapsedDays, type Photo, type ScalpView } from "@/lib/model";

/** How recently a region was photographed. */
export type Freshness = "none" | "fresh" | "aging" | "due";
/** Fresh within five weeks, due after three months. */
export function freshness(latest?: Photo): Freshness {
  if (!latest) return "none";
  const days = elapsedDays(latest.taken_at);
  return days <= 35 ? "fresh" : days <= 90 ? "aging" : "due";
}
export const FRESHNESS_LABEL: Record<Freshness, string> = {
  none: "Not started",
  fresh: "Up to date",
  aging: "Due soon",
  due: "Overdue",
};
export const FRESHNESS_COLOR: Record<Freshness, string> = {
  none: "#DCE3DE",
  fresh: colors.accent,
  aging: "#D9A784",
  due: colors.rust,
};
/** Text colour for a freshness label. */
export const FRESHNESS_TONE: Record<Freshness, string> = {
  none: colors.muted,
  fresh: colors.accent,
  aging: colors.rust,
  due: colors.rust,
};

// react-native-svg takes onPress natively and onClick on the web.
const press = (fn: () => void) =>
  (Platform.OS === "web" ? { onClick: fn } : { onPress: fn }) as object;

/**
 * A head seen from above, with each scalp region coloured by its freshness.
 * Regions are tappable; pair it with labelled controls for accessibility.
 */
export function HeadMap({
  size,
  selected,
  fresh,
  onSelect,
}: {
  size: number;
  selected: ScalpView;
  fresh: Record<ScalpView, Freshness>;
  onSelect: (view: ScalpView) => void;
}) {
  const paint = (view: ScalpView) => {
    const on = view === selected;
    return {
      fill: FRESHNESS_COLOR[fresh[view]],
      fillOpacity: fresh[view] === "fresh" && !on ? 0.85 : 1,
      stroke: on ? colors.ink : "transparent",
      strokeWidth: on ? 2.2 : 0,
      ...press(() => onSelect(view)),
    };
  };
  const hairline = paint("hairline");
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M45 14q5-6 10 0" stroke={colors.ink} strokeWidth={1.4} fill="none" />
      <Ellipse cx={50} cy={53} rx={33} ry={39} stroke={colors.ink} strokeWidth={1.4} fill={colors.surface} />
      <Path d="M17 44c-4 2-4 10 0 12 M83 44c4 2 4 10 0 12" stroke={colors.ink} strokeWidth={1.4} fill="none" />
      <Path
        d="M32 29Q50 16 68 29"
        fill="none"
        stroke={hairline.fill}
        strokeOpacity={hairline.fillOpacity}
        strokeWidth={selected === "hairline" ? 11 : 8}
        strokeLinecap="round"
        {...press(() => onSelect("hairline"))}
      />
      <Ellipse cx={26} cy={37} rx={6} ry={8.5} {...paint("left_temple")} />
      <Ellipse cx={74} cy={37} rx={6} ry={8.5} {...paint("right_temple")} />
      <Circle cx={50} cy={47} r={11.5} {...paint("top")} />
      <Circle cx={50} cy={72} r={10.5} {...paint("crown")} />
    </Svg>
  );
}
