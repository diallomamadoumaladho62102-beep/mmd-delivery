/**
 * Recadre le véhicule depuis une capture navigation complète.
 * Usage: node scripts/crop-nav-zoom.mjs <input.png> <output.png>
 */
import fs from "fs";
import zlib from "zlib";

const NAV_ICON_SCREEN_RATIO = 0.632;
/** Ancre visuelle flèche avec pitch 3D (aligné driverNavigationVisual). */
const WAZE_ICON_MAP_ZONE_RATIO = 0.832;

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(path) {
  const buf = fs.readFileSync(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }

  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 4;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowIn = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const rowOut = Buffer.alloc(stride);
    const prev = y > 0 ? rows[y - 1] : null;
    for (let i = 0; i < stride; i += 1) {
      const x = rowIn[i];
      const a = i >= bpp ? rowOut[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      if (filter === 1) rowOut[i] = (x + a) & 255;
      else if (filter === 2) rowOut[i] = (x + b) & 255;
      else if (filter === 3) rowOut[i] = (x + Math.floor((a + b) / 2)) & 255;
      else if (filter === 4) rowOut[i] = (x + paeth(a, b, c)) & 255;
      else rowOut[i] = x;
    }
    rows.push(rowOut);
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const ri = x * bpp;
      rgba[i] = rows[y][ri];
      rgba[i + 1] = rows[y][ri + 1];
      rgba[i + 2] = rows[y][ri + 2];
      rgba[i + 3] = bpp === 4 ? rows[y][ri + 3] : 255;
    }
  }

  return { width, height, rgba };
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function writePng(rgba, width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crop(rgba, srcW, srcH, left, top, cropW, cropH) {
  const out = Buffer.alloc(cropW * cropH * 4);
  for (let y = 0; y < cropH; y += 1) {
    for (let x = 0; x < cropW; x += 1) {
      const sx = left + x;
      const sy = top + y;
      const si = (sy * srcW + sx) * 4;
      const oi = (y * cropW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= srcW || sy >= srcH) continue;
      rgba.copy(out, oi, si, si + 4);
    }
  }
  return out;
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node crop-nav-zoom.mjs <input.png> <output.png>");
  process.exit(1);
}

const { width, height, rgba } = decodePng(input);
const cropSize = Math.round(Math.min(width * 0.42, height * 0.28));
const centerX = Math.round(width / 2);
const centerY = Math.round(height * WAZE_ICON_MAP_ZONE_RATIO);
const left = Math.max(0, centerX - Math.round(cropSize / 2));
const top = Math.max(0, centerY - Math.round(cropSize * 0.62));
const cropW = Math.min(cropSize, width - left);
const cropH = Math.min(cropSize, height - top);
const cropped = crop(rgba, width, height, left, top, cropW, cropH);
fs.writeFileSync(output, writePng(cropped, cropW, cropH));
console.log("cropped", output, `${cropW}x${cropH}`, `at ${left},${top}`);
