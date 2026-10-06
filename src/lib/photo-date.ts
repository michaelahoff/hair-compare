import { localDate, validDate } from "./model";

/** Where a photo's taken date came from. */
export type DateSource = "metadata" | "filename";
export type TakenDate = { date: string; source: DateSource };

export const DATE_SOURCE_NOTES: Record<DateSource | "missing", string> = {
  metadata: "Read from the photo",
  filename: "Guessed from the file name. Check it's right.",
  missing: "No date in this photo. Set when it was taken.",
};

// Ordered by how closely each tag tracks the moment the shutter fired.
const EXIF_DATE_TAGS = [
  "DateTimeOriginal",
  "DateTimeDigitized",
  "DateTime",
] as const;
const EARLIEST = "1990-01-01";

function plausible(year: string, month: string, day: string, today: string) {
  const date = `${year}-${month}-${day}`;
  return validDate(date) && date >= EARLIEST && date <= today ? date : null;
}

/** The calendar day a photo was taken, from its EXIF tags. */
export function dateFromExif(
  exif: Record<string, unknown> | null | undefined,
  today = localDate(),
): string | null {
  if (!exif) return null;
  for (const tag of EXIF_DATE_TAGS) {
    const value = exif[tag];
    // EXIF stores local wall-clock time ("YYYY:MM:DD HH:MM:SS"), so the day
    // is used as-is with no timezone conversion.
    const match =
      typeof value === "string"
        ? /^(\d{4})[:-](\d{2})[:-](\d{2})/.exec(value.trim())
        : null;
    const date = match && plausible(match[1], match[2], match[3], today);
    if (date) return date;
  }
  return null;
}

/** A date embedded in names like IMG_20240315_142201.jpg or 2024-03-15 14.22.01.png. */
export function dateFromFileName(
  name: string | null | undefined,
  today = localDate(),
): string | null {
  if (!name) return null;
  const pattern = /(?:^|\D)((?:19|20)\d{2})([-_.]?)(\d{2})\2(\d{2})/g;
  for (const match of name.matchAll(pattern)) {
    const date = plausible(match[1], match[3], match[4], today);
    if (date) return date;
  }
  return null;
}

const TIFF_DATE_TAGS: Record<number, string> = {
  0x0132: "DateTime",
  0x9003: "DateTimeOriginal",
  0x9004: "DateTimeDigitized",
};
const EXIF_IFD_POINTER = 0x8769;
const ASCII = 2;

function ascii(view: DataView, offset: number, length: number) {
  let text = "";
  for (let i = 0; i < length; i++) {
    const code = view.getUint8(offset + i);
    if (!code) break;
    text += String.fromCharCode(code);
  }
  return text;
}

/**
 * Read the date tags from a JPEG's EXIF block. The web picker has no EXIF
 * option, so the tags are read from the file itself. Tolerates truncated input.
 */
export function exifFromJpeg(bytes: Uint8Array): Record<string, string> {
  const tags: Record<string, string> = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (view.getUint16(0) !== 0xffd8) return tags;
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      // Metadata segments all precede the image data (start of scan).
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      if (marker === 0xffe1 && ascii(view, offset + 4, 4) === "Exif") {
        readTiff(view, offset + 10, tags);
        break;
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  } catch {
    // Truncated or malformed: keep whatever was read.
  }
  return tags;
}

function readTiff(view: DataView, start: number, tags: Record<string, string>) {
  const little = view.getUint16(start) === 0x4949;
  const u16 = (at: number) => view.getUint16(start + at, little);
  const u32 = (at: number) => view.getUint32(start + at, little);
  if (u16(2) !== 42) return;
  const readIfd = (ifd: number) => {
    let next: number | null = null;
    for (let i = 0; i < u16(ifd); i++) {
      const entry = ifd + 2 + i * 12;
      const tag = u16(entry);
      if (tag === EXIF_IFD_POINTER) next = u32(entry + 8);
      else if (TIFF_DATE_TAGS[tag] && u16(entry + 2) === ASCII) {
        const length = u32(entry + 4);
        const at = length > 4 ? u32(entry + 8) : entry + 8;
        tags[TIFF_DATE_TAGS[tag]] = ascii(view, start + at, length);
      }
    }
    return next;
  };
  const exifIfd = readIfd(u32(4));
  if (exifIfd !== null) readIfd(exifIfd);
}
