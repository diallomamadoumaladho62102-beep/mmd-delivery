/**
 * Génère assets/driver-navigation-arrow.png — flèche navigation MMD (112×58, style Waze).
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetPath = path.join(root, "apps/mobile/assets/driver-navigation-arrow.png");
const largePreviewPath = path.join(
  root,
  "docs/screenshots/driver-navigation-arrow-large.png",
);
const routePreviewPath = path.join(
  root,
  "docs/screenshots/driver-navigation-arrow-on-route.png",
);

/** Dimensions affichées CSS / asset logique. */
export const ARROW_W = 112;
export const ARROW_H = 58;

/** Canvas Mapbox — forme centrée x, ancrée bas (iconAnchor: bottom). */
export const CANVAS = 128;

export const ARROW_GEOMETRY = {
  tip: { x: 56, y: 0 },
  bottomLeft: { x: 0, y: 40 },
  bottomRight: { x: 112, y: 40 },
  reliefBottomY: 58,
  notch: { x: 56, y: 51 },
  yellow: { x: 9, y: 8, w: 94, h: 34 },
  checker: { x: 13, y: 32, w: 86, h: 10, rows: 2, cols: 11 },
  borderPx: 7,
  reliefPx: 15,
};

const COLORS = {
  yellowTop: [255, 228, 72],
  yellowBot: [248, 198, 38],
  white: [255, 255, 255],
  beigeTop: [245, 238, 220],
  beigeBot: [220, 206, 178],
  black: [16, 16, 16],
};

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
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function setPx(rgba, w, h, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  const alpha = a / 255;
  const dstA = rgba[i + 3] / 255;
  const outA = alpha + dstA * (1 - alpha);
  if (outA <= 0) return;
  rgba[i] = Math.round((r * alpha + rgba[i] * dstA * (1 - alpha)) / outA);
  rgba[i + 1] = Math.round((g * alpha + rgba[i + 1] * dstA * (1 - alpha)) / outA);
  rgba[i + 2] = Math.round((b * alpha + rgba[i + 2] * dstA * (1 - alpha)) / outA);
  rgba[i + 3] = Math.round(outA * 255);
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distPolyEdge(x, y, poly) {
  let min = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    min = Math.min(min, distSeg(x, y, a.x, a.y, b.x, b.y));
  }
  return min;
}

function sampleArc(cx, cy, r, a0, a1, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const a = lerp(a0, a1, t);
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** Triangle principal + pieds + creux — coords exactes 112×58. */
function buildReliefOutline(g, scale) {
  const s = scale;
  const cx = g.tip.x * s;
  const tipY = g.tip.y * s;
  const left = { x: g.bottomLeft.x * s, y: g.bottomLeft.y * s };
  const right = { x: g.bottomRight.x * s, y: g.bottomRight.y * s };
  const notch = { x: g.notch.x * s, y: g.notch.y * s };
  const bottomY = g.reliefBottomY * s;

  const tipRound = sampleArc(cx, tipY + 5 * s, 5 * s, -Math.PI * 0.92, -Math.PI * 0.08, 6);

  return [
    ...tipRound,
    { x: left.x + 3 * s, y: left.y - 1 * s },
    left,
    { x: left.x, y: bottomY },
    { x: 20 * s, y: bottomY },
    { x: notch.x - 16 * s, y: notch.y + 3 * s },
    notch,
    { x: notch.x + 16 * s, y: notch.y + 3 * s },
    { x: 92 * s, y: bottomY },
    { x: right.x, y: bottomY },
    { x: right.x, y: right.y - 1 * s },
    { x: right.x - 3 * s, y: right.y - 1 * s },
  ];
}

function buildTriangleUpper(g, scale) {
  const s = scale;
  return [
    { x: g.tip.x * s, y: (g.tip.y + 4) * s },
    { x: g.bottomLeft.x * s, y: g.bottomLeft.y * s },
    { x: g.bottomRight.x * s, y: g.bottomRight.y * s },
  ];
}

function buildInnerYellowRect(g, scale, inset) {
  const s = scale;
  return [
    { x: (g.yellow.x + inset) * s, y: (g.yellow.y + inset) * s },
    { x: (g.yellow.x + g.yellow.w - inset) * s, y: (g.yellow.y + inset) * s },
    { x: (g.yellow.x + g.yellow.w - inset) * s, y: (g.yellow.y + g.yellow.h - inset) * s },
    { x: (g.yellow.x + inset) * s, y: (g.yellow.y + g.yellow.h - inset) * s },
  ];
}

function roundedRectPoly(x, y, w, h, r, scale) {
  const s = scale;
  const rx = x * s;
  const ry = y * s;
  const rw = w * s;
  const rh = h * s;
  const rr = r * s;
  return [
    ...sampleArc(rx + rr, ry + rr, rr, Math.PI, Math.PI * 1.5, 4),
    ...sampleArc(rx + rw - rr, ry + rr, rr, Math.PI * 1.5, Math.PI * 2, 4).slice(1),
    ...sampleArc(rx + rw - rr, ry + rh - rr, rr, 0, Math.PI * 0.5, 4).slice(1),
    ...sampleArc(rx + rr, ry + rh - rr, rr, Math.PI * 0.5, Math.PI, 4).slice(1),
  ];
}

function fillPoly(rgba, w, h, poly, colorFn) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const edge = distPolyEdge(x + 0.5, y + 0.5, poly);
      const inside = pointInPoly(x + 0.5, y + 0.5, poly);
      if (!inside && edge > 1.1) continue;
      const [r, g, b, a = 255] = colorFn(x, y, edge, inside);
      setPx(rgba, w, h, x, y, r, g, b, a);
    }
  }
}

