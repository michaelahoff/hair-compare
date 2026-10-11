import { describe, expect, test } from "bun:test";
import { toByteArray } from "base64-js";

import { adler32, crc32, encodePng, pngDataUri } from "./png";
import { createRgb } from "./rgb";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** Big-endian uint32 at `at`, relative to the start of the view. */
const u32 = (b: Uint8Array, at: number) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at);

describe("encodePng", () => {
  test("a 3x2 image starts with the signature and an IHDR of width 3, height 2, 8-bit RGB", () => {
    const png = encodePng(createRgb(3, 2));
    expect(Array.from(png.slice(0, 8))).toEqual(SIGNATURE);
    expect(u32(png, 8)).toBe(13);
    expect(Array.from(png.slice(12, 16))).toEqual(ascii("IHDR"));
    expect(u32(png, 16)).toBe(3);
    expect(u32(png, 20)).toBe(2);
    // bit depth 8, colour type 2 (RGB), compression 0, filter 0, interlace 0
    expect(Array.from(png.slice(24, 29))).toEqual([8, 2, 0, 0, 0]);
    // The CRC covers the chunk type and data.
    expect(u32(png, 29)).toBe(crc32(png.slice(12, 29)));
  });

  test("the file ends with an empty IEND chunk", () => {
    const png = encodePng(createRgb(3, 2));
    expect(Array.from(png.slice(-12))).toEqual([
      0, 0, 0, 0, ...ascii("IEND"), 0xae, 0x42, 0x60, 0x82,
    ]);
  });

  test("the adler32 of the raw stream matches a hand computation", () => {
    // A 2x1 image with pixels (1,2,3) and (4,5,6). The raw stream is the filter
    // byte 0 then the pixels: [0, 1, 2, 3, 4, 5, 6]. Adler-32 starts A = 1 and
    // adds each byte: A = 1 + 21 = 22 = 0x16. B adds each running A:
    // 1 + 2 + 4 + 7 + 11 + 16 + 22 = 63 = 0x3F. The checksum is B * 65536 + A.
    const img = createRgb(2, 1);
    img.data.set([1, 2, 3, 4, 5, 6]);
    const png = encodePng(img);
    // IDAT chunk: after the 8-byte signature and the 25-byte IHDR chunk.
    expect(Array.from(png.slice(37, 41))).toEqual(ascii("IDAT"));
    const z = png.subarray(41, 41 + u32(png, 33));
    expect(Array.from(z.slice(0, 2))).toEqual([0x78, 0x01]);
    // One final stored block: LEN 7, NLEN 0xFFF8 (little-endian).
    expect(Array.from(z.slice(2, 7))).toEqual([1, 7, 0, 0xf8, 0xff]);
    expect(Array.from(z.slice(7, 14))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(u32(z, 14)).toBe(0x003f0016);
    expect(adler32(Uint8Array.from([0, 1, 2, 3, 4, 5, 6]))).toBe(0x003f0016);
  });

  test("raw data over 65535 bytes splits into stored blocks; only the last is final", () => {
    // 200 px wide: each row is 1 + 600 bytes, so 120 rows make 72120 raw bytes.
    const W = 200;
    const H = 120;
    const img = createRgb(W, H);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 7) % 251;
    const png = encodePng(img);
    const z = png.subarray(41, 41 + u32(png, 33));

    const blocks: { final: number; len: number; data: Uint8Array }[] = [];
    let p = 2;
    for (;;) {
      const final = z[p] & 1;
      const len = z[p + 1] | (z[p + 2] << 8);
      expect(z[p + 3] | (z[p + 4] << 8)).toBe(len ^ 0xffff);
      expect(len).toBeLessThanOrEqual(65535);
      blocks.push({ final, len, data: z.slice(p + 5, p + 5 + len) });
      p += 5 + len;
      if (final) break;
    }
    expect(blocks.map((b) => b.len)).toEqual([65535, 72120 - 65535]);
    expect(blocks.map((b) => b.final)).toEqual([0, 1]);
    expect(p + 4).toBe(z.length);

    const raw = new Uint8Array(72120);
    let o = 0;
    for (const b of blocks) {
      raw.set(b.data, o);
      o += b.len;
    }
    expect(u32(z, p)).toBe(adler32(raw));
    for (let y = 0; y < H; y++) {
      expect(raw[y * (3 * W + 1)]).toBe(0);
      const row = raw.subarray(y * (3 * W + 1) + 1, (y + 1) * (3 * W + 1));
      expect(Array.from(row)).toEqual(
        Array.from(img.data.subarray(y * 3 * W, (y + 1) * 3 * W)),
      );
    }
  });

  test("a non-positive size or a mismatched data length throws", () => {
    expect(() => encodePng(createRgb(0, 4))).toThrow();
    const bad = createRgb(2, 2);
    expect(() => encodePng({ ...bad, data: bad.data.subarray(1) })).toThrow();
  });
});

describe("crc32", () => {
  test("the CRC-32 of the ASCII string IEND is 0xAE426082", () => {
    expect(crc32(Uint8Array.from(ascii("IEND")))).toBe(0xae426082);
  });

  test("the standard check value of 123456789 is 0xCBF43926", () => {
    expect(crc32(Uint8Array.from(ascii("123456789")))).toBe(0xcbf43926);
  });
});

describe("pngDataUri", () => {
  test("is the base64 of encodePng", () => {
    const img = createRgb(5, 4);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 13) % 256;
    const uri = pngDataUri(img);
    const prefix = "data:image/png;base64,";
    expect(uri.startsWith(prefix)).toBe(true);
    expect(Array.from(toByteArray(uri.slice(prefix.length)))).toEqual(
      Array.from(encodePng(img)),
    );
  });
});
