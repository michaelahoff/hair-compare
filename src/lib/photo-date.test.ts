import { describe, expect, test } from "bun:test";
import { dateFromExif, dateFromFileName, exifFromJpeg } from "./photo-date";

const TODAY = "2026-10-06";

describe("dates from EXIF tags", () => {
  test("prefers the original capture time and keeps the local day", () => {
    expect(
      dateFromExif(
        {
          DateTime: "2025:01:02 09:00:00",
          DateTimeOriginal: "2024:03:15 23:59:59",
        },
        TODAY,
      ),
    ).toBe("2024-03-15");
  });
  test("falls back past blank, impossible and future values", () => {
    expect(
      dateFromExif(
        {
          DateTimeOriginal: "0000:00:00 00:00:00",
          DateTimeDigitized: "2030:01:01 10:00:00",
          DateTime: "2024-02-29 08:00:00",
        },
        TODAY,
      ),
    ).toBe("2024-02-29");
    expect(dateFromExif({ DateTimeOriginal: 1710000000 }, TODAY)).toBeNull();
    expect(dateFromExif(null, TODAY)).toBeNull();
  });
});

describe("dates from file names", () => {
  test.each([
    ["IMG_20240315_142201.jpg", "2024-03-15"],
    ["PXL_20240315_142201123.MP.jpg", "2024-03-15"],
    ["IMG-20240315-WA0001.jpeg", "2024-03-15"],
    ["Screenshot 2024-03-15 at 14.22.01.png", "2024-03-15"],
    ["20240315142201.jpg", "2024-03-15"],
    ["photo 2024.03.15.jpg", "2024-03-15"],
  ])("%s", (name, date) => {
    expect(dateFromFileName(name, TODAY)).toBe(date);
  });
  test.each([
    "IMG_2031.HEIC",
    "1712345678901.jpg",
    "2024-03_15.jpg",
    "IMG_20241345.jpg",
    "IMG_20991231.jpg",
  ])("rejects %s", (name) => {
    expect(dateFromFileName(name, TODAY)).toBeNull();
  });
});

/** A minimal JPEG whose EXIF holds DateTime in IFD0 and DateTimeOriginal in the Exif IFD. */
function jpegWithExif(little: boolean) {
  const tiff = new DataView(new ArrayBuffer(100));
  const u16 = (at: number, v: number) => tiff.setUint16(at, v, little);
  const u32 = (at: number, v: number) => tiff.setUint32(at, v, little);
  const text = (at: number, v: string) =>
    [...v].forEach((c, i) => tiff.setUint8(at + i, c.charCodeAt(0)));
  const entry = (
    at: number,
    tag: number,
    type: number,
    count: number,
    value: number,
  ) => {
    u16(at, tag);
    u16(at + 2, type);
    u32(at + 4, count);
    u32(at + 8, value);
  };
  text(0, little ? "II" : "MM");
  u16(2, 42);
  u32(4, 8);
  // IFD0 at 8: DateTime and the Exif IFD pointer.
  u16(8, 2);
  entry(10, 0x0132, 2, 20, 50);
  entry(22, 0x8769, 4, 1, 36);
  u32(34, 0);
  // Exif IFD at 36: DateTimeOriginal.
  u16(36, 1);
  entry(38, 0x9003, 2, 20, 70);
  text(50, "2025:01:02 09:00:00\0");
  text(70, "2024:03:15 14:22:01\0");
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const exifHeader = [..."Exif\0\0"].map((c) => c.charCodeAt(0));
  const size = 2 + exifHeader.length + tiff.byteLength;
  return new Uint8Array([
    0xff,
    0xd8,
    ...app0,
    0xff,
    0xe1,
    size >> 8,
    size & 0xff,
    ...exifHeader,
    ...new Uint8Array(tiff.buffer),
    0xff,
    0xda,
  ]);
}

describe("reading EXIF from JPEG bytes", () => {
  test.each([true, false])("little endian: %p", (little) => {
    const tags = exifFromJpeg(jpegWithExif(little));
    expect(tags).toEqual({
      DateTime: "2025:01:02 09:00:00",
      DateTimeOriginal: "2024:03:15 14:22:01",
    });
    expect(dateFromExif(tags, TODAY)).toBe("2024-03-15");
  });
  test("tolerates truncated files and non-JPEGs", () => {
    const bytes = jpegWithExif(true);
    expect(exifFromJpeg(bytes.subarray(0, 40))).toEqual({});
    expect(exifFromJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({});
    expect(exifFromJpeg(new Uint8Array())).toEqual({});
  });
});
