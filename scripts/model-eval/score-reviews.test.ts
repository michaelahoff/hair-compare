import { expect, test } from "bun:test";
import { summarizeReviews } from "./score-reviews";

const record = { reportId: "report-1", evidence: 2, uncertainty: 1, confounds: 2, clarity: 2, regions: null, critical: false, notes: "" };
const review = { version: 1, runId: "run-1", reviewer: "reviewer-a", records: [record] };
const mapping = [{ reportId: "report-1", modelAlias: "sonnet" }];

test("aggregates human ratings while keeping unscored criteria unknown", () => {
  const result = summarizeReviews("run-1", mapping, [review])[0];
  expect(result.criteria.evidence.mean).toBe(2);
  expect(result.criteria.regions.mean).toBeNull();
  expect(result.criteria.regions.rated).toBe(0);
});
test("rejects mixed runs, duplicate votes, unknown reports and invalid scores", () => {
  expect(() => summarizeReviews("other", mapping, [review])).toThrow("another run");
  expect(() => summarizeReviews("run-1", mapping, [review, review])).toThrow("Duplicate");
  expect(() => summarizeReviews("run-1", [], [review])).toThrow("unknown report");
  expect(() => summarizeReviews("run-1", mapping, [{ ...review, records: [{ ...record, evidence: 3 }] }])).toThrow();
});
