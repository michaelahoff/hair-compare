import { describe, expect, test } from "bun:test";
import { assessmentInputs } from "./assessment-inputs";
import type { Journal, Photo, ScalpView, Treatment } from "./model";

function photo(id: string, view: ScalpView, taken_at: string): Photo {
  return {
    id,
    user_id: "local",
    view,
    taken_at,
    storage_path: `local/${id}.jpg`,
    width: 1200,
    height: 1600,
    hair_length: "short",
    hair_wet: false,
    notes: null,
    alignment: null,
    created_at: taken_at,
    uri: `file:///${id}.jpg`,
  };
}

function treatment(
  id: string,
  name: string,
  started_on: string,
  ended_on: string | null = null,
): Treatment {
  return {
    id,
    user_id: "local",
    name,
    kind: "oral",
    dosage: "1 mg",
    started_on,
    ended_on,
    notes: "private",
    created_at: started_on,
  };
}

function journal(photos: Photo[], treatments: Treatment[] = []): Journal {
  return { photos, treatments, analyses: [] };
}

describe("previous photo", () => {
  test("picks the latest earlier photo of the same view", () => {
    const current = photo("now", "top", "2026-04-01T12:00:00.000Z");
    const inputs = assessmentInputs(
      journal([
        photo("jan", "top", "2026-01-01T12:00:00.000Z"),
        photo("mar", "top", "2026-03-01T12:00:00.000Z"),
        photo("feb", "top", "2026-02-01T12:00:00.000Z"),
        current,
      ]),
      "now",
    );
    expect(inputs.photo).toEqual(current);
    expect(inputs.previous?.id).toBe("mar");
  });

  test("ignores other views and photos not taken before", () => {
    const inputs = assessmentInputs(
      journal([
        photo("crown", "crown", "2026-03-15T12:00:00.000Z"),
        photo("top", "top", "2026-03-01T12:00:00.000Z"),
        photo("same-day", "top", "2026-04-01T12:00:00.000Z"),
        photo("later", "top", "2026-05-01T12:00:00.000Z"),
        photo("now", "top", "2026-04-01T12:00:00.000Z"),
      ]),
      "now",
    );
    expect(inputs.previous?.id).toBe("top");
  });

  test("is null when no earlier photo of the same view exists", () => {
    const inputs = assessmentInputs(
      journal([
        photo("crown", "crown", "2026-03-15T12:00:00.000Z"),
        photo("now", "top", "2026-04-01T12:00:00.000Z"),
      ]),
      "now",
    );
    expect(inputs.previous).toBeNull();
  });

  test("throws when the photo is not in the journal", () => {
    expect(() => assessmentInputs(journal([]), "missing")).toThrow(
      "Photo not found.",
    );
  });
});

describe("treatments", () => {
  test("keeps treatments in force on the photo's day, oldest first", () => {
    const inputs = assessmentInputs(
      journal(
        [photo("now", "top", "2026-04-01T12:00:00.000Z")],
        [
          treatment("later", "Later", "2026-04-02"),
          treatment("b", "Minoxidil", "2026-02-10", "2026-03-01"),
          treatment("same-day", "Finasteride", "2026-04-01"),
          treatment("a", "Ketoconazole", "2025-12-01"),
        ],
      ),
      "now",
    );
    expect(inputs.treatments).toEqual([
      {
        name: "Ketoconazole",
        dosage: "1 mg",
        started_on: "2025-12-01",
        ended_on: null,
      },
      {
        name: "Minoxidil",
        dosage: "1 mg",
        started_on: "2026-02-10",
        ended_on: "2026-03-01",
      },
      {
        name: "Finasteride",
        dosage: "1 mg",
        started_on: "2026-04-01",
        ended_on: null,
      },
    ]);
  });

  test("passes only name, dosage and dates", () => {
    const [first] = assessmentInputs(
      journal(
        [photo("now", "top", "2026-04-01T12:00:00.000Z")],
        [treatment("a", "Minoxidil", "2026-02-10")],
      ),
      "now",
    ).treatments;
    expect(Object.keys(first ?? {}).sort()).toEqual([
      "dosage",
      "ended_on",
      "name",
      "started_on",
    ]);
  });
});
