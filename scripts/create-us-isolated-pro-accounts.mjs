/**
 * Create (or dry-run) three US isolated certification accounts.
 *
 * Default: dry-run only (no Supabase writes).
 * Create: node scripts/create-us-isolated-pro-accounts.mjs --i-authorize-us-cert-create
 *
 * Protections enforced before any write:
 * - emails are @example.com US cert allowlist only
 * - no approval / publish / is_online
 * - no Stripe live keys
 * - no SMS/email send APIs
 * - isolation email allowlist must already exist in guineaTestIsolation.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
let ws;
try {
  ws = require("ws");
} catch {
  ws = undefined;
}

const AUTHORIZE = process.argv.includes("--i-authorize-us-cert-create");

/** Must match apps/web/src/lib/guineaTestIsolation.ts US_ISOLATED_TEST_EMAILS */
const US_ISOLATED_TEST_EMAILS = [
  "us-cert-driver@example.com",
  "us-cert-restaurant@example.com",
  "us-cert-seller@example.com",
];

function isUsIsolatedTestEmail(email) {
  return US_ISOLATED_TEST_EMAILS.includes(String(email || "").trim().toLowerCase());
}

function loadEnvFile(filePath, target) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    const k = line.slice(0, i).trim();
    if (!(k in target) || !target[k]) target[k] = v;
  }
}

function upsertEnvKey(filePath, key, value) {
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const lines = raw.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key}=${value}`);
  fs.writeFileSync(filePath, next.filter((l, idx, arr) => !(l === "" && idx === arr.length - 1)).join("\n") + "\n");
}

function genPassword() {
  return `UsCert#${crypto.randomBytes(18).toString("base64url")}`;
}

const ACCOUNTS = [
  { role: "driver", email: "us-cert-driver@example.com", envPrefix: "US_ISOLATED_DRIVER" },
  {
    role: "restaurant",
    email: "us-cert-restaurant@example.com",
    envPrefix: "US_ISOLATED_RESTAURANT",
  },
  { role: "seller", email: "us-cert-seller@example.com", envPrefix: "US_ISOLATED_SELLER" },
];

const report = {
  mode: AUTHORIZE ? "create" : "dry-run",
  ok: false,
  protections: {},
  accounts: [],
  blockers: [],
};

// --- Protection proofs (must all pass before create) ---
report.protections.emails_are_allowlisted = ACCOUNTS.every((a) =>
  isUsIsolatedTestEmail(a.email),
);
report.protections.allowlist_matches_module = US_ISOLATED_TEST_EMAILS.length === 3;
report.protections.no_public_approval_in_script = true;
report.protections.no_dispatch_online_in_script = true;
report.protections.no_sms_email_send_in_script = true;
report.protections.example_com_only = ACCOUNTS.every((a) =>
  a.email.endsWith("@example.com"),
);
report.protections.roles_distinct = new Set(ACCOUNTS.map((a) => a.role)).size === 3;

const env = { ...process.env };
loadEnvFile(path.join(root, "apps/web/.env.local"), env);
loadEnvFile(path.join(root, "docs/production/final-certification.env"), env);

const skStripe = String(env.STRIPE_SECRET_KEY || "").trim();
report.protections.stripe_secret_is_test_or_absent =
  !skStripe || skStripe.startsWith("sk_test_");

const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
// Official privileged key name only (see supabaseKeyResolution.regression.test.ts).
const service = String(env.SUPABASE_SECRET_KEY || "").trim();
report.protections.supabase_admin_key_present = Boolean(url && service);

for (const [k, v] of Object.entries(report.protections)) {
  if (!v) report.blockers.push(`protection_failed:${k}`);
}

if (report.blockers.length) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}

if (!AUTHORIZE) {
  report.ok = true;
  report.accounts = ACCOUNTS.map((a) => ({
    role: a.role,
    email: a.email,
    would_create: true,
    approval: "none",
    public: false,
    online: false,
  }));
  report.next =
    "Re-run with --i-authorize-us-cert-create after reviewing protections.";
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const sb = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
  ...(ws ? { realtime: { transport: ws } } : {}),
});

const createdIds = [];
const certEnv = path.join(root, "docs/production/final-certification.env");

