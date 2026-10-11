import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import { readRgbPhoto } from "@/lib/photos";
import { pngDataUri, revealRgb } from "@/lib/scalp/reveal";
import type { Photo } from "@/lib/model";

/**
 * Width the revealed picture is made at. Fine hairs survive at this size
 * and the PNG stays a few megabytes.
 */
export const REVEAL_WIDTH = 720;

/** Let the screen paint before the pixel work starts. */
function afterPaint() {
  return new Promise<void>((resolve) =>
    typeof requestIdleCallback === "function"
      ? requestIdleCallback(() => resolve(), { timeout: 200 })
      : setTimeout(resolve, 16),
  );
}

async function reveal(photo: Photo): Promise<string> {
  const rgb = await readRgbPhoto(photo, REVEAL_WIDTH);
  await afterPaint();
  return pngDataUri(revealRgb(rgb));
}

export function revealQuery(photo: Photo | undefined, enabled = true) {
  return queryOptions({
    queryKey: ["reveal", photo?.id ?? null, photo?.uri ?? null] as const,
    queryFn: enabled && photo ? () => reveal(photo) : skipToken,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
}

/**
 * The photo with its local contrast evened out and fine detail sharpened,
 * as a data URI the same shape as the photo, so it sits in the same framing.
 * Grey hairs on pink skin and fine regrowth stand out; brightness is not
 * kept, so it is a view to look in, not a photo to keep.
 */
export function useReveal(photo: Photo | undefined, enabled = true) {
  return useQuery(revealQuery(photo, enabled));
}
