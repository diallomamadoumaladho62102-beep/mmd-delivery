/**
 * Comparaison côte à côte MMD vs Waze (référence locale).
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mmdPath = path.join(
  root,
  "docs/screenshots/driver-navigation-qa-full-follow.png",
);
const refCandidates = [
  "docs/screenshots/driver-navigation-waze-match.png",
  "docs/screenshots/driver-navigation-waze-reference.png",
];
const outPath = path.join(
  root,
  "docs/screenshots/driver-navigation-qa-waze-comparison.png",
);

const refPath = refCandidates
  .map((relative) => path.join(root, relative))
  .find((candidate) => fs.existsSync(candidate));

if (!fs.existsSync(mmdPath)) {
  throw new Error(`MMD capture missing: ${mmdPath}`);
}
if (!refPath) {
  throw new Error("Waze reference screenshot not found in docs/screenshots/");
}

const targetHeight = 1920;
const labelHeight = 56;
const gap = 12;

const [refMeta, mmdMeta] = await Promise.all([
  sharp(refPath).metadata(),
  sharp(mmdPath).metadata(),
]);

const refScale = targetHeight / (refMeta.height ?? targetHeight);
const mmdScale = targetHeight / (mmdMeta.height ?? targetHeight);
const refW = Math.round((refMeta.width ?? 1080) * refScale);
const mmdW = Math.round((mmdMeta.width ?? 1080) * mmdScale);
const panelW = Math.max(refW, mmdW);
const totalW = panelW * 2 + gap;
const totalH = targetHeight + labelHeight;

const labelSvg = (text, width) =>
  Buffer.from(
    `<svg width="${width}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#0A0A0A"/>
      <text x="${width / 2}" y="36" fill="#FFFFFF" font-family="Arial,sans-serif" font-size="22" font-weight="700" text-anchor="middle">${text}</text>
    </svg>`,
  );

const [refBuf, mmdBuf] = await Promise.all([
  sharp(refPath)
    .resize({ height: targetHeight, fit: "contain", background: "#000000" })
    .extend({
      top: 0,
      bottom: 0,
      left: 0,
      right: Math.max(0, panelW - refW),
      background: "#000000",
    })
    .toBuffer(),
  sharp(mmdPath)
    .resize({ height: targetHeight, fit: "contain", background: "#000000" })
    .extend({
      top: 0,
      bottom: 0,
      left: 0,
      right: Math.max(0, panelW - mmdW),
      background: "#000000",
    })
    .toBuffer(),
]);

await sharp({
  create: {
    width: totalW,
    height: totalH,
    channels: 3,
    background: "#000000",
  },
})
  .composite([
    { input: labelSvg("Waze (référence)", panelW), top: 0, left: 0 },
    { input: labelSvg("MMD Delivery", panelW), top: 0, left: panelW + gap },
    { input: refBuf, top: labelHeight, left: 0 },
    { input: mmdBuf, top: labelHeight, left: panelW + gap },
  ])
  .png()
  .toFile(outPath);

console.log("saved", outPath);
console.log("reference", path.relative(root, refPath));
