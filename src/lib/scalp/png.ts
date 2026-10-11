/**
 * PNG encoding for the scalp images, in pure TypeScript. The pixels are stored
 * as uncompressed deflate blocks, so the file is much larger than a JPEG of
 * the same image, but it is lossless and needs no native code. The jpeg-js
 * encoder is not used: it calls Buffer.from, which the phone's Hermes engine
 * does not provide. No React, Expo or Node imports.
 */
import { fromByteArray } from "base64-js";

import type { RgbImage } from "./rgb";

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
/** Largest payload of one stored deflate block. */
const MAX_STORED = 65535;
const ADLER_BASE = 65521;
/** Bytes Adler-32 can add before its sums must be reduced. */
const ADLER_NMAX = 5552;

/** CRC-32 table for the reflected polynomial 0xEDB88320, built once. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** CRC-32 of the bytes, as PNG chunks use it. */
export function crc32(bytes: Uint8Array): number {
  let crc = -1; // 0xFFFFFFFF as a signed 32-bit value
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/** Adler-32 checksum of the bytes, as zlib uses it. */
export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let start = 0; start < bytes.length; start += ADLER_NMAX) {
    const end = Math.min(bytes.length, start + ADLER_NMAX);
    for (let i = start; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= ADLER_BASE;
    b %= ADLER_BASE;
  }
  return b * 65536 + a;
}

/** One PNG chunk: length, type, data, then the CRC of the type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * `raw` as a zlib stream of stored deflate blocks: the two-byte header, then
 * blocks of at most MAX_STORED bytes, each with its final flag, length and
 * one's complement length, then the Adler-32 of `raw`, big-endian.
 */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / MAX_STORED));
  const out = new Uint8Array(2 + raw.length + 5 * blocks + 4);
  out[0] = 0x78; // deflate, 32 KiB window
  out[1] = 0x01; // fastest level; 0x7801 is a multiple of 31
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * MAX_STORED;
    const len = Math.min(MAX_STORED, raw.length - start);
    const nlen = len ^ 0xffff;
    out[o] = b === blocks - 1 ? 1 : 0; // BFINAL in bit 0, BTYPE 00 (stored)
    out[o + 1] = len & 0xff;
    out[o + 2] = len >>> 8;
    out[o + 3] = nlen & 0xff;
    out[o + 4] = nlen >>> 8;
    out.set(raw.subarray(start, start + len), o + 5);
    o += 5 + len;
  }
  new DataView(out.buffer).setUint32(o, adler32(raw));
  return out;
}

/**
 * The image as PNG file bytes: 8-bit RGB (colour type 2), filter type 0 on
 * every scanline, one IDAT chunk. Throws on a non-positive size or on a data
 * length that does not match the size.
 */
export function encodePng(rgb: RgbImage): Uint8Array {
  const { width, height, data } = rgb;
  const sizeOk =
    Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1;
  if (!sizeOk) throw new RangeError(`encodePng: bad size ${width}x${height}`);
  if (data.length !== width * height * 3) {
    throw new RangeError("encodePng: data length does not match the size");
  }
  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    // The filter byte at the start of each row stays 0 (None).
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  // Compression, filter method and interlace are all 0, as the array starts.

  const chunks = [
    chunk("IHDR", header),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = SIGNATURE.length + chunks.reduce((n, c) => n + c.length, 0);
  const png = new Uint8Array(total);
  png.set(SIGNATURE, 0);
  let o = SIGNATURE.length;
  for (const c of chunks) {
    png.set(c, o);
    o += c.length;
  }
  return png;
}

/**
 * The image as a PNG data URI, for showing in an <Image> or a WebView. PNG is
 * lossless, so strands keep their exact pixels.
 */
export function pngDataUri(rgb: RgbImage): string {
  return `data:image/png;base64,${fromByteArray(encodePng(rgb))}`;
}
