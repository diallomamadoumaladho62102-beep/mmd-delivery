import assert from "node:assert/strict";
import {
  APP_COLORS,
  APP_CONTRAST_PAIRS,
  APP_HIT,
  APP_RADIUS,
  APP_SPACE,
  appColor,
} from "./appTheme";

/** Relative luminance for sRGB hex (#RRGGBB). */
function luminance(hex: string): number {
  const raw = hex.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const n = Number.parseInt(full, 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

assert.equal(appColor("accent"), APP_COLORS.accent);
assert.equal(APP_HIT.min >= 44, true);
assert.equal(APP_RADIUS.md >= 10, true);
assert.equal(APP_SPACE.lg, 16);

for (const pair of APP_CONTRAST_PAIRS) {
  const ratio = contrastRatio(pair.fg, pair.bg);
  assert.ok(
    ratio >= pair.min,
    `contrast ${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)} < ${pair.min}`
  );
}

console.log("appTheme tests passed");