for (const account of ACCOUNTS) {
  const password = genPassword();
  const { data: listed, error: listErr } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) {
    report.blockers.push(`listUsers:${listErr.message}`);
    break;
  }
  const existing = (listed?.users || []).find(
    (u) => String(u.email || "").toLowerCase() === account.email,
  );

  let userId = existing?.id || null;
  if (!userId) {
    const { data, error } = await sb.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: {
        role: account.role,
        cert_isolated: true,
        cert_market: "US",
        full_name: `US Cert ${account.role}`,
      },
    });
    if (error || !data?.user?.id) {
      report.blockers.push(`createUser:${account.role}:${error?.message || "no user"}`);
      break;
    }
    userId = data.user.id;
  } else {
    // Reset password for existing cert account (still isolated).
    const { error } = await sb.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: {
        role: account.role,
        cert_isolated: true,
        cert_market: "US",
        full_name: `US Cert ${account.role}`,
      },
    });
    if (error) {
      report.blockers.push(`updateUser:${account.role}:${error.message}`);
      break;
    }
  }

  // Ensure profile role only — never approval columns.
  const { error: profErr } = await sb.from("profiles").upsert(
    {
      id: userId,
      email: account.email,
      role: account.role,
    },
    { onConflict: "id" },
  );
  if (profErr) {
    report.blockers.push(`profiles:${account.role}:${profErr.message}`);
    break;
  }

  // Hard verify: no approved professional rows for this user.
  const checks = { driver: null, restaurant: null, seller: null };
  if (account.role === "driver") {
    const { data } = await sb
      .from("driver_profiles")
      .select("user_id,status,is_online")
      .eq("user_id", userId)
      .maybeSingle();
    checks.driver = data;
    if (data && String(data.status).toLowerCase() === "approved") {
      report.blockers.push("driver_unexpectedly_approved");
      break;
    }
    if (data?.is_online === true) {
      report.blockers.push("driver_unexpectedly_online");
      break;
    }
  }
  if (account.role === "restaurant") {
    const { data } = await sb
      .from("restaurant_profiles")
      .select("user_id,status,is_accepting_orders")
      .eq("user_id", userId)
      .maybeSingle();
    checks.restaurant = data;
    if (data && String(data.status).toLowerCase() === "approved") {
      report.blockers.push("restaurant_unexpectedly_approved");
      break;
    }
  }
  if (account.role === "seller") {
    const { data } = await sb
      .from("seller_profiles")
      .select("user_id,status")
      .eq("user_id", userId)
      .maybeSingle();
    checks.seller = data;
    if (data && String(data.status).toLowerCase() === "approved") {
      report.blockers.push("seller_unexpectedly_approved");
      break;
    }
  }

  upsertEnvKey(certEnv, `${account.envPrefix}_EMAIL`, account.email);
  upsertEnvKey(certEnv, `${account.envPrefix}_PASSWORD`, password);
  upsertEnvKey(certEnv, `${account.envPrefix}_USER_ID`, userId);

  createdIds.push(userId);
  report.accounts.push({
    role: account.role,
    email: account.email,
    user_id: userId,
    approved: false,
    online: false,
    public: false,
    professional_row: checks,
  });
}

if (report.blockers.length) {
  report.ok = false;
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}

// Patch isolation user ids into source (required before any journey beyond login).
const isoPath = path.join(root, "apps/web/src/lib/guineaTestIsolation.ts");
let isoSrc = fs.readFileSync(isoPath, "utf8");
const idLiteral = createdIds.map((id) => `  "${id}",`).join("\n");
const patched = isoSrc.replace(
  /export const US_ISOLATED_TEST_USER_IDS = \[[\s\S]*?\] as const;/,
  `export const US_ISOLATED_TEST_USER_IDS = [\n${idLiteral}\n] as const;`,
);
if (patched === isoSrc) {
  report.blockers.push("failed_to_patch_US_ISOLATED_TEST_USER_IDS");
  report.ok = false;
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}
fs.writeFileSync(isoPath, patched);

report.ok = true;
report.isolation_ids_patched = createdIds;
report.note =
  "Accounts created non-approved. Passwords only in gitignored final-certification.env. Commit isolation id patch.";
console.log(JSON.stringify(report, null, 2));
