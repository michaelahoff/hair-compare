import { useEffect, useState } from "react";

/**
 * Steps through `lines` every `everyMs` while `playing`, looping or stopping
 * at the last. Starts over whenever what the lines say, or `restart`, changes.
 */
export function useLines<T>(
  lines: T[],
  playing: boolean,
  {
    everyMs = 2600,
    loop = true,
    restart,
  }: { everyMs?: number; loop?: boolean; restart?: unknown } = {},
) {
  const [index, setIndex] = useState(0);
  // By content, so lines rebuilt on every render don't keep starting over.
  const said = JSON.stringify(lines);
  const [shown, setShown] = useState({ said, restart });
  if (shown.said !== said || shown.restart !== restart) {
    setShown({ said, restart });
    setIndex(0);
  }
  const count = lines.length;
  useEffect(() => {
    if (!playing || count < 2) return;
    const timer = setInterval(
      () =>
        setIndex((i) => (loop ? (i + 1) % count : Math.min(i + 1, count - 1))),
      everyMs,
    );
    return () => clearInterval(timer);
  }, [playing, said, count, everyMs, loop]);
  const at = Math.min(index, Math.max(0, lines.length - 1));
  return {
    line: lines[at] as T | undefined,
    index: at,
    next: () => setIndex((i) => (i + 1) % Math.max(1, lines.length)),
  };
}
