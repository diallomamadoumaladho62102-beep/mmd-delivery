/**
 * Inventory + optional soft-archive of SAFE test orders only.
 *
 * Modes:
 *   node inventory-and-archive-test-orders.mjs              # dry-run inventory
 *   node inventory-and-archive-test-orders.mjs --dry-run     # same
 *   node inventory-and-archive-test-orders.mjs --execute     # soft-archive clear test rows
 *
 * Never archives LIVE Stripe, LIVE_PROTECTED proofs, or PAID_NO_STRIPE_SUSPECT.
 * Soft-archives only: TEST_PAID_TESTMODE, TEST_CANDIDATE (explicit test markers).
 * UNPAID_NO_STRIPE is inventoried but NOT archived by default (too ambiguous).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(__dirname, "..");
const root = path.resolve(web, "..", "..");
const EXECUTE = process.argv.includes("--execute");

function loadEnv(p) {
  const t = fs.readFileSync(p, "utf8");
  const o = {};
  for (const line of t.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    o[k] = v;
  }
  return o;
}

const env = loadEnv(path.join(web, ".env.vercel.production.local"));
const url = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const key =
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SECRET_KEY ||
  env.SUPABASE_SERVICE_KEY;
const h = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const LIVE_PROTECTED_IDS = new Set([
  "3705c677-7fad-498c-b312-14035321ee2f",
  "4aac2906-ad6b-4acf-83fe-7806917961a2",
  "1db1f655",
  "8ad69f07-2f12-4a3e-9579-7a6a8333765a",
]);

async function fetchAll(table, select, filters = "") {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const qs = `${table}?select=${encodeURIComponent(select)}${filters}&order=created_at.desc&offset=${from}&limit=${pageSize}`;
    const res = await fetch(`${url}/rest/v1/${qs}`, { headers: h });
    const data = await res.json();
    if (!Array.isArray(data)) {
      console.error("fetch fail", table, data);
      break;
    }
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
    if (from > 20000) break;
  }
  return rows;
}

function isLivePi(pi) {
  const s = String(pi || "");
  return s.startsWith("pi_") && !s.startsWith("pi_test_");
}
function isTestPi(pi) {
  const s = String(pi || "");
  return s.startsWith("pi_test_");
}
function isLiveCs(cs) {
  const s = String(cs || "");
  return s.startsWith("cs_live_") || (s.startsWith("cs_") && !s.startsWith("cs_test_"));
}
function isTestCs(cs) {
  const s = String(cs || "");
  return s.startsWith("cs_test_");
}
function isProtected(id) {
  const s = String(id || "");
  if (LIVE_PROTECTED_IDS.has(s)) return true;
  for (const p of LIVE_PROTECTED_IDS) {
    if (s.startsWith(p)) return true;
  }
  return false;
}

function classifyRow(row) {
  const reasons = [];
  const pi = row.stripe_payment_intent_id;
  const cs = row.stripe_session_id;
  const paid = String(row.payment_status || "").toLowerCase() === "paid";

  if (isProtected(row.id)) {
    return { class: "LIVE_PROTECTED", reasons: ["explicit_live_proof_id"] };
  }
  if (isLivePi(pi) || isLiveCs(cs)) {
    return { class: "LIVE", reasons: ["live_stripe_id"] };
  }

  if (isTestPi(pi) || isTestCs(cs)) reasons.push("stripe_test_prefix");
  const meta = JSON.stringify(row.metadata || row.items_json || {}).toLowerCase();
  if (/e2e|fixture|demo_test|test_only|cypress|playwright/.test(meta)) {
    reasons.push("test_metadata");
  }
  const title = String(row.title || row.errand_description || "").toLowerCase();
  if (/^e2e |test order|demo order|fixture/.test(title)) reasons.push("test_title");
  if (String(row.payment_provider || "").toLowerCase() === "mock") {
    reasons.push("mock_provider");
  }
  if (String(row.external_ref_type || "").toLowerCase().includes("test")) {
    reasons.push("test_external_ref");
  }

  if (reasons.length > 0 && paid && (isTestPi(pi) || isTestCs(cs))) {
    return { class: "TEST_PAID_TESTMODE", reasons };
  }
  if (reasons.length > 0) {
    return { class: "TEST_CANDIDATE", reasons };
  }
  if (!pi && !cs && !paid) {
    return { class: "UNPAID_NO_STRIPE", reasons: ["unpaid_no_stripe"] };
  }
  if (paid && !pi && !cs) {
    return { class: "PAID_NO_STRIPE_SUSPECT", reasons: ["paid_without_stripe_ids"] };
  }
  return { class: "KEEP", reasons: ["default_keep"] };
}

/** Only clear test markers — never unpaid-only or paid-suspect. */
function isSafeToArchive(classified) {
  return (
    classified.class === "TEST_PAID_TESTMODE" ||
    classified.class === "TEST_CANDIDATE"
  );
}

