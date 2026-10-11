import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import { readRgbPhoto } from "@/lib/photos";
import { pngDataUri, revealRgb } from "@/lib/scalp/reveal";
import { breathe, oneAtATime } from "@/lib/steps";
import type { Photo } from "@/lib/model";

/**
 * Width the revealed picture is made at. Fine hairs survive at this size
 * and the PNG stays a few megabytes.
 */
export const REVEAL_WIDTH = 720;

/**
 * One reveal at a time, with a pause between its stages, so the pair's two
 * reveals don't both decode at once and the screen keeps up.
 */
function reveal(photo: Photo, signal: AbortSignal): Promise<string> {
  return oneAtATime(async () => {
    // Nobody is looking any more: skip the work.
    if (signal.aborted) throw new Error("Cancelled");
    const rgb = await readRgbPhoto(photo, REVEAL_WIDTH);
    await breathe();
    const revealed = revealRgb(rgb);
    await breathe();
    return pngDataUri(revealed);
  });
}

export function revealQuery(photo: Photo | undefined, enabled = true) {
  return queryOptions({
    // Keyed by id, not uri: a signed-in account gets a fresh signed URL on
    // every journal read, and the picture behind it doesn't change.
    queryKey: ["reveal", photo?.id ?? null] as const,
    queryFn: enabled && photo ? ({ signal }) => reveal(photo, signal) : skipToken,
    staleTime: Infinity,
    // A 720-px PNG is a few megabytes as a data URI: unwatched ones go soon.
    gcTime: 2 * 60 * 1000,
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
