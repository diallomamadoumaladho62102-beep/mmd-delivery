#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const masterPath = path.join(root, "apps/mobile/assets/brand/mmd-logo.png");
const master = fs.readFileSync(masterPath);
const webBrand = path.join(root, "apps/web/public/brand");
const webApp = path.join(root, "apps/web/app");
const mobileAssets = path.join(root, "apps/mobile/assets");

async function square(size, format = "png") {
  const image = sharp(master).resize(size, size, {
    fit: "contain",
    withoutEnlargement: true,
  });
  return format === "webp"
    ? image.webp({ quality: 92 }).toBuffer()
    : image.png({ compressionLevel: 9 }).toBuffer();
}

fs.writeFileSync(path.join(webBrand, "mmd-logo.png"), await square(512));
fs.writeFileSync(
  path.join(webBrand, "mmd-logo.webp"),
  await square(512, "webp"),
);
fs.writeFileSync(path.join(webBrand, "email-logo.png"), await square(256));
fs.writeFileSync(path.join(webApp, "icon.png"), await square(128));
fs.writeFileSync(path.join(webApp, "apple-icon.png"), await square(180));
fs.writeFileSync(path.join(mobileAssets, "icon.png"), await square(1024));

const adaptiveLogo = await sharp(master)
  .resize(720, 720, { fit: "contain", withoutEnlargement: true })
  .png({ compressionLevel: 9 })
  .toBuffer();
const adaptive = await sharp({
  create: {
    width: 1024,
    height: 1024,
    channels: 4,
    background: { r: 255, g: 140, b: 0, alpha: 0 },
  },
})
  .composite([{ input: adaptiveLogo, left: 152, top: 152 }])
  .png({ compressionLevel: 9 })
  .toBuffer();
fs.writeFileSync(path.join(mobileAssets, "adaptive-icon.png"), adaptive);

const logoOg = await sharp(master)
  .resize(340, 340, { fit: "contain" })
  .png({ compressionLevel: 9 })
  .toBuffer();
const socialCard = Buffer.from(`
  <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#020617"/>
        <stop offset="1" stop-color="#111827"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <circle cx="1030" cy="80" r="240" fill="#f97316" opacity=".13"/>
    <text x="480" y="265" font-family="Arial, sans-serif" font-size="72" font-weight="700" fill="#fff">MMD Delivery</text>
    <text x="480" y="340" font-family="Arial, sans-serif" font-size="34" font-weight="600" fill="#fb923c">We Deliver With Heart</text>
    <text x="480" y="400" font-family="Arial, sans-serif" font-size="25" fill="#cbd5e1">Taxi · Food · Package · Marketplace · Business</text>
  </svg>
`);
await sharp(socialCard)
  .composite([{ input: logoOg, left: 90, top: 145 }])
  .jpeg({ quality: 88, mozjpeg: true })
  .toFile(path.join(webBrand, "og-default.jpg"));

for (const relativePath of [
  "apps/web/public/brand/mmd-logo.png",
  "apps/web/public/brand/mmd-logo.webp",
  "apps/web/public/brand/email-logo.png",
  "apps/web/public/brand/og-default.jpg",
  "apps/web/app/icon.png",
  "apps/web/app/apple-icon.png",
  "apps/mobile/assets/icon.png",
  "apps/mobile/assets/adaptive-icon.png",
]) {
  const fullPath = path.join(root, relativePath);
  const metadata = await sharp(fullPath).metadata();
  const sizeKb = Math.round(fs.statSync(fullPath).size / 1024);
  console.log(
    `${relativePath}: ${metadata.width}x${metadata.height}, ${sizeKb}KB`,
  );
}
