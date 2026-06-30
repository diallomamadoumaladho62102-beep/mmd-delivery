/**
 * Capture finale navigation — vue complète + zoom flèche (Pixel 5, Metro 8086).
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { setTimeout as delay } from "timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adb = path.join(
  process.env.LOCALAPPDATA ?? "",
  "Android",
  "Sdk",
  "platform-tools",
  "adb.exe",
);
const pkg = "com.maladho2025.mmddelivery";
const expoPort = process.env.EXPO_PORT ?? "8086";
const waitMs = Number(process.env.CAPTURE_WAIT_MS ?? 58_000);

const fullOut = path.join(
  root,
  "docs/screenshots/driver-navigation-qa-full-follow.png",
);
const zoomOut = path.join(
  root,
  "docs/screenshots/driver-navigation-arrow-zoom.png",
);

async function capturePreview(query, outFile) {
  const url = encodeURIComponent(`http://10.0.2.2:${expoPort}?${query}`);
  const deepLink = `exp+mmd-delivery://expo-development-client/?url=${url}`;
  execFileSync(adb, ["shell", "am", "force-stop", pkg]);
  await delay(2500);
  execFileSync(adb, [
    "shell",
    "am",
    "start",
    "-n",
    `${pkg}/.MainActivity`,
    "-a",
    "android.intent.action.VIEW",
    "-d",
    deepLink,
  ]);
  await delay(waitMs);
  const buf = execFileSync(adb, ["exec-out", "screencap", "-p"], {
    maxBuffer: 25 * 1024 * 1024,
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buf);
  console.log("saved full", outFile, buf.length, "bytes");
}

await capturePreview("previewProgress=0.05", fullOut);

execFileSync("node", [path.join(root, "scripts/crop-nav-zoom.mjs"), fullOut, zoomOut], {
  cwd: root,
  stdio: "inherit",
});