const orderSelect =
  "id,created_at,status,payment_status,kind,order_type,stripe_payment_intent_id,stripe_session_id,total,grand_total,client_user_id,driver_id,title,external_ref_type,currency,archived_at,is_test,hidden_from_user";
const orderSelectFallback =
  "id,created_at,status,payment_status,kind,order_type,stripe_payment_intent_id,stripe_session_id,total,grand_total,client_user_id,driver_id,title,external_ref_type,currency";
const drSelect =
  "id,created_at,status,payment_status,kind,request_type,stripe_payment_intent_id,stripe_session_id,total,total_cents,client_user_id,created_by,driver_id,currency,archived_at,is_test,hidden_from_user";
const drSelectFallback =
  "id,created_at,status,payment_status,kind,request_type,stripe_payment_intent_id,stripe_session_id,total,total_cents,client_user_id,created_by,driver_id,currency";
const taxiSelect =
  "id,created_at,status,payment_status,stripe_payment_intent_id,stripe_session_id,total_cents,client_user_id,driver_id,currency,archived_at,is_test,hidden_from_user";
const taxiSelectFallback =
  "id,created_at,status,payment_status,stripe_payment_intent_id,stripe_session_id,total_cents,client_user_id,driver_id,currency";

async function trySelect(table, select) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;
  for (;;) {
    const qs = `${table}?select=${encodeURIComponent(select)}&order=created_at.desc&offset=${from}&limit=${pageSize}`;
    const res = await fetch(`${url}/rest/v1/${qs}`, { headers: h });
    const data = await res.json();
    if (!Array.isArray(data)) {
      return { ok: false, rows: [], error: data };
    }
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
    if (from > 20000) break;
  }
  return { ok: true, rows };
}

async function fetchTable(table, select, fallback) {
  const primary = await trySelect(table, select);
  if (primary.ok) return primary.rows;
  const secondary = await trySelect(table, fallback);
  if (secondary.ok) return secondary.rows;
  console.error("fetch fail", table, secondary.error || primary.error);
  return [];
}

console.log(
  EXECUTE
    ? "MODE=EXECUTE soft-archive"
    : "MODE=DRY_RUN inventory (no writes)",
);

const [orders, drs, taxis] = await Promise.all([
  fetchTable("orders", orderSelect, orderSelectFallback),
  fetchTable("delivery_requests", drSelect, drSelectFallback),
  fetchTable("taxi_rides", taxiSelect, taxiSelectFallback),
]);

function summarize(rows, kind) {
  const buckets = {};
  const classified = rows.map((r) => {
    const c = classifyRow(r);
    buckets[c.class] = (buckets[c.class] || 0) + 1;
    return {
      id: r.id,
      kind,
      status: r.status,
      payment_status: r.payment_status,
      pi: r.stripe_payment_intent_id,
      cs: r.stripe_session_id,
      created_at: r.created_at,
      already_archived: !!(r.archived_at || r.is_test || r.hidden_from_user),
      ...c,
    };
  });
  return { buckets, classified };
}

const ordersSum = summarize(orders, "order");
const drSum = summarize(drs, "delivery_request");
const taxiSum = summarize(taxis, "taxi_ride");

