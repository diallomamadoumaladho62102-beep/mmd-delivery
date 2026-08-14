/**
 * Read Sentry unresolved issues using local env files (token never printed).
 * Run: node scripts/sentry-unresolved-audit.mjs
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

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const env = {
  ...loadEnv(path.join(root, "tmp", ".env.vercel.pull.local")),
  ...loadEnv(path.join(root, "apps", "web", ".env.vercel.production.local")),
  ...loadEnv(path.join(root, "apps", "web", ".env.production.local")),
  ...loadEnv(path.join(root, ".env.local")),
};

const token = String(env.SENTRY_AUTH_TOKEN ?? "").trim();
const org = String(env.SENTRY_ORG ?? "mmd-delivery").trim();
const web = String(env.SENTRY_PROJECT ?? "mmd-delivery-web").trim();
const mobile = String(env.SENTRY_PROJECT_MOBILE ?? "mmd-delivery-mobile").trim();

console.log(
  JSON.stringify(
    {
      hasToken: Boolean(token),
      org,
      web,
      mobile,
      hasDsn: Boolean(env.NEXT_PUBLIC_SENTRY_DSN || env.SENTRY_DSN),
    },
    null,
    2,
  ),
);

if (!token) {
  console.error("BLOCKER: SENTRY_AUTH_TOKEN not found in local env files");
  process.exit(2);
}

async function issues(project) {
  const url = `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/?query=is:unresolved&limit=20&sort=date`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  if (!res.ok) {
    return {
      project,
      status: res.status,
      error: typeof body === "object" ? body.detail || body : String(body),
    };
  }
  const list = Array.isArray(body) ? body : [];
  return {
    project,
    status: res.status,
    count: list.length,
    sample: list.slice(0, 12).map((i) => ({
      shortId: i.shortId,
      title: String(i.title || "").slice(0, 140),
      count: i.count,
      lastSeen: i.lastSeen,
      culprit: String(i.culprit || "").slice(0, 90),
    })),
  };
}

const report = {
  web: await issues(web),
  mobile: await issues(mobile),
};
console.log(JSON.stringify(report, null, 2));
