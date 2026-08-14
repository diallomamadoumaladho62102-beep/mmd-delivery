/**
 * Call production /api/monitoring/sentry-auth-diag using local CRON/MONITORING secret.
 * Does not print secrets. Run: node scripts/sentry-prod-diag.mjs
 */
import fs from "node:fs";
import path from "node:path";

function loadEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2] ?? "";
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);
const env = {
  ...loadEnv(path.join(root, "tmp", ".env.vercel.pull.local")),
  ...loadEnv(path.join(root, "apps", "web", ".env.vercel.production.local")),
  ...loadEnv(path.join(root, "apps", "web", ".env.production.local")),
  ...loadEnv(path.join(root, ".env.local")),
};

const secret = String(env.MONITORING_SECRET || env.CRON_SECRET || "").trim();
const site = String(
  env.NEXT_PUBLIC_SITE_URL || env.SITE_URL || "https://www.mmddelivery.com",
)
  .trim()
  .replace(/\/$/, "");

console.log(
  JSON.stringify(
    {
      site,
      hasAuthSecret: Boolean(secret),
      secretSource: env.MONITORING_SECRET
        ? "MONITORING_SECRET"
        : env.CRON_SECRET
          ? "CRON_SECRET"
          : "none",
    },
    null,
    2,
  ),
);

if (!secret) {
  console.error("No MONITORING_SECRET/CRON_SECRET in local env files");
  process.exit(2);
}

const res = await fetch(`${site}/api/monitoring/sentry-auth-diag`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});
const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text.slice(0, 500) };
}
console.log(JSON.stringify({ httpStatus: res.status, body }, null, 2));
