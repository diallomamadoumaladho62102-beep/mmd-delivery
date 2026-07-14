#!/usr/bin/env node
/**
 * Direct Postgres diagnostics via linked CLI pooler URL.
 * Never prints passwords or connection strings.
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pg = require(path.resolve(".tmp-pg-diag/node_modules/pg"));

const poolerPath = existsSync("supabase/.temp/pooler-url")
  ? "supabase/.temp/pooler-url"
  : null;

if (!poolerPath) {
  console.log(JSON.stringify({ ok: false, error: "pooler_url_missing" }));
  process.exit(1);
}

const raw = readFileSync(poolerPath, "utf8").trim();
let u;
try {
  u = new URL(raw);
} catch {
  console.log(JSON.stringify({ ok: false, error: "bad_pooler_url" }));
  process.exit(1);
}

console.log(
  JSON.stringify({
    section: "conn_meta",
    host: u.hostname,
    port: u.port,
    pathname: u.pathname,
    user: u.username,
    has_password: Boolean(u.password),
  })
);

const client = new pg.Client({
  connectionString: raw,
  connectionTimeoutMillis: 20_000,
  statement_timeout: 30_000,
  query_timeout: 30_000,
});

const started = Date.now();
try {
  await client.connect();
  console.log(
    JSON.stringify({ section: "connect", ok: true, ms: Date.now() - started })
  );

  const q1 = await client.query(
    "select now() as ts, current_database() as db, current_user as usr"
  );
  console.log(JSON.stringify({ section: "select_now", rows: q1.rows }));

  const q2 = await client.query(
    "select count(*)::int as orders from public.orders"
  );
  console.log(JSON.stringify({ section: "orders_count", rows: q2.rows }));

  const q3 = await client.query(`
    select count(*)::int as total,
      count(*) filter (where state = 'active')::int as active,
      count(*) filter (where state = 'idle')::int as idle,
      count(*) filter (where state = 'idle in transaction')::int as idle_in_tx,
      count(*) filter (where wait_event_type is not null)::int as waiting
    from pg_stat_activity
    where datname = current_database()
  `);
  console.log(JSON.stringify({ section: "sessions", rows: q3.rows }));

  const q4 = await client.query(`
    select pid, usename, application_name, client_addr::text, state,
      wait_event_type, wait_event, left(query, 100) as query_head,
      extract(epoch from (now() - query_start))::int as age_sec
    from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid()
    order by query_start nulls last
    limit 50
  `);
  console.log(
    JSON.stringify({ section: "activity", count: q4.rows.length, rows: q4.rows })
  );

  const q5 = await client.query(`
    select name, setting
    from pg_settings
    where name in ('max_connections', 'superuser_reserved_connections')
  `);
  console.log(JSON.stringify({ section: "settings", rows: q5.rows }));

  const q6 = await client.query(`
    select name, setting
    from pg_settings
    where name ilike '%pgrst%'
       or name ilike '%pre_request%'
       or name ilike '%pre-request%'
  `);
  console.log(JSON.stringify({ section: "pgrst_settings", rows: q6.rows }));

  const q7 = await client.query(`
    select rolname, rolconfig
    from pg_roles
    where rolname in (
      'anon', 'authenticated', 'service_role',
      'authenticator', 'postgres', 'supabase_admin'
    )
    order by 1
  `);
  console.log(JSON.stringify({ section: "role_config", rows: q7.rows }));

  const q8 = await client.query(`
    select n.nspname, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname ilike '%pre_request%'
       or p.proname ilike '%pgrst%'
  `);
  console.log(JSON.stringify({ section: "pre_request_funcs", rows: q8.rows }));

  const q9 = await client.query(`
    select coalesce(usename, '(none)') as usename, count(*)::int as connections
    from pg_stat_activity
    group by usename
    order by connections desc
  `);
  console.log(JSON.stringify({ section: "connections_by_role", rows: q9.rows }));
} catch (error) {
  console.log(
    JSON.stringify({
      section: "error",
      ms: Date.now() - started,
      message: error instanceof Error ? error.message : String(error),
      code:
        error && typeof error === "object" && "code" in error
          ? error.code
          : null,
    })
  );
  process.exitCode = 1;
} finally {
  try {
    await client.end();
  } catch {
    /* ignore */
  }
}
