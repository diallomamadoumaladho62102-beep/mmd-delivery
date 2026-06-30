/**
 * Captures QA Pixel 5 — navigation MMD (preview dev).
 * Prérequis : AVD Pixel_5, Metro port 8086, EXPO_PUBLIC_DRIVER_NAV_PREVIEW=1
 */
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
const waitMs = Number(process.env.CAPTURE_WAIT_MS ?? 52_000);

const scenarios = [
  {
    label: "Vue complète — follow 3D, route, HUD, barre, contrôles",
    query: "previewProgress=0.05",
    file: "docs/screenshots/driver-navigation-qa-full-follow.png",
  },
  {
    label: "Dépassement vitesse — panneau rouge",
    query: "previewProgress=0.05&previewSpeeding=1",
    file: "docs/screenshots/driver-navigation-qa-speeding.png",
  },
  {
    label: "Virage à droite — alignement flèche / route",
    query: "previewProgress=0.12",
    file: "docs/screenshots/driver-navigation-qa-turn-right.png",
  },
  {
    label: "Virage à gauche",
    query: "previewProgress=0.91",
    file: "docs/screenshots/driver-navigation-qa-turn-left.png",
  },
  {
    label: "Navigation en pause — bannière d'état",
    query: "previewProgress=0.05&previewPaused=1",
    file: "docs/screenshots/driver-navigation-qa-paused.png",
  },
  {
    label: "Signal GPS faible",
    query: "previewProgress=0.05&previewStatus=gps_weak",
    file: "docs/screenshots/driver-navigation-qa-gps-weak.png",
  },
  {
    label: "Réseau faible",
    query: "previewProgress=0.05&previewStatus=network_weak",
    file: "docs/screenshots/driver-navigation-qa-network-weak.png",
  },
  {
    label: "Recalcul en cours",
    query: "previewProgress=0.12&previewStatus=rerouting",
    file: "docs/screenshots/driver-navigation-qa-rerouting.png",
  },
  {
    label: "Itinéraires alternatifs",
    query: "previewProgress=0.05",
    file: "docs/screenshots/driver-navigation-qa-alternatives.png",
    note: "Mapbox alternatives=true",
  },
  {
    label: "Arrivée destination — bannière verte",
    query: "previewProgress=0.96&previewArrival=1",
    file: "docs/screenshots/driver-navigation-qa-arrival.png",
  },
];

function adbExec(args, opts = {}) {
  return execFileSync(adb, args, {
    encoding: "utf8",
    timeout: 30_000,
    ...opts,
  }).trim();
}

function openPreview(query) {
  const inner = `${metroUrl}?${query}`;
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
  return buf.length;
}

async function waitForMetro() {
  for (let i = 0; i < 60; i += 1) {
    try {
      execSync(`curl -s -o NUL -w "%{http_code}" http://127.0.0.1:${expoPort}/status`, {
        stdio: "pipe",
        timeout: 5000,
      });
      console.log("Metro ready on", expoPort);
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
  await waitForMetro();
}

for (const scenario of scenarios) {
  console.log(`\n=== ${scenario.label} ===`);
  if (scenario.note) console.log(" ", scenario.note);
  adbExec(["shell", "am", "force-stop", packageName]);
  await delay(2500);
  openPreview(scenario.query);
  await delay(waitMs);
  let size = capture(scenario.file);
  if (size < 250_000) {
    console.warn("Capture small, retrying once…");
    await delay(20_000);
    size = capture(scenario.file);
  }
}

console.log("\nQA captures complete.");
