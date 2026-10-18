// Minimal TGA → PNG converter (no dependencies). CryBar's `bar export --convert`
// writes DDT textures as TGA, which browsers can't display.
// Supports uncompressed (type 2) and RLE (type 10) true-color, 24/32 bpp,
// plus grayscale (3/11, 8 bpp).
import { deflateSync } from 'node:zlib';

export function decodeTga(buf) {
  const idLen = buf[0];
  const cmapType = buf[1];
  const type = buf[2];
  const cmapLen = buf.readUInt16LE(5);
  const cmapDepth = buf[7];
  const w = buf.readUInt16LE(12);
  const h = buf.readUInt16LE(14);
  const bpp = buf[16];
  const desc = buf[17];
  if (![2, 3, 10, 11].includes(type)) throw new Error(`unsupported TGA type ${type}`);
  const gray = type === 3 || type === 11;
  const bytes = bpp / 8;
  if (gray ? bytes !== 1 : bytes !== 3 && bytes !== 4) throw new Error(`unsupported TGA depth ${bpp}`);
  let p = 18 + idLen + (cmapType ? cmapLen * Math.ceil(cmapDepth / 8) : 0);
  const px = Buffer.alloc(w * h * 4);
  const put = (i, o) => {
    if (gray) { px[o] = px[o + 1] = px[o + 2] = buf[i]; px[o + 3] = 255; return; }
    px[o] = buf[i + 2]; px[o + 1] = buf[i + 1]; px[o + 2] = buf[i];
    px[o + 3] = bytes === 4 ? buf[i + 3] : 255;
  };
  const n = w * h;
  if (type === 2 || type === 3) {
    for (let k = 0; k < n; k++, p += bytes) put(p, k * 4);
  } else {
    let k = 0;
    while (k < n) {
      const hdr = buf[p++];
      const count = (hdr & 0x7f) + 1;
      if (hdr & 0x80) {
        for (let j = 0; j < count && k < n; j++, k++) put(p, k * 4);
        p += bytes;
      } else {
        for (let j = 0; j < count && k < n; j++, k++, p += bytes) put(p, k * 4);
      }
    }
  }
  // TGA origin is bottom-left unless bit 5 of the descriptor is set
  if (!(desc & 0x20)) {
    const row = w * 4;
    const tmp = Buffer.alloc(row);
    for (let y = 0; y < h >> 1; y++) {
      const a = y * row, b = (h - 1 - y) * row;
      px.copy(tmp, 0, a, a + row); px.copy(px, a, b, b + row); tmp.copy(px, b);
    }
  }
  return { width: w, height: h, data: px };
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng({ width, height, data }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const tgaToPng = (buf) => encodePng(decodeTga(buf));
