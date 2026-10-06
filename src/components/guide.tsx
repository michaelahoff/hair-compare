import { StyleSheet, View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Text } from "react-native-svg";
import type { ScalpView } from "@/lib/model";

type Shape =
  | { kind: "path"; d: string; dashed?: boolean }
  | { kind: "circle"; cx: number; cy: number; r: number; dashed?: boolean }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number };

const MIDLINE: Shape = { kind: "path", d: "M50 10V96", dashed: true };
const TEMPLE: Shape[] = [
  // Hairline sweeping back into a recessed temple, then down the sideburn.
  { kind: "path", d: "M8 30Q30 22 48 30Q60 36 64 46Q66 58 70 72" },
  // Eyebrow and the outer corner of the eye.
  { kind: "path", d: "M14 76Q28 68 44 74" },
  { kind: "path", d: "M24 86Q32 82 40 86" },
  // Reference lines through the deepest point of the temple.
  { kind: "path", d: "M64 4V96", dashed: true },
  { kind: "path", d: "M4 46H96", dashed: true },
];

/**
 * Templates on a 100 × 100 square, with the front of the head (or, for face
 * views, the top of the head) at the top before the view's turn is applied.
 */
const GUIDES: Record<ScalpView, { shapes: Shape[]; label?: string }> = {
  top: {
    label: "FRONT",
    shapes: [
      { kind: "ellipse", cx: 50, cy: 54, rx: 36, ry: 42 },
      MIDLINE,
      // Front hairline, and the vertex at the centre.
      { kind: "path", d: "M26 28Q50 10 74 28" },
      { kind: "circle", cx: 50, cy: 54, r: 5 },
    ],
  },
  crown: {
    label: "FRONT",
    shapes: [
      { kind: "circle", cx: 50, cy: 52, r: 42 },
      MIDLINE,
      { kind: "path", d: "M8 52H92", dashed: true },
      // Whorl target.
      { kind: "circle", cx: 50, cy: 52, r: 6 },
      { kind: "circle", cx: 50, cy: 52, r: 16, dashed: true },
    ],
  },
  hairline: {
    shapes: [
      // Sides of the head, hairline with temple recessions, then the brows.
      { kind: "path", d: "M10 96C6 50 20 6 50 6C80 6 94 50 90 96" },
      { kind: "path", d: "M18 46Q24 30 34 34Q50 26 66 34Q76 30 82 46" },
      { kind: "path", d: "M24 82Q34 75 44 80" },
      { kind: "path", d: "M56 80Q66 75 76 82" },
      MIDLINE,
      { kind: "path", d: "M4 34H96", dashed: true },
    ],
  },
  // The subject faces the camera, so their left temple is on the right.
  left_temple: { shapes: TEMPLE },
  right_temple: { shapes: TEMPLE },
};

function Shapes({ shapes, ...stroke }: { shapes: Shape[] } & StrokeProps) {
  return shapes.map((shape, i) => {
    const dash = "dashed" in shape && shape.dashed ? "3 3" : undefined;
    const props = { ...stroke, strokeDasharray: dash, fill: "none" };
    if (shape.kind === "path") return <Path key={i} d={shape.d} {...props} />;
    if (shape.kind === "circle")
      return (
        <Circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} {...props} />
      );
    return (
      <Ellipse
        key={i}
        cx={shape.cx}
        cy={shape.cy}
        rx={shape.rx}
        ry={shape.ry}
        {...props}
      />
    );
  });
}
type StrokeProps = { stroke: string; strokeWidth: number; opacity: number };

/**
 * The ghost outline photos of a view are lined up against, drawn on the
 * guide square (side `size`) centred in the parent.
 */
export function Guide({
  view,
  turn,
  size,
}: {
  view: ScalpView;
  turn: number;
  size: number;
}) {
  const guide = GUIDES[view];
  const mirror = view === "right_temple" ? "translate(100 0) scale(-1 1)" : "";
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { alignItems: "center", justifyContent: "center" },
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <G transform={`rotate(${turn * 90} 50 50) ${mirror}`}>
          {/* A dark halo keeps the white lines legible on light skin. */}
          <Shapes
            shapes={guide.shapes}
            stroke="#0F1A17"
            strokeWidth={1.4}
            opacity={0.45}
          />
          <Shapes
            shapes={guide.shapes}
            stroke="#FFFFFF"
            strokeWidth={0.6}
            opacity={0.9}
          />
          {guide.label && (
            <Text
              x={50}
              y={7.5}
              fontSize={4.5}
              fontWeight="800"
              letterSpacing={0.4}
              fill="#FFFFFF"
              stroke="#0F1A17"
              strokeWidth={0.25}
              textAnchor="middle"
            >
              {guide.label}
            </Text>
          )}
        </G>
      </Svg>
    </View>
  );
}
