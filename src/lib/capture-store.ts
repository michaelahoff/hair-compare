import type { LibraryPhoto } from "./library";
import type { ScalpView } from "./model";

/** A photo taken on the capture screen, waiting for the details form. */
export type Capture = {
  uri: string;
  width: number;
  height: number;
  view: ScalpView;
};

let pending: Capture | null = null;

export function setCapture(capture: Capture) {
  pending = capture;
}

/** Returns the pending capture once, then clears it. */
export function takeCapture(): Capture | null {
  const capture = pending;
  pending = null;
  return capture;
}

let imports: LibraryPhoto[] = [];

/** Library photos chosen on the single-photo form, handed to the import screen. */
export function setImports(photos: LibraryPhoto[]) {
  imports = photos;
}

/** Returns the pending imports once, then clears them. */
export function takeImports(): LibraryPhoto[] {
  const photos = imports;
  imports = [];
  return photos;
}
