#!/usr/bin/env node
/**
 * Presence and format check for five EAS production variables.
 * Prints booleans only. Never prints values, prefixes, or the raw EAS listing.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAMES = [
  "EXPO_PUBLIC_STRIPE_PK",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_MAPBOX_TOKEN",
  "RNMAPBOX_MAPS_DOWNLOAD_TOKEN",
];

function formatOk(name, value) {
  if (name === "EXPO_PUBLIC_STRIPE_PK") return value.startsWith("pk_live_");
  if (name === "EXPO_PUBLIC_SUPABASE_URL") {
    return value.startsWith("https://") && value.includes("sjmszohmhudayxawfows");
  }
  if (name === "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY") return value.startsWith("sb_publishable_");
  if (name === "EXPO_PUBLIC_MAPBOX_TOKEN") return value.startsWith("pk.");
  if (name === "RNMAPBOX_MAPS_DOWNLOAD_TOKEN") {
    return value.length >= 20 && !value.startsWith("pk.") && !value.startsWith("pk_");
  }
  return false;
}

function lineFor(text, name) {
  const match = text.match(new RegExp(`^.*\\b${name}\\b.*$`, "m"));
  return match ? match[0] : "";
}

function rawValue(line, name) {
  const eq = line.indexOf("=");
  let value = "";
  if (eq > 0) value = line.slice(eq + 1).trim();
  else {
    const parts = line.trim().split(/\s{2,}|\t+/).filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    value = last === name ? "" : last;
  }
  value = value.replace(/^["']|["']$/g, "");
  const note = value.indexOf(" (");
  if (note > 0) value = value.slice(0, note).trim();
  return value;
}

function isMasked(value) {
  return !value || /^\*+$/.test(value);
}

function inspect(text, name) {
  const line = lineFor(text, name);
  if (!line) return { name, presence: "ABSENT", format: "NON VÉRIFIABLE" };
  let value = rawValue(line, name);
  const masked = isMasked(value);
  let format = "NON VÉRIFIABLE";
  if (!masked) format = formatOk(name, value) ? "CONFIRMÉ" : "INCOHÉRENT";
  value = "";
  return { name, presence: "CONFIRMÉ", format };
}

function listEnv(includeSensitive) {
  const flag = includeSensitive ? " --include-sensitive" : "";
  return spawnSync(
    `npx eas-cli env:list --environment production --format short${flag}`,
    { encoding: "utf8", shell: true, cwd: root },
  );
}

const listed = listEnv(false);

if (listed.status !== 0) {
  console.log(JSON.stringify({
    access: "NON VÉRIFIABLE",
    exitCode: listed.status ?? 1,
    variables: NAMES.map((name) => ({ name, presence: "NON VÉRIFIABLE", format: "NON VÉRIFIABLE" })),
  }, null, 2));
  process.exit(2);
}

let text = String(listed.stdout || "");
const variables = NAMES.map((name) => inspect(text, name));
text = "";
listed.stdout = "";
listed.stderr = "";

const needsFormat = variables.some((item) => item.presence === "CONFIRMÉ" && item.format === "NON VÉRIFIABLE");
if (needsFormat) {
  const sensitive = listEnv(true);
  if (sensitive.status === 0) {
    let secretText = String(sensitive.stdout || "");
    for (const item of variables) {
      if (item.format !== "NON VÉRIFIABLE") continue;
      const checked = inspect(secretText, item.name);
      if (checked.presence === "CONFIRMÉ") item.format = checked.format;
    }
    secretText = "";
  }
  sensitive.stdout = "";
  sensitive.stderr = "";
}

console.log(JSON.stringify({ access: "OK", variables }, null, 2));
process.exit(variables.some((item) => item.presence !== "CONFIRMÉ") ? 1 : 0);
