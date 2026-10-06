import type { ScalpAnalysis } from "../../supabase/functions/_shared/analysis";

export const validAnalysis: ScalpAnalysis = {
  photo_quality: { usable: true, issues: [] },
  norwood_stage: "indeterminate", confidence: "low", regions: [],
  hair_length_effect: "Conditions limit comparison.",
  change_since_previous: { assessment: "no_previous", explanation: "No baseline." },
  summary: "The visible view is limited.",
};
