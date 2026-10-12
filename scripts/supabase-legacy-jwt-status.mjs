#!/usr/bin/env node
/**
 * Classifies Supabase API keys without printing key material.
 * Does not rotate, disable, or reveal secrets.
 */
import { spawnSync } from "node:child_process";

const PROJECT_REF = "sjmszohmhudayxawfows";

function jwtRole(value) {
  if (!value.startsWith("eyJ")) return "";
  const payload = value.split(".")[1] ?? "";
  if (!payload) return "";
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return String(json.role ?? "");
  } catch {
    return "";
  }
}

function prefixKind(value) {
  const text = String(value ?? "").trim();
  if (!text || /^\*+$/.test(text) || text.includes("•") || text.includes("*")) return "MASQUÉ";
  if (text.startsWith("sb_secret_")) return "SECRET_NOUVEAU";
  if (text.startsWith("sb_publishable_")) return "PUBLISHABLE";
  if (text.startsWith("eyJ")) {
    const role = jwtRole(text);
    if (role === "service_role") return "JWT_SERVICE_ROLE";
    if (role === "anon") return "JWT_ANON";
    return "JWT_AUTRE";
  }
  return "AUTRE";
}

const listed = spawnSync(
  "npx supabase projects api-keys --project-ref " + PROJECT_REF + " --output json",
  { encoding: "utf8", shell: true },
);

if (listed.status !== 0) {
  console.log(JSON.stringify({
    access: "NON VÉRIFIABLE",
    exitCode: listed.status ?? 1,
  }));
  process.exit(2);
}

let rows = [];
try {
  rows = JSON.parse(String(listed.stdout || "[]"));
} catch {
  console.log(JSON.stringify({ access: "NON VÉRIFIABLE", reason: "unparsed" }));
  process.exit(2);
}
listed.stdout = "";
listed.stderr = "";

const keys = (Array.isArray(rows) ? rows : []).map((row) => {
  const record = row && typeof row === "object" ? row : {};
  const material = String(record.api_key ?? record.key ?? record.secret ?? "");
  const kind = prefixKind(material);
  return {
    name: String(record.name ?? record.id ?? "unnamed"),
    type: String(record.type ?? record.key_type ?? ""),
    format: kind,
  };
});

const legacyServiceRole = keys.some((item) => item.format === "JWT_SERVICE_ROLE");
console.log(JSON.stringify({
  access: "OK",
  legacyServiceRolePresent: legacyServiceRole ? "PRÉSENT" : "NON DÉTECTÉ",
  keys: keys.map(({ name, type, format }) => ({ name, type, format })),
}, null, 2));
