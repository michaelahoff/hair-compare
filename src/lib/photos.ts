import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { fromByteArray, toByteArray } from "base64-js";
import decode from "jpeg-js/lib/decoder";
import {
  align,
  rgbaToGray,
  type AlignResult,
  type GrayImage,
  type Similarity,
} from "./alignment";
import { warpImage } from "./alignment/image";
import { IDENTITY, baseBox, compose } from "./framing";

// Save a full-resolution display JPEG and a small working image for registration.
// Re-encoding strips camera metadata (including GPS) from files we store/upload.
export async function preparePhoto(uri: string, width: number, height: number) {
  if (
    width < 32 ||
    height < 32 ||
    width / height < 0.25 ||
    width / height > 4
  ) {
    throw new Error(
      "Choose a clear photo with a normal camera aspect ratio and at least 32 pixels on each side.",
    );
  }
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > 1800) {
    context.resize(width >= height ? { width: 1800 } : { height: 1800 });
  }
  const rendered = await context.renderAsync();
  try {
    const result = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.88,
      base64: true,
    });
    if (!result.base64)
      throw new Error(
        "The photo could not be prepared. Please choose another image.",
      );
    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
      bytes: toByteArray(result.base64),
    };
  } finally {
    rendered.release();
    context.release();
  }
}

type ImageSource = Parameters<typeof ImageManipulator.manipulate>[0];

/** Render a manipulation as a small JPEG and decode it to greyscale pixels. */
async function readGray(
  context: ReturnType<typeof ImageManipulator.manipulate>,
): Promise<GrayImage> {
  const image = await context.renderAsync();
  try {
    const result = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.9,
      base64: true,
    });
    if (!result.base64)
      throw new Error("Could not read photo pixels for alignment.");
    const decoded = decode(toByteArray(result.base64), {
      useTArray: true,
      maxResolutionInMP: 1,
    });
    return rgbaToGray(decoded.data, decoded.width, decoded.height);
  } finally {
    image.release();
    context.release();
  }
}

async function grayPhoto(uri: string) {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 96 });
  return readGray(context);
}

/**
 * Centre-crop an image to `aspect` (width / height), shrink it to `size`
 * pixels wide and read it as greyscale. Matches how a "cover" preview frames
 * the same image, so a stored photo and a live frame are compared like for like.
 */
export async function grayCrop(
  source: ImageSource,
  width: number,
  height: number,
  aspect: number,
  size: number,
): Promise<GrayImage> {
  const cropWidth = Math.min(width, Math.round(height * aspect));
  const cropHeight = Math.min(height, Math.round(width / aspect));
  const context = ImageManipulator.manipulate(source);
  context.crop({
    originX: Math.floor((width - cropWidth) / 2),
    originY: Math.floor((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  });
  context.resize({ width: size });
  return readGray(context);
}

/** Longest side a photo is read at for guide-space work. */
const GUIDE_SOURCE_MAX = 960;

/**
 * Render a photo onto its view's guide square, `size` pixels a side, as
 * `framing` places it, and read it as greyscale. `mask` is 0 where the photo
 * doesn't reach. The guide is unturned: both photos of a view share its
 * turn, so it is applied only when drawing.
 */
export async function guideGray(
  photo: { uri: string; width: number; height: number },
  framing: Similarity,
  size: number,
): Promise<{ image: GrayImage; mask: Uint8Array }> {
  const longest = Math.max(photo.width, photo.height);
  // Enough pixels that the photo isn't upsampled where it covers the guide.
  const target = Math.min(
    longest,
    GUIDE_SOURCE_MAX,
    Math.ceil(size * Math.max(1, framing.scale)),
  );
  const context = ImageManipulator.manipulate(photo.uri);
  context.resize(
    photo.width >= photo.height ? { width: target } : { height: target },
  );
  const source = await readGray(context);
  // Guide units → the photo's own width units: undo the framing, then the
  // photo's base size on the guide (see `baseBox`).
  const image = warpImage(
    source,
    compose(framing, { ...IDENTITY, scale: baseBox(photo).width }),
    size,
    size,
    Number.NaN,
  );
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < mask.length; i++) {
    if (Number.isNaN(image.data[i])) image.data[i] = 0;
    else mask[i] = 1;
  }
  return { image, mask };
}

export async function alignPhotos(
  reference: string,
  target: string,
): Promise<AlignResult> {
  const [ref, next] = await Promise.all([
    grayPhoto(reference),
    grayPhoto(target),
  ]);
  // Let the busy indicator paint before the bounded CPU search begins.
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  const result = align(ref, next);
  if (!Number.isFinite(result.score))
    throw new Error(
      "These images have too little detail to align. Adjust framing manually.",
    );
  return result;
}
export function jpegDataUri(bytes: Uint8Array): string {
  return `data:image/jpeg;base64,${fromByteArray(bytes)}`;
}
