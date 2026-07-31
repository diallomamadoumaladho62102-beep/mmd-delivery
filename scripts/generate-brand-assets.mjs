#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const masterPath = path.join(root, "assets/brand/mmd-logo-master.png");
const expectedMasterSha256 =
  "78db52050f1ea56a510197d366a9cff2562927584fbdc4bcb8be09ef462a31e1";
const master = fs.readFileSync(masterPath);
const webBrand = path.join(root, "apps/web/public/brand");
const webIcons = path.join(webBrand, "icons");
const webApp = path.join(root, "apps/web/app");
const mobileAssets = path.join(root, "apps/mobile/assets");
const mobileBrand = path.join(mobileAssets, "brand");

for (const directory of [
  webBrand,
  webIcons,
  webApp,
  mobileAssets,
  mobileBrand,
]) {
  fs.mkdirSync(directory, { recursive: true });
}

const actualMasterSha256 = createHash("sha256").update(master).digest("hex");
if (actualMasterSha256 !== expectedMasterSha256) {
  throw new Error(
    `Official MMD master checksum mismatch. Expected ${expectedMasterSha256}, received ${actualMasterSha256}.`,
  );
}

const masterMetadata = await sharp(master).metadata();
if (masterMetadata.width !== 1024 || masterMetadata.height !== 1024) {
  throw new Error("Official MMD master must remain exactly 1024×1024.");
}

async function removeConnectedWhiteBackground() {
  const { data, info } = await sharp(master)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  const outside = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;

  const isBackgroundCandidate = (index) => {
    const offset = index * info.channels;
    return Math.min(data[offset], data[offset + 1], data[offset + 2]) >= 96;
  };
  const enqueue = (index) => {
    if (outside[index] || !isBackgroundCandidate(index)) return;
    outside[index] = 1;
    queue[queueEnd] = index;
    queueEnd += 1;
  };

  for (let x = 0; x < info.width; x += 1) {
    enqueue(x);
    enqueue((info.height - 1) * info.width + x);
  }
  for (let y = 0; y < info.height; y += 1) {
    enqueue(y * info.width);
    enqueue(y * info.width + info.width - 1);
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    if (x > 0) enqueue(index - 1);
    if (x < info.width - 1) enqueue(index + 1);
    if (y > 0) enqueue(index - info.width);
    if (y < info.height - 1) enqueue(index + info.width);
  }

  const rgba = Buffer.alloc(pixelCount * 4);
  for (let index = 0; index < pixelCount; index += 1) {
    const source = index * info.channels;
    const target = index * 4;
    const red = data[source];
    const green = data[source + 1];
    const blue = data[source + 2];

    if (!outside[index]) {
      rgba[target] = red;
      rgba[target + 1] = green;
      rgba[target + 2] = blue;
      rgba[target + 3] = 255;
      continue;
    }

    const alpha = Math.max(255 - red, 255 - green, 255 - blue);
    rgba[target] = red;
    rgba[target + 1] = green;
    rgba[target + 2] = blue;
    rgba[target + 3] = alpha;
  }

  return sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function detectArtworkBounds(transparentSource, padding = 24) {
  const { data, info } = await sharp(transparentSource)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset + 3] <= 2) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0 || maxY < 0)
    throw new Error("Official logo artwork was not detected.");
  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(info.width - 1, maxX + padding);
  const bottom = Math.min(info.height - 1, maxY + padding);
  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

const transparentMaster = await removeConnectedWhiteBackground();
const artworkBounds = await detectArtworkBounds(transparentMaster);
const croppedMaster = await sharp(transparentMaster)
  .extract(artworkBounds)
  .png({ compressionLevel: 9 })
  .toBuffer();

async function resizedArtwork(size, safeArea) {
  const target = Math.round(size * safeArea);
  const resized = await sharp(croppedMaster)
    .resize(target, target, { fit: "inside", withoutEnlargement: false })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const resizedMetadata = await sharp(resized).metadata();
  return { resized, resizedMetadata, target };
}

