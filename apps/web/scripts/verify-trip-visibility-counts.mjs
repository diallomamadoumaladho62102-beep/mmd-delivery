/**
 * Verify soft-archive visibility counts (read-only).
 * node apps/web/scripts/verify-trip-visibility-counts.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(__dirname, "..");

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

const envPath = path.join(web, ".env.vercel.production.local");
const env = loadEnv(envPath);
const url = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const key =
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SECRET_KEY ||
  env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("Missing Supabase URL/key in", envPath);
  process.exit(1);
}

const h = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  Prefer: "count=exact",
};

async function count(table, filter = "") {
  const qs = `${table}?select=id${filter}&limit=1`;
  const res = await fetch(`${url}/rest/v1/${qs}`, { headers: h });
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/")[1] ?? NaN);
  if (!Number.isFinite(total)) {
    const body = await res.text();
    return { ok: false, error: body.slice(0, 300), status: res.status };
  }
  return { ok: true, total, status: res.status };
}

async function fetchRows(table, select, filter = "", limit = 20) {
  const qs = `${table}?select=${encodeURIComponent(select)}${filter}&order=created_at.desc&limit=${limit}`;
  const res = await fetch(`${url}/rest/v1/${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const data = await res.json();
  return Array.isArray(data) ? data : { error: data };
}

const liveFilter =
  "&is_test=eq.false&archived_at=is.null&or=(hidden_from_user.is.null,hidden_from_user.eq.false)";
const archivedFilter =
  "&or=(is_test.eq.true,archived_at.not.is.null,hidden_from_user.eq.true)";

const tables = ["orders", "delivery_requests", "taxi_rides"];

const out = {};
for (const table of tables) {
  out[table] = {
    all: await count(table),
    live: await count(table, liveFilter),
    archived: await count(table, archivedFilter),
  };
}

const archivedSamples = {};
for (const table of tables) {
  archivedSamples[table] = await fetchRows(
    table,
    "id,status,is_test,hidden_from_user,archived_at,stripe_session_id",
    archivedFilter,
    10,
  );
}

let viewRows = null;
{
  const res = await fetch(
    `${url}/rest/v1/v_trips_archived_test?select=entity_kind,id,is_test,archived_at&order=created_at.desc&limit=50`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const data = await res.json();
  viewRows = Array.isArray(data) ? data : { error: data, status: res.status };
}

const liveTotal =
  (out.orders.live.ok ? out.orders.live.total : 0) +
  (out.delivery_requests.live.ok ? out.delivery_requests.live.total : 0) +
  (out.taxi_rides.live.ok ? out.taxi_rides.live.total : 0);

const archivedTotal =
  (out.orders.archived.ok ? out.orders.archived.total : 0) +
  (out.delivery_requests.archived.ok ? out.delivery_requests.archived.total : 0) +
  (out.taxi_rides.archived.ok ? out.taxi_rides.archived.total : 0);

const LIVE_PROTECTED = [
  { table: "orders", id: "3705c677-7fad-498c-b312-14035321ee2f" },
  { table: "delivery_requests", id: "4aac2906-ad6b-4acf-83fe-7806917961a2" },
  { table: "taxi_rides", id: "8ad69f07-2f12-4a3e-9579-7a6a8333765a" },
];

const protectedRows = {};
for (const item of LIVE_PROTECTED) {
  const rows = await fetchRows(
    item.table,
    "id,is_test,hidden_from_user,archived_at,payment_status",
    `&id=eq.${item.id}`,
    1,
  );
  protectedRows[item.table] = Array.isArray(rows) ? rows[0] ?? null : rows;
}

console.log(
  JSON.stringify(
    {
      counts: out,
      live_trip_total: liveTotal,
      archived_trip_total: archivedTotal,
      archived_samples: archivedSamples,
      live_protected_proofs: protectedRows,
      v_trips_archived_test: Array.isArray(viewRows)
        ? { count: viewRows.length, rows: viewRows }
        : viewRows,
      expected: {
        archived_soft: 5,
        note: "48 live refers to previously validated paid live set; live_trip_total is all non-archived rows",
      },
    },
    null,
    2,
  ),
);
