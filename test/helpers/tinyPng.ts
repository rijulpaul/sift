/**
 * A real PNG on disk, so tests that draw a picture have something to load.
 * Written by hand to avoid pulling an image library into the test suite.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value;
});

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
};

/** A gradient PNG of the given pixel size. */
function encodePng(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none

    for (let x = 0; x < width; x++) {
      const at = row + 1 + x * 4;
      raw[at] = Math.round((x * 255) / Math.max(1, width - 1));
      raw[at + 1] = Math.round((y * 255) / Math.max(1, height - 1));
      raw[at + 2] = 128;
      raw[at + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Write a PNG to a temp file and return its path. */
export function writeTinyPng(width = 200, height = 20): string {
  const directory = mkdtempSync(join(tmpdir(), "sift-image-"));
  const file = join(directory, "picture.png");
  writeFileSync(file, encodePng(width, height));
  return file;
}
