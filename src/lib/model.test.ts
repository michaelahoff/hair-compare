import { describe, expect, test } from "bun:test";
import {
  elapsedDays,
  movePair,
  photoTimestamp,
  selectPhotoPair,
  validDate,
} from "./model";

describe("calendar dates", () => {
  test("rejects impossible dates and accepts leap days", () => {
    expect(validDate("2026-02-30")).toBe(false);
    expect(validDate("2026-02-29")).toBe(false);
    expect(validDate("2024-02-29")).toBe(true);
    expect(validDate("2026-13-01")).toBe(false);
    expect(validDate("2026-2-01")).toBe(false);
  });
  test("uses calendar days across daylight saving boundaries", () => {
    expect(elapsedDays("2026-03-07", "2026-03-09")).toBe(2);
    expect(elapsedDays("2026-10-31", "2026-11-02")).toBe(2);
    expect(elapsedDays("2026-10-03", "2026-10-02")).toBe(0);
  });
  test("photo timestamps preserve the chosen day without a timezone conversion", () => {
    expect(photoTimestamp("2026-01-01")).toBe("2026-01-01T12:00:00.000Z");
    expect(() => photoTimestamp("2026-02-30")).toThrow();
  });
});
describe("comparison selection after journal changes", () => {
  const photos = [{ id: "a" }, { id: "b" }, { id: "c" }];
  test("respects a preferred later photo and chooses an earlier baseline", () => {
    expect(selectPhotoPair(photos, null, null, "b")).toEqual({
      before: photos[0],
      after: photos[1],
    });
  });
  test("recovers a distinct pair when the selected later photo is deleted", () => {
    expect(selectPhotoPair(photos.slice(0, 2), "b", "c")).toEqual({
      before: photos[0],
      after: photos[1],
    });
  });
  test("repairs stale or reversed selections", () => {
    expect(selectPhotoPair(photos, "c", "b")).toEqual({
      before: photos[0],
      after: photos[1],
    });
    expect(selectPhotoPair(photos, "missing", "missing")).toEqual({
      before: photos[0],
      after: photos[2],
    });
  });
});
describe("moving one side of a comparison", () => {
  test("moves the chosen side when the order still holds", () => {
    expect(movePair(5, { before: 0, after: 4 }, "before", 2)).toEqual({
      before: 2,
      after: 4,
    });
    expect(movePair(5, { before: 1, after: 4 }, "after", 2)).toEqual({
      before: 1,
      after: 2,
    });
  });
  test("pushes the other side along so before stays earlier", () => {
    expect(movePair(5, { before: 0, after: 2 }, "before", 3)).toEqual({
      before: 3,
      after: 4,
    });
    expect(movePair(5, { before: 2, after: 4 }, "after", 1)).toEqual({
      before: 0,
      after: 1,
    });
  });
  test("stops at the ends of the timeline", () => {
    expect(movePair(5, { before: 3, after: 4 }, "before", 4)).toEqual({
      before: 3,
      after: 4,
    });
    expect(movePair(5, { before: 0, after: 1 }, "after", 0)).toEqual({
      before: 0,
      after: 1,
    });
  });
});