function drawChecker(rgba, w, h, g, scale) {
  const s = scale;
  const c = g.checker;
  const triangle = buildTriangleUpper(g, scale);
  const yellowPoly = roundedRectPoly(g.yellow.x, g.yellow.y, g.yellow.w, g.yellow.h, 10, scale);
  for (let row = 0; row < c.rows; row += 1) {
    for (let col = 0; col < c.cols; col += 1) {
      const x0 = Math.round((c.x + (col * c.w) / c.cols) * s);
      const y0 = Math.round((c.y + (row * c.h) / c.rows) * s);
      const x1 = Math.round((c.x + ((col + 1) * c.w) / c.cols) * s);
      const y1 = Math.round((c.y + ((row + 1) * c.h) / c.rows) * s);
      const dark = (row + col) % 2 === 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          if (!pointInPoly(x + 0.5, y + 0.5, yellowPoly)) continue;
          if (!pointInPoly(x + 0.5, y + 0.5, triangle)) continue;
          setPx(rgba, w, h, x, y, dark ? 12 : 252, dark ? 12 : 252, dark ? 12 : 252, 245);
        }
      }
    }
  }
}

function renderArrowLogical(scale) {
  const g = ARROW_GEOMETRY;
  const w = Math.round(ARROW_W * scale);
  const h = Math.round(ARROW_H * scale);
  const rgba = Buffer.alloc(w * h * 4, 0);
  const relief = buildReliefOutline(g, scale);
  const triangle = buildTriangleUpper(g, scale);
  const yellowOuter = roundedRectPoly(g.yellow.x - 1, g.yellow.y - 1, g.yellow.w + 2, g.yellow.h + 2, 11, scale);
  const yellowInner = roundedRectPoly(g.yellow.x, g.yellow.y, g.yellow.w, g.yellow.h, 10, scale);

  fillPoly(rgba, w, h, relief, (x, y, edge, inside) => {
    if (y <= g.bottomLeft.y * scale + 1 * scale) {
      const t = y / (g.reliefBottomY * scale);
      const [r, gr, b] = [
        Math.round(lerp(COLORS.beigeTop[0], COLORS.beigeBot[0], t * 0.5)),
        Math.round(lerp(COLORS.beigeTop[1], COLORS.beigeBot[1], t * 0.5)),
        Math.round(lerp(COLORS.beigeTop[2], COLORS.beigeBot[2], t * 0.5)),
      ];
      const alpha =
        inside && edge > 0.65 ? 255 : Math.round(Math.max(0, Math.min(1, 0.35 + edge * 0.65)) * 255);
      return [r, gr, b, alpha];
    }
    const t = y / (g.reliefBottomY * scale);
    const [r, gr, b] = [
      Math.round(lerp(COLORS.beigeTop[0], COLORS.beigeBot[0], t)),
      Math.round(lerp(COLORS.beigeTop[1], COLORS.beigeBot[1], t)),
      Math.round(lerp(COLORS.beigeTop[2], COLORS.beigeBot[2], t)),
    ];
    const alpha =
      inside && edge > 0.65 ? 255 : Math.round(Math.max(0, Math.min(1, 0.35 + edge * 0.65)) * 255);
    return [r, gr, b, alpha];
  });

  fillPoly(rgba, w, h, yellowOuter, (x, y, edge, inside) => {
    if (!pointInPoly(x, y, triangle)) return [0, 0, 0, 0];
    const alpha =
      inside && edge > 0.55 ? 255 : Math.round(Math.max(0, Math.min(1, 0.4 + edge * 0.6)) * 255);
    return [...COLORS.white, alpha];
  });

  fillPoly(rgba, w, h, yellowInner, (x, y, edge, inside) => {
    if (!pointInPoly(x, y, triangle)) return [0, 0, 0, 0];
    const t = (y - g.yellow.y * scale) / (g.yellow.h * scale);
    const [r, gr, b] = [
      Math.round(lerp(COLORS.yellowTop[0], COLORS.yellowBot[0], t)),
      Math.round(lerp(COLORS.yellowTop[1], COLORS.yellowBot[1], t)),
      Math.round(lerp(COLORS.yellowTop[2], COLORS.yellowBot[2], t)),
    ];
    const alpha =
      inside && edge > 0.55 ? 255 : Math.round(Math.max(0, Math.min(1, 0.4 + edge * 0.6)) * 255);
    return [r, gr, b, alpha];
  });

  drawChecker(rgba, w, h, g, scale);

  fillPoly(rgba, w, h, relief, (x, y, edge, inside) => {
    if (!inside || edge > 1.05) return [0, 0, 0, 0];
    if (edge < 0.95) return [255, 255, 255, Math.round(lerp(120, 255, 1 - edge))];
    return [0, 0, 0, 0];
  });

  return { rgba, w, h };
}

