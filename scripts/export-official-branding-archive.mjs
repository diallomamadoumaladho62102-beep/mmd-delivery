#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const archiveRoot = path.join(root, "docs", "branding-archive");
const outDir = path.join(archiveRoot, "MMD-Delivery-Official-Branding");
const zipPath = path.join(archiveRoot, "MMD-Delivery-Official-Branding.zip");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const bgArchiveName = "07-android-adaptive-icon-background-1024.png";
await sharp({
  create: {
    width: 1024,
    height: 1024,
    channels: 4,
    background: { r: 5, g: 8, b: 22, alpha: 1 },
  },
}).png({ compressionLevel: 9 }).toFile(path.join(outDir, bgArchiveName));

const entries = [
  {
    role: "Master logo (immutable approved source, 1024x1024, white-backed PNG)",
    projectPath: "assets/brand/mmd-logo-master.png",
    archiveName: "01-master-logo-source-1024.png",
    note: "Official immutable master. White background baked into file. Never redesign.",
  },
  {
    role: "Master logo (transparent production UI, highest transparent resolution)",
    projectPath: "apps/web/public/brand/mmd-logo-transparent-v2.png",
    archiveName: "02-master-logo-transparent-960x615.png",
    note: "Production transparent PNG used on Web/Mobile UI. Same bytes as apps/mobile/assets/brand/mmd-logo-ui.png.",
  },
  {
    role: "App icon 1024x1024",
    projectPath: "apps/mobile/assets/icon.png",
    archiveName: "03-app-icon-1024.png",
    note: "Android/iOS base app icon. Identical to iOS Marketing Icon.",
  },
  {
    role: "iOS Marketing Icon",
    projectPath: "apps/mobile/assets/ios-marketing-icon.png",
    archiveName: "04-ios-marketing-icon-1024.png",
    note: "Byte-identical to app icon.",
  },
  {
    role: "Android Adaptive Icon foreground",
    projectPath: "apps/mobile/assets/adaptive-icon.png",
    archiveName: "05-android-adaptive-icon-foreground-1024.png",
    note: "Transparent foreground for adaptive launcher icon.",
  },
  {
    role: "Monochrome Icon",
    projectPath: "apps/mobile/assets/monochrome-icon.png",
    archiveName: "06-android-monochrome-icon-1024.png",
    note: "Android 13+ themed icon mask.",
  },
  {
    role: "Android Adaptive Icon background",
    projectPath:
      "generated from app.config.ts android.adaptiveIcon.backgroundColor=#050816",
    archiveName: bgArchiveName,
    generated: true,
    note: "No source image exists in repo. Generated solid #050816 matching Expo/Android native colors.xml.",
  },
  {
    role: "Splash logo",
    projectPath: "apps/mobile/assets/splash-logo.png",
    archiveName: "08-splash-logo-1024.png",
    note: "Transparent splash artwork on #050816 splash backgroundColor.",
  },
  {
    role: "Notification icon",
    projectPath: "apps/mobile/assets/notification-icon.png",
    archiveName: "09-notification-icon-96.png",
    note: "Android status-bar notification glyph; tinted with #D90429.",
  },
  {
    role: "Favicon 48x48",
    projectPath: "apps/web/public/favicon-transparent-v2-48.png",
    archiveName: "10-favicon-48.png",
  },
  {
    role: "Favicon 32x32",
    projectPath: "apps/web/public/favicon-transparent-v2-32.png",
    archiveName: "11-favicon-32.png",
  },
  {
    role: "Favicon 16x16",
    projectPath: "apps/web/public/favicon-transparent-v2-16.png",
    archiveName: "12-favicon-16.png",
  },
  {
    role: "Open Graph image",
    projectPath: "apps/web/public/brand/og-transparent-v2.png",
    archiveName: "13-open-graph-1200x630.png",
  },
  {
    role: "Web app icon 128",
    projectPath: "apps/web/app/icon.png",
    archiveName: "14-web-app-icon-128.png",
  },
  {
    role: "Apple Touch Icon 180",
    projectPath: "apps/web/app/apple-icon.png",
    archiveName: "15-apple-touch-icon-180.png",
  },
  {
    role: "Email logo 512",
    projectPath: "apps/web/public/brand/email-logo-transparent-v2.png",
    archiveName: "16-email-logo-512.png",
  },
];

const manifestRows = [];
for (const entry of entries) {
  const dest = path.join(outDir, entry.archiveName);
  if (!entry.generated) {
    fs.copyFileSync(path.join(root, entry.projectPath), dest);
  }
  const buf = fs.readFileSync(dest);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const meta = await sharp(buf).metadata();
  manifestRows.push({
    role: entry.role,
    archiveName: entry.archiveName,
    projectPath: entry.projectPath,
    sha256,
    width: meta.width,
    height: meta.height,
    bytes: buf.length,
    hasAlpha: Boolean(meta.hasAlpha),
    note: entry.note || "",
  });
}

const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

const markdown = [
  "# MMD Delivery — Official Branding Archive",
  "",
  "Production branding snapshot for signed Android/iOS builds and the corporate website.",
  "",
  `- Git commit: \`${commit}\``,
  `- Generated: ${new Date().toISOString()}`,
  "- SVG master: **not available** in the repository (no official SVG source exists).",
  "- Adaptive icon background: solid color `#050816` (exported as PNG for archival).",
  "",
  "## Assets",
  "",
  "| Role | Archive file | Project path | Size | SHA-256 |",
  "|---|---|---|---|---|",
  ...manifestRows.map(
    (row) =>
      `| ${row.role} | \`${row.archiveName}\` | \`${row.projectPath}\` | ${row.width}×${row.height} (${row.bytes} bytes) | \`${row.sha256}\` |`,
  ),
  "",
  "## Notes",
  "",
  ...manifestRows
    .filter((row) => row.note)
    .map((row) => `- **${row.archiveName}**: ${row.note}`),
  "",
  "## SHA-256 checklist",
  "",
  ...manifestRows.map((row) => `${row.sha256}  ${row.archiveName}`),
  "",
].join("\n");

fs.writeFileSync(path.join(outDir, "MANIFEST.md"), markdown);
fs.writeFileSync(
  path.join(outDir, "SHA256SUMS.txt"),
  `${manifestRows.map((row) => `${row.sha256}  ${row.archiveName}`).join("\n")}\n`,
);
fs.writeFileSync(
  path.join(outDir, "manifest.json"),
  `${JSON.stringify(
    {
      commit,
      generatedAt: new Date().toISOString(),
      svgAvailable: false,
      adaptiveBackgroundColor: "#050816",
      assets: manifestRows,
    },
    null,
    2,
  )}\n`,
);

fs.rmSync(zipPath, { force: true });
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force`,
  ],
  { stdio: "inherit" },
);

const zipBytes = fs.statSync(zipPath).size;
const zipSha256 = createHash("sha256")
  .update(fs.readFileSync(zipPath))
  .digest("hex");

console.log(
  JSON.stringify(
    {
      zipPath: path.relative(root, zipPath).replaceAll("\\", "/"),
      zipSha256,
      zipBytes,
      folderPath: path.relative(root, outDir).replaceAll("\\", "/"),
      assetCount: manifestRows.length,
      commit,
      svgAvailable: false,
      assets: manifestRows,
    },
    null,
    2,
  ),
);
