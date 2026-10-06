import * as ImagePicker from "expo-image-picker";
import {
  dateFromExif,
  dateFromFileName,
  exifFromJpeg,
  type TakenDate,
} from "./photo-date";

/** Most photos one import can take; each is prepared and uploaded in turn. */
export const IMPORT_LIMIT = 30;
// EXIF sits in the first 64 KB segment, after at most a few small headers.
const EXIF_SCAN_BYTES = 256 * 1024;

/** A library photo with when it was taken, if that could be discovered. */
export type LibraryPhoto = {
  uri: string;
  width: number;
  height: number;
  taken: TakenDate | null;
};

async function readExif(asset: ImagePicker.ImagePickerAsset) {
  if (asset.exif) return asset.exif;
  if (!asset.file) return null;
  try {
    const head = await asset.file.slice(0, EXIF_SCAN_BYTES).arrayBuffer();
    return exifFromJpeg(new Uint8Array(head));
  } catch {
    return null;
  }
}

async function takenDate(
  asset: ImagePicker.ImagePickerAsset,
): Promise<TakenDate | null> {
  const fromExif = dateFromExif(await readExif(asset));
  if (fromExif) return { date: fromExif, source: "metadata" };
  const fromName = dateFromFileName(asset.fileName ?? asset.file?.name);
  return fromName ? { date: fromName, source: "filename" } : null;
}

/** Choose up to `limit` library photos and read when each one was taken. */
export async function pickLibraryPhotos(
  limit: number,
): Promise<LibraryPhoto[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
    allowsEditing: false,
    // Read only for the taken date: photos are re-encoded without EXIF on save.
    exif: true,
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    orderedSelection: true,
  });
  if (result.canceled) return [];
  return Promise.all(
    // Not every Android picker enforces the limit.
    result.assets.slice(0, limit).map(async (asset) => ({
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      taken: await takenDate(asset),
    })),
  );
}
