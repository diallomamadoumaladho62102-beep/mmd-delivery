import { execFileSync, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { setTimeout as delay } from "timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdk = path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
const adb = path.join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const packageName = "com.maladho2025.mmddelivery";
const expoPort = process.env.EXPO_PORT ?? "8086";
const metroUrl = `http://10.0.2.2:${expoPort}`;

const scenarios = [
  {
    label: "Route tout droit",
    progress: 0.05,
    file: "docs/screenshots/driver-navigation-straight.png",
  },
  {
    label: "Virage à droite",
    progress: 0.12,
    file: "docs/screenshots/driver-navigation-turn-right.png",
  },
  {
    label: "Virage à gauche",
    progress: 0.91,
    file: "docs/screenshots/driver-navigation-turn-left.png",
  },
  {
    label: "Intersection complexe",
    progress: 0.875,
    file: "docs/screenshots/driver-navigation-intersection.png",
  },
];

function adbExec(args, opts = {}) {
  return execFileSync(adb, args, {
    encoding: "utf8",
    timeout: 30_000,
    ...opts,
  }).trim();
}

function openPreview(progress) {
  const inner = `${metroUrl}?previewProgress=${progress}`;
  const encoded = encodeURIComponent(inner);
  const deepLink = `exp+mmd-delivery://expo-development-client/?url=${encoded}`;
  adbExec([
    "shell",
    "am",
    "start",
    "-n",
    `${packageName}/.MainActivity`,
    "-a",
    "android.intent.action.VIEW",
    "-d",
    deepLink,
  ]);
}

function capture(outRelative) {
  const out = path.join(root, outRelative);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const buf = execFileSync(adb, ["exec-out", "screencap", "-p"], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 30_000,
  });
  fs.writeFileSync(out, buf);
  console.log("saved", outRelative, "bytes", buf.length);
}

async function waitForMetro() {
  for (let i = 0; i < 60; i += 1) {
    try {
      execSync(`curl -s -o NUL -w "%{http_code}" http://127.0.0.1:${expoPort}/status`, {
        stdio: "pipe",
        timeout: 5000,
      });
      console.log("Metro ready");
      return;
    } catch {
      await delay(2000);
    }
  }
  console.warn("Metro status check timed out; continuing anyway");
}

const devices = adbExec(["devices"]);
if (!/emulator-\d+\s+device/m.test(devices)) {
  throw new Error("No Android emulator connected. Start Pixel_5 AVD first.");
}

if (!process.env.SKIP_EXPO_START) {
  console.log("Waiting for Metro on port", expoPort);
  await waitForMetro();
}

for (let index = 0; index < scenarios.length; index += 1) {
  const scenario = scenarios[index];
  console.log(`\n=== ${scenario.label} (${scenario.progress}) ===`);
  adbExec(["shell", "am", "force-stop", packageName]);
  await delay(2000);
  openPreview(scenario.progress);
  await delay(58_000);
  capture(scenario.file);
  const size = fs.statSync(path.join(root, scenario.file)).size;
  if (size < 400_000) {
    console.warn("Capture too small, retrying once…");
    await delay(25_000);
    capture(scenario.file);
  }
}

console.log("\nAll scenario captures complete.");
