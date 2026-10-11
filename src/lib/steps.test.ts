import { describe, expect, test } from "bun:test";

import { oneAtATime, runSteps, runStepsAsync, type Steps } from "./steps";

function* count(n: number): Steps<number> {
  let total = 0;
  for (let i = 1; i <= n; i++) {
    yield;
    total += i;
  }
  return total;
}

describe("runSteps", () => {
  test("runs every stage and returns the result", () => {
    expect(runSteps(count(4))).toBe(10);
    expect(runSteps(count(0))).toBe(0);
  });
});

describe("runStepsAsync", () => {
  test("pauses once per yield and returns the same result", async () => {
    let pauses = 0;
    const result = await runStepsAsync(count(4), async () => {
      pauses++;
    });
    expect(result).toBe(10);
    expect(pauses).toBe(4);
  });

  test("rejects when a stage throws", async () => {
    function* boom(): Steps<number> {
      yield;
      throw new Error("stage failed");
    }
    await expect(runStepsAsync(boom(), async () => {})).rejects.toThrow("stage failed");
  });
});

describe("oneAtATime", () => {
  test("runs jobs in order, one after another, and survives a failure", async () => {
    const order: string[] = [];
    const job = (name: string, ms: number) => () =>
      new Promise<string>((resolve) =>
        setTimeout(() => {
          order.push(name);
          resolve(name);
        }, ms),
      );
    const slow = oneAtATime(job("slow", 20));
    const failed = oneAtATime(async () => {
      order.push("failed");
      throw new Error("no");
    });
    const fast = oneAtATime(job("fast", 1));
    await expect(failed).rejects.toThrow("no");
    expect(await slow).toBe("slow");
    expect(await fast).toBe("fast");
    expect(order).toEqual(["slow", "failed", "fast"]);
  });
});