const allClassified = [
  ...ordersSum.classified,
  ...drSum.classified,
  ...taxiSum.classified,
];

const archiveTargets = allClassified.filter(
  (c) => isSafeToArchive(c) && !c.already_archived,
);
const liveOrProtected = allClassified.filter(
  (c) => c.class === "LIVE_PROTECTED" || c.class === "LIVE",
);

const outDir = path.join(root, "backups", "test-cleanup-inventory");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const backupPayload = {
  generated_at: new Date().toISOString(),
  mode: EXECUTE ? "EXECUTE_SOFT_ARCHIVE" : "DRY_RUN_INVENTORY",
  counts: {
    orders: orders.length,
    delivery_requests: drs.length,
    taxi_rides: taxis.length,
  },
  buckets: {
    orders: ordersSum.buckets,
    delivery_requests: drSum.buckets,
    taxi_rides: taxiSum.buckets,
  },
  clear_test_identified: archiveTargets.length,
  live_or_protected_count: liveOrProtected.length,
  archive_targets: archiveTargets,
  live_or_protected_ids: liveOrProtected.map((r) => r.id),
  criteria: {
    archive_only: ["TEST_PAID_TESTMODE", "TEST_CANDIDATE"],
    never_archive: [
      "LIVE",
      "LIVE_PROTECTED",
      "PAID_NO_STRIPE_SUSPECT",
      "UNPAID_NO_STRIPE (inventoried only)",
      "age alone",
    ],
  },
};

fs.writeFileSync(
  path.join(outDir, `backup-before-archive-${stamp}.json`),
  JSON.stringify(
    {
      ...backupPayload,
      full_rows_snapshot: {
        orders: orders.filter((o) =>
          archiveTargets.some((t) => t.id === o.id && t.kind === "order"),
        ),
        delivery_requests: drs.filter((o) =>
          archiveTargets.some(
            (t) => t.id === o.id && t.kind === "delivery_request",
          ),
        ),
        taxi_rides: taxis.filter((o) =>
          archiveTargets.some((t) => t.id === o.id && t.kind === "taxi_ride"),
        ),
      },
    },
    null,
    2,
  ),
);

let archived = { orders: 0, delivery_requests: 0, taxi_rides: 0, errors: [] };

if (EXECUTE) {
  const nowIso = new Date().toISOString();
  const patch = {
    archived_at: nowIso,
    is_test: true,
    hidden_from_user: true,
  };

  for (const target of archiveTargets) {
    const table =
      target.kind === "order"
        ? "orders"
        : target.kind === "delivery_request"
          ? "delivery_requests"
          : "taxi_rides";
    const res = await fetch(
      `${url}/rest/v1/${table}?id=eq.${encodeURIComponent(target.id)}`,
      {
        method: "PATCH",
        headers: h,
        body: JSON.stringify(patch),
      },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      archived.errors.push({ id: target.id, table, body, status: res.status });
    } else {
      archived[table] += 1;
    }
  }
}

const report = {
  ...backupPayload,
  archived_counts: archived,
  live_intact_proof: {
    protected_ids_still_live_class: liveOrProtected
      .filter((r) =>
        [...LIVE_PROTECTED_IDS].some(
          (p) => r.id === p || String(r.id).startsWith(p),
        ),
      )
      .map((r) => ({ id: r.id, class: r.class })),
    live_count: liveOrProtected.length,
  },
};

fs.writeFileSync(
  path.join(outDir, `inventory-${stamp}.json`),
  JSON.stringify(report, null, 2),
);
fs.writeFileSync(
  path.join(outDir, "inventory-latest.json"),
  JSON.stringify(report, null, 2),
);

console.log(
  JSON.stringify(
    {
      mode: report.mode,
      counts: report.counts,
      buckets: report.buckets,
      clear_test_identified: report.clear_test_identified,
      live_or_protected_count: report.live_or_protected_count,
      archived_counts: archived,
      out: path.join(outDir, "inventory-latest.json"),
    },
    null,
    2,
  ),
);
