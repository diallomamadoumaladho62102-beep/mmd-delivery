/**
 * Generate high-resolution printable QR codes (PNG + SVG) for official socials.
 * URLs come only from shared/socialLinks.ts (SSOT).
 *
 * Usage: pnpm brand:social-qr
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { SOCIAL_QR_TARGETS } from "../shared/socialLinks.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const require = createRequire(resolve(root, "package.json"));

const targets = SOCIAL_QR_TARGETS.map((t) => ({
  stem: t.fileStem,
  url: t.url,
  label: t.label,
  kits: t.kits,
}));

const outDirs = [
  resolve(root, "assets/brand/qr"),
  resolve(root, "apps/web/public/brand/qr"),
  resolve(root, "apps/mobile/assets/brand/qr"),
];

for (const dir of outDirs) mkdirSync(dir, { recursive: true });

function loadQrcode() {
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

const QRCode = loadQrcode();
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

  writeFileSync(
    resolve(masterDir, `${target.stem}.json`),
    JSON.stringify(
      {
        stem: target.stem,
        label: target.label,
        url: target.url,
        widthPx: 2048,
        errorCorrectionLevel: "H",
        formats: ["png", "svg"],
        kits: target.kits,
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

const index = {
  generatedAt: new Date().toISOString(),
  source: "shared/socialLinks.ts",
  targets: targets.map((t) => ({
    stem: t.stem,
    label: t.label,
    url: t.url,
    png: `/brand/qr/${t.stem}.png`,
    svg: `/brand/qr/${t.stem}.svg`,
    kits: t.kits,
  })),
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