function downsampleBox(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4, 0);
  const rx = sw / dw;
  const ry = sh / dh;
  for (let y = 0; y < dh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = Math.floor(y * ry); sy < Math.floor((y + 1) * ry); sy += 1) {
        for (let sx = Math.floor(x * rx); sx < Math.floor((x + 1) * rx); sx += 1) {
          const si = (sy * sw + sx) * 4;
          const alpha = src[si + 3] / 255;
          if (alpha <= 0) continue;
          r += src[si] * alpha;
          g += src[si + 1] * alpha;
          b += src[si + 2] * alpha;
          a += alpha;
          n += 1;
        }
      }
      if (a <= 0) continue;
      const di = (y * dw + x) * 4;
      out[di] = Math.round(r / a);
      out[di + 1] = Math.round(g / a);
      out[di + 2] = Math.round(b / a);
      out[di + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

function embedInCanvas(rgba112, canvasSize) {
  const offsetX = Math.round((canvasSize - ARROW_W) / 2);
  const offsetY = canvasSize - ARROW_H;
  const out = Buffer.alloc(canvasSize * canvasSize * 4, 0);
  for (let y = 0; y < ARROW_H; y += 1) {
    for (let x = 0; x < ARROW_W; x += 1) {
      const si = (y * ARROW_W + x) * 4;
      const dx = offsetX + x;
      const dy = offsetY + y;
      const di = (dy * canvasSize + dx) * 4;
      out[di] = rgba112[si];
      out[di + 1] = rgba112[si + 1];
      out[di + 2] = rgba112[si + 2];
      out[di + 3] = rgba112[si + 3];
    }
  }
  return out;
}

function upscaleNearest(src, sw, sh, factor) {
  const dw = sw * factor;
  const dh = sh * factor;
  const out = Buffer.alloc(dw * dh * 4, 0);
  for (let y = 0; y < dh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      const sx = Math.min(sw - 1, Math.floor(x / factor));
      const sy = Math.min(sh - 1, Math.floor(y / factor));
      const si = (sy * sw + sx) * 4;
      const di = (y * dw + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return { rgba: out, w: dw, h: dh };
}

function drawRoutePreview(arrowRgba) {
  const pw = 560;
  const ph = 360;
  const rgba = Buffer.alloc(pw * ph * 4, 0);
  const road = [180, 188, 198];
  const cyan = [72, 196, 224];
  const green = [46, 204, 113];
  const cx = pw / 2;
  const cy = ph * 0.56;
  const lineW = 26;

  for (let y = 0; y < ph; y += 1) {
    for (let x = 0; x < pw; x += 1) {
      const d = Math.abs(x - cx);
      if (d <= lineW + 8) setPx(rgba, pw, ph, x, y, road[0], road[1], road[2], 255);
      if (y < cy && d <= lineW) setPx(rgba, pw, ph, x, y, green[0], green[1], green[2], 255);
      if (y >= cy && d <= lineW) setPx(rgba, pw, ph, x, y, cyan[0], cyan[1], cyan[2], 255);
    }
  }

  const ax = Math.round(cx - ARROW_W / 2);
  const ay = Math.round(cy - 4);
  for (let y = 0; y < ARROW_H; y += 1) {
    for (let x = 0; x < ARROW_W; x += 1) {
      const si = (y * ARROW_W + x) * 4;
      if (arrowRgba[si + 3] < 8) continue;
      setPx(rgba, pw, ph, ax + x, ay + y, arrowRgba[si], arrowRgba[si + 1], arrowRgba[si + 2], arrowRgba[si + 3]);
    }
  }
  return rgba;
}

const RENDER = 4;
const hi = renderArrowLogical(RENDER);
const arrow112Final = downsampleBox(
  hi.rgba,
  hi.w,
  hi.h,
  ARROW_W,
  ARROW_H,
);

const canvas128 = embedInCanvas(arrow112Final, CANVAS);
fs.mkdirSync(path.dirname(assetPath), { recursive: true });
fs.writeFileSync(assetPath, writePng(canvas128, CANVAS, CANVAS));

const large = upscaleNearest(arrow112Final, ARROW_W, ARROW_H, 5);
fs.mkdirSync(path.dirname(largePreviewPath), { recursive: true });
fs.writeFileSync(largePreviewPath, writePng(large.rgba, large.w, large.h));
fs.writeFileSync(routePreviewPath, writePng(drawRoutePreview(arrow112Final), 560, 360));

console.log("Wrote", assetPath, CANVAS, "x", CANVAS);
console.log("Wrote", largePreviewPath, large.w, "x", large.h);
console.log("Wrote", routePreviewPath);
console.log("TIP_CANVAS_Y", CANVAS - ARROW_H);
console.log("BASE_TRIANGLE_Y", CANVAS - ARROW_H + 40);
