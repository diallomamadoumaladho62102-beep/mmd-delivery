/**
 * Generate high-resolution printable QR codes (PNG + SVG) for official socials.
 *
 * Usage: node scripts/generate-social-qr.mjs
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const require = createRequire(resolve(root, "package.json"));

const targets = [
  {
    stem: "website",
    url: "https://www.mmddelivery.com",
  },
  {
    stem: "tiktok",
    url: "https://www.tiktok.com/@mmddelivery",
  },
  {
    stem: "tiktok-share",
    url: "https://www.tiktok.com/@mmddelivery?_r=1&_t=ZP-98awmQSESJ5",
  },
  {
    stem: "instagram",
    url: "https://www.instagram.com/mmddelivery?igsh=d3o1YXR3M3g1Z3dq&utm_source=ig_contact_invite",
  },
  {
    stem: "facebook",
    url: "https://www.facebook.com/share/1FF11rBXwE/?mibextid=wwXIfr",
  },
];

const outDirs = [
  resolve(root, "assets/brand/qr"),
  resolve(root, "apps/web/public/brand/qr"),
  resolve(root, "apps/mobile/assets/brand/qr"),
];

for (const dir of outDirs) mkdirSync(dir, { recursive: true });

async function loadQrcode() {
  try {
    return require("qrcode");
  } catch {
    console.log("Installing qrcode…");
    const r = spawnSync("pnpm", ["add", "-Dw", "qrcode"], {
      cwd: root,
      shell: true,
      stdio: "inherit",
    });
    if (r.status !== 0) {
      throw new Error("Failed to install qrcode");
    }
    return require(resolve(root, "node_modules/qrcode"));
  }
}

const QRCode = await loadQrcode();
void pathToFileURL;
const masterDir = outDirs[0];

for (const target of targets) {
  const pngPath = resolve(masterDir, `${target.stem}.png`);
  const svgPath = resolve(masterDir, `${target.stem}.svg`);

  const png = await QRCode.toBuffer(target.url, {
    type: "png",
    width: 2048,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#0f172a", light: "#ffffff" },
  });
  writeFileSync(pngPath, png);

  const svg = await QRCode.toString(target.url, {
    type: "svg",
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#0f172a", light: "#ffffff" },
  });
  writeFileSync(svgPath, svg, "utf8");

  // Manifest sidecar for print tooling
  writeFileSync(
    resolve(masterDir, `${target.stem}.json`),
    JSON.stringify(
      {
        stem: target.stem,
        url: target.url,
        widthPx: 2048,
        errorCorrectionLevel: "H",
        formats: ["png", "svg"],
      },
      null,
      2,
    ),
    "utf8",
  );

  for (const dir of outDirs.slice(1)) {
    copyFileSync(pngPath, resolve(dir, `${target.stem}.png`));
    copyFileSync(svgPath, resolve(dir, `${target.stem}.svg`));
  }

  console.log(`generated ${target.stem} → ${target.url}`);
}

// Index for marketing kits
const index = {
  generatedAt: new Date().toISOString(),
  targets: targets.map((t) => ({
    ...t,
    png: `/brand/qr/${t.stem}.png`,
    svg: `/brand/qr/${t.stem}.svg`,
  })),
  kits: [
    "business-cards",
    "referral-cards",
    "loyalty-cards",
    "flyers",
    "posters",
    "restaurant-materials",
    "driver-welcome-kit",
    "merchant-kit",
    "vehicle-stickers",
    "roll-up-banners",
    "presentation-slides",
    "brochures",
    "email-signatures",
    "packaging-inserts",
  ],
};
writeFileSync(
  resolve(masterDir, "index.json"),
  JSON.stringify(index, null, 2),
  "utf8",
);
copyFileSync(
  resolve(masterDir, "index.json"),
  resolve(outDirs[1], "index.json"),
);

console.log("QR generation complete");
console.log(
  "master:",
  existsSync(resolve(masterDir, "website.png")) ? masterDir : "missing",
);
