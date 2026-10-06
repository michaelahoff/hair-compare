import { Text, View } from "react-native";
import { Card, Notice, SectionTitle, colors, s } from "./ui";
import type { Analysis } from "@/lib/model";

export function AnalysisCard({ analysis }: { analysis: Analysis }) {
  const result = analysis.result;
  const change = result.change_since_previous;
  const headline = [
    result.norwood_stage === "indeterminate"
      ? "Stage unclear"
      : `Norwood ${result.norwood_stage}`,
    `${result.confidence} confidence`,
    change.assessment !== "no_previous" && change.assessment,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <SectionTitle>Analysis</SectionTitle>
      <Card>
        <Text style={[s.body, { fontWeight: "700" }]}>{headline}</Text>
        {!result.photo_quality.usable && (
          <Notice error>Photo unusable for analysis.</Notice>
        )}
        <Text style={s.body}>{result.summary}</Text>
        {result.regions.map((region, index) => (
          <View
            key={`${region.area}-${index}`}
            style={{
              borderTopWidth: 1,
              borderColor: colors.line,
              paddingTop: 10,
              gap: 2,
            }}
          >
            <Text style={[s.body, { fontWeight: "600" }]}>
              {region.area.replaceAll("_", " ")}
              <Text style={{ color: colors.muted, fontWeight: "400" }}>
                {"  "}
                {region.box ? region.severity : "not visible"}
              </Text>
            </Text>
            <Text style={s.muted}>{region.observation}</Text>
          </View>
        ))}
        {change.assessment !== "no_previous" && (
          <Text style={s.muted}>{change.explanation}</Text>
        )}
        <Text style={s.muted}>{result.hair_length_effect}</Text>
        {!!result.photo_quality.issues.length && (
          <Text style={s.muted}>{result.photo_quality.issues.join(" ")}</Text>
        )}
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          AI estimate, not a diagnosis.
        </Text>
      </Card>
    </>
  );
}