async function transparentSquare(size, safeArea = 0.88) {
  const { resized, resizedMetadata, target } = await resizedArtwork(
    size,
    safeArea,
  );
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: resized,
        left: Math.floor((size - (resizedMetadata.width ?? target)) / 2),
        top: Math.floor((size - (resizedMetadata.height ?? target)) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function opaqueAppIcon(size, safeArea = 0.82) {
  const { resized, resizedMetadata, target } = await resizedArtwork(
    size,
    safeArea,
  );
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 5, g: 8, b: 22, alpha: 1 },
    },
  })
    .composite([
      {
        input: resized,
        left: Math.floor((size - (resizedMetadata.width ?? target)) / 2),
        top: Math.floor((size - (resizedMetadata.height ?? target)) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function transparentMonochromeIcon(size, safeArea = 0.78) {
  const { data, info } = await sharp(croppedMaster)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i += 1) {
    const source = i * info.channels;
    const target = i * 4;
    rgba[target] = 255;
    rgba[target + 1] = 255;
    rgba[target + 2] = 255;
    rgba[target + 3] = data[source + 3];
  }
  const mask = await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .resize(Math.round(size * safeArea), Math.round(size * safeArea), {
      fit: "inside",
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const maskMetadata = await sharp(mask).metadata();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    },
  })
    .composite([
      {
        input: mask,
        left: Math.floor((size - (maskMetadata.width ?? size)) / 2),
        top: Math.floor((size - (maskMetadata.height ?? size)) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writeTransparentSquare(relativePath, size, safeArea = 0.88) {
  fs.writeFileSync(
    path.join(root, relativePath),
    await transparentSquare(size, safeArea),
  );
}

async function writeOpaqueIcon(relativePath, size, safeArea = 0.82) {
  fs.writeFileSync(
    path.join(root, relativePath),
    await opaqueAppIcon(size, safeArea),
  );
}

const webLogoPng = await sharp(croppedMaster)
  .resize({ width: 960, withoutEnlargement: false })
  .png({ compressionLevel: 9 })
  .toBuffer();
fs.writeFileSync(
  path.join(webBrand, "mmd-logo-transparent-v2.png"),
  webLogoPng,
);
fs.writeFileSync(path.join(mobileBrand, "mmd-logo-ui.png"), webLogoPng);
fs.writeFileSync(
  path.join(webBrand, "mmd-logo-transparent-v2.webp"),
  await sharp(webLogoPng)
    .webp({ quality: 94, smartSubsample: true })
    .toBuffer(),
);

fs.writeFileSync(path.join(mobileBrand, "mmd-logo.png"), webLogoPng);

await writeTransparentSquare(
  "apps/web/public/brand/email-logo-transparent-v2.png",
  512,
);
await writeTransparentSquare("apps/web/app/icon.png", 128, 0.92);
await writeOpaqueIcon("apps/web/app/apple-icon.png", 180, 0.8);
await writeTransparentSquare(
  "apps/web/public/favicon-transparent-v2-16.png",
  16,
  0.96,
);
await writeTransparentSquare(
  "apps/web/public/favicon-transparent-v2-32.png",
  32,
  0.94,
);
await writeTransparentSquare(
  "apps/web/public/favicon-transparent-v2-48.png",
  48,
  0.92,
);
await writeTransparentSquare(
  "apps/web/public/brand/icons/pwa-192-transparent-v2.png",
  192,
  0.86,
);
await writeTransparentSquare(
  "apps/web/public/brand/icons/pwa-512-transparent-v2.png",
  512,
  0.86,
);
await writeOpaqueIcon(
  "apps/web/public/brand/icons/maskable-192-transparent-v2.png",
  192,
  0.68,
);
await writeOpaqueIcon(
  "apps/web/public/brand/icons/maskable-512-transparent-v2.png",
  512,
  0.68,
);

await writeOpaqueIcon("apps/mobile/assets/icon.png", 1024, 0.8);
await writeOpaqueIcon("apps/mobile/assets/ios-marketing-icon.png", 1024, 0.8);
await writeTransparentSquare(
  "apps/mobile/assets/adaptive-icon.png",
  1024,
  0.68,
);
await writeTransparentSquare("apps/mobile/assets/splash-logo.png", 1024, 0.82);
fs.writeFileSync(
  path.join(mobileAssets, "monochrome-icon.png"),
  await transparentMonochromeIcon(1024, 0.72),
);
fs.writeFileSync(
  path.join(mobileAssets, "notification-icon.png"),
  await transparentMonochromeIcon(96, 0.8),
);

const socialLogo = await sharp(croppedMaster)
  .resize(500, 360, { fit: "inside", withoutEnlargement: false })
  .png({ compressionLevel: 9 })
  .toBuffer();
const socialCard = Buffer.from(`
  <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#ffffff"/>
        <stop offset="1" stop-color="#f8fafc"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <text x="650" y="245" font-family="Arial, sans-serif" font-size="68" font-weight="700" fill="#0f172a">MMD Delivery</text>
    <text x="650" y="320" font-family="Arial, sans-serif" font-size="34" font-weight="600" fill="#dc2626">We Deliver With Heart</text>
    <text x="650" y="382" font-family="Arial, sans-serif" font-size="24" fill="#475569">Taxi · Food · Package</text>
    <text x="650" y="422" font-family="Arial, sans-serif" font-size="24" fill="#475569">Marketplace · Business</text>
  </svg>
`);
const socialPng = await sharp(socialCard)
  .composite([{ input: socialLogo, left: 72, top: 135 }])
  .png({ compressionLevel: 9 })
  .toBuffer();
for (const filename of [
  "og-transparent-v2.png",
  "twitter-transparent-v2.png",
  "seo-transparent-v2.png",
]) {
  fs.writeFileSync(path.join(webBrand, filename), socialPng);
}

for (const legacyPath of [
  "apps/web/public/brand/mmd-logo.png",
  "apps/web/public/brand/mmd-logo.webp",
  "apps/web/public/brand/email-logo.png",
  "apps/web/public/brand/og-default.png",
  "apps/web/public/brand/twitter-card.png",
  "apps/web/public/brand/seo-default.png",
  "apps/web/public/brand/icons/pwa-192.png",
  "apps/web/public/brand/icons/pwa-512.png",
  "apps/web/public/brand/icons/maskable-192.png",
  "apps/web/public/brand/icons/maskable-512.png",
  "apps/web/public/favicon-16x16.png",
  "apps/web/public/favicon-32x32.png",
  "apps/web/public/favicon-48x48.png",
]) {
  fs.rmSync(path.join(root, legacyPath), { force: true });
}

for (const relativePath of [
  "assets/brand/mmd-logo-master.png",
  "apps/web/public/brand/mmd-logo-transparent-v2.png",
  "apps/web/public/brand/mmd-logo-transparent-v2.webp",
  "apps/web/public/brand/email-logo-transparent-v2.png",
  "apps/web/public/brand/og-transparent-v2.png",
  "apps/web/public/brand/twitter-transparent-v2.png",
  "apps/web/public/brand/seo-transparent-v2.png",
  "apps/web/app/icon.png",
  "apps/web/app/apple-icon.png",
  "apps/web/public/favicon-transparent-v2-16.png",
  "apps/web/public/favicon-transparent-v2-32.png",
  "apps/web/public/favicon-transparent-v2-48.png",
  "apps/web/public/brand/icons/pwa-192-transparent-v2.png",
  "apps/web/public/brand/icons/pwa-512-transparent-v2.png",
  "apps/web/public/brand/icons/maskable-192-transparent-v2.png",
  "apps/web/public/brand/icons/maskable-512-transparent-v2.png",
  "apps/mobile/assets/brand/mmd-logo.png",
  "apps/mobile/assets/brand/mmd-logo-ui.png",
  "apps/mobile/assets/icon.png",
  "apps/mobile/assets/ios-marketing-icon.png",
  "apps/mobile/assets/adaptive-icon.png",
  "apps/mobile/assets/monochrome-icon.png",
  "apps/mobile/assets/notification-icon.png",
  "apps/mobile/assets/splash-logo.png",
]) {
  const fullPath = path.join(root, relativePath);
  const metadata = await sharp(fullPath).metadata();
  const sizeKb = Math.round(fs.statSync(fullPath).size / 1024);
  console.log(
    `${relativePath}: ${metadata.width}x${metadata.height}, ${sizeKb}KB`,
  );
}
