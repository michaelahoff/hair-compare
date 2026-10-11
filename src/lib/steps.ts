/**
 * Long pixel jobs written once as generators that yield between stages, so
 * the same body can run straight through (tests, scripts) or pause between
 * stages (the app). On a phone this work runs on the JS thread, where a few
 * seconds without a break freezes every animation and tap; a pause of one
 * timer tick between stages lets those through.
 *
 * Pure TypeScript: no React or Expo imports.
 */
export type Steps<T> = Generator<void, T, void>;

/** Run every stage back to back. */
export function runSteps<T>(steps: Steps<T>): T {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** Run the stages with `pause` awaited between them. */
export async function runStepsAsync<T>(
  steps: Steps<T>,
  pause: () => Promise<void> = breathe,
): Promise<T> {
  let r = steps.next();
  while (!r.done) {
    await pause();
    r = steps.next();
  }
  return r.value;
}

/** Let queued events and timers through before carrying on. */
export function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let tail: Promise<unknown> = Promise.resolve();
/**
 * Run `job` after every job queued before it: one heavy pixel job at a time,
 * so a screen that asks for twenty photos' figures doesn't decode and
 * process twenty at once.
 */
export function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
