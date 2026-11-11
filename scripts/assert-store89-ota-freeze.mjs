#!/usr/bin/env node
/**
 * App Store iOS 1.0.1 build 89 ships runtimeVersion "1.0.0".
 * Publishing `eas update --channel production` while HEAD still uses
 * runtimeVersion "1.0.0" would push new JS onto that binary.
 *
 * Modes:
 *   (default)  Verify the freeze is ARMED (runtime still 1.0.0). Exit 0.
 *   --channel=production
 *              Refuse production OTA while freeze is armed. Exit 1.
 *   --channel=preview|development
 *              Allowed (store 89 does not listen on these channels). Exit 0.
 *
 * Override after an intentional runtimeVersion bump + founder approval:
 *   MMD_ALLOW_PRODUCTION_OTA=1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE_RUNTIME = "1.0.0";
const STORE_BUILD = "89";
const STORE_IOS_VERSION = "1.0.1";
const STORE_PIN = "3152ebf28d4da7eb648827c64a7f0a6130dec8c3";

function readRuntimeVersion() {
  const app = JSON.parse(
    fs.readFileSync(path.join(root, "apps/mobile/app.json"), "utf8"),
  );
  const fromJson = String(app?.expo?.runtimeVersion ?? "");
  const configSrc = fs.readFileSync(path.join(root, "app.config.ts"), "utf8");
  const m = configSrc.match(/runtimeVersion:\s*["']([^"']+)["']/);
  const fromConfig = m ? m[1] : "";
  if (fromJson && fromConfig && fromJson !== fromConfig) {
    return {
      fromJson,
      fromConfig,
      effective: fromConfig,
      mismatch: true,
    };
  }
  return {
    fromJson,
    fromConfig,
    effective: fromConfig || fromJson,
    mismatch: false,
  };
}

const args = process.argv.slice(2);
const channelArg = args.find((a) => a.startsWith("--channel="));
const channel = (
  channelArg
    ? channelArg.slice("--channel=".length)
    : String(process.env.EAS_UPDATE_CHANNEL || "").trim()
).toLowerCase();

const runtime = readRuntimeVersion();
const allow = String(process.env.MMD_ALLOW_PRODUCTION_OTA || "").trim() === "1";
const freezeArmed = runtime.effective === STORE_RUNTIME;

const report = {
  ok: true,
  mode: channel ? `channel:${channel}` : "verify-freeze-armed",
  store_binary: {
    ios_version: STORE_IOS_VERSION,
    build: STORE_BUILD,
    runtimeVersion: STORE_RUNTIME,
    git_pin: STORE_PIN,
  },
  head_runtimeVersion: runtime,
  freeze_armed: freezeArmed,
};

if (runtime.mismatch) {
  report.ok = false;
  report.error =
    "apps/mobile/app.json runtimeVersion disagrees with app.config.ts — fix before any build/OTA.";
}

if (channel === "preview" || channel === "development") {
  report.note = "Non-production channel OK (does not update App Store 89).";
} else if (channel === "production" || channel === "prod") {
  if (freezeArmed && !allow) {
    report.ok = false;
    report.error =
      "BLOCKED: production OTA while runtimeVersion is 1.0.0 would update App Store build 89. Do not run eas update --channel production. Bump runtimeVersion first, then set MMD_ALLOW_PRODUCTION_OTA=1 only with founder approval.";
  } else if (freezeArmed && allow) {
    report.ok = false;
    report.error =
      "MMD_ALLOW_PRODUCTION_OTA=1 ignored: runtimeVersion is still 1.0.0 (would still hit build 89).";
  } else if (!freezeArmed && !allow) {
    report.ok = false;
    report.error =
      "Production OTA requires founder flag MMD_ALLOW_PRODUCTION_OTA=1 after runtimeVersion bump.";
  } else {
    report.note = "Production OTA override accepted (runtime already bumped).";
  }
} else {
  // Default CI mode: freeze must remain armed until founder authorizes a bump.
  if (!freezeArmed) {
    report.ok = false;
    report.error =
      "runtimeVersion changed away from 1.0.0 without completing the store-89 cutover checklist. Confirm intentional bump before builds.";
  } else {
    report.note =
      "Freeze armed. App Store 89 cannot receive HEAD JS unless someone publishes production OTA (blocked by --channel=production).";
  }
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
