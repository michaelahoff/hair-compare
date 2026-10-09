import { StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  Path,
  RadialGradient,
  Stop,
  Text,
} from "react-native-svg";
import { guideArt, type GuideStyle } from "@/lib/guide-art";
import type { ScalpView } from "@/lib/model";

const HALO = "#0F1A17";
const DASH = "2.5 2.5";

/** A line in white over a dark halo, so it reads on light skin and dark hair. */
function Line({
  d,
  width,
  dashed,
}: {
  d: string;
  width: number;
  dashed?: boolean;
}) {
  const shared = {
    d,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeDasharray: dashed ? DASH : undefined,
  };
  return (
    <>
      <Path
        {...shared}
        stroke={HALO}
        strokeOpacity={0.45}
        strokeWidth={width * 2.2}
      />
      <Path
        {...shared}
        stroke="#FFFFFF"
        strokeOpacity={dashed ? 0.6 : 0.92}
        strokeWidth={width}
      />
    </>
  );
}

/**
 * The picture of a head that a view's photos line up against, drawn on the
 * guide square (side `size`) centred in the parent: the head, its ears and
 * hairline, the hair growing from the whorl, and rings to put landmarks in.
 * `hair` sets how strongly the strands show; keep it faint over a photo.
 */
export function Guide({
  view,
  turn,
  size,
  variant = "head",
  hair = 0.16,
}: {
  view: ScalpView;
  turn: number;
  size: number;
  /** The whole head, or the close-up of the whorl. */
  variant?: GuideStyle;
  hair?: number;
}) {
  const art = guideArt(view, variant);
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { alignItems: "center", justifyContent: "center" },
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="guide-skin" cx="50%" cy="45%" r="60%">
            <Stop offset="0" stopColor="#F6EBDD" stopOpacity={0.2} />
            <Stop offset="1" stopColor="#F6EBDD" stopOpacity={0.04} />
          </RadialGradient>
        </Defs>
        <G transform={`rotate(${turn * 90} 50 50)`}>
          {art.silhouette && (
            <>
              <Path d={art.silhouette} fill="url(#guide-skin)" />
              <Line d={art.silhouette} width={0.6} />
            </>
          )}
          <Path
            d={art.strands}
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity={hair}
            strokeWidth={0.28}
            strokeLinecap="round"
          />
          {art.features.map((feature, i) => (
            <Line
              key={i}
              d={feature.d}
              width={feature.bold ? 0.9 : 0.6}
              dashed={feature.dashed}
            />
          ))}
          {art.targets.map((target, i) => (
            <G key={i}>
              <Circle
                cx={target.x}
                cy={target.y}
                r={target.r}
                fill="none"
                stroke={HALO}
                strokeOpacity={0.45}
                strokeWidth={1.3}
                strokeDasharray={target.dashed ? DASH : undefined}
              />
              <Circle
                cx={target.x}
                cy={target.y}
                r={target.r}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={0.6}
                strokeDasharray={target.dashed ? DASH : undefined}
              />
            </G>
          ))}
          {art.label && (
            <Text
              x={50}
              y={5.6}
              fontSize={3.6}
              fontWeight="800"
              letterSpacing={0.4}
              fill="#FFFFFF"
              stroke={HALO}
              strokeWidth={0.25}
              textAnchor="middle"
            >
              {art.label}
            </Text>
          )}
        </G>
      </Svg>
    </View>
  );
}
