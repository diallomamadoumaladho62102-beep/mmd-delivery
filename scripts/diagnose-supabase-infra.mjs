#!/usr/bin/env node
/**
 * Supabase endpoint matrix probe — never prints secret values.
 */
import { readFileSync, existsSync } from "node:fs";
import dns from "node:dns/promises";
import tls from "node:tls";
import net from "node:net";

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1].trim()] = v;
  }
  return out;
}

function sanitizeMeta(name, value) {
  const raw = String(value ?? "");
  const trimmed = raw.trim();
  return {
    name,
    present: trimmed.length > 0,
    length: trimmed.length,
    has_leading_trailing_ws: raw !== trimmed,
    has_newline: /[\r\n]/.test(raw),
    has_wrapping_quotes:
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")),
    host:
      name.toLowerCase().includes("url") && trimmed
        ? (() => {
            try {
              return new URL(trimmed).host;
            } catch {
              return "invalid_url";
            }
          })()
        : undefined,
    jwt_ref:
      name.toLowerCase().includes("key") && trimmed.split(".").length >= 2
        ? (() => {
            try {
              const payload = JSON.parse(
                Buffer.from(trimmed.split(".")[1], "base64url").toString("utf8")
              );
              return {
                ref: payload.ref ?? null,
                role: payload.role ?? null,
                iss: payload.iss ?? null,
              };
            } catch {
              return { parse_error: true };
            }
          })()
        : undefined,
  };
}

async function dnsCheck(host) {
  const started = Date.now();
  try {
    const [a, aaaa] = await Promise.all([
      dns.resolve4(host).catch(() => []),
      dns.resolve6(host).catch(() => []),
    ]);
    return {
      host,
      ok: a.length + aaaa.length > 0,
      ms: Date.now() - started,
      a,
      aaaa,
    };
  } catch (error) {
    return {
      host,
      ok: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function tlsCheck(host, port = 443, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: true },
      () => {
        const cert = socket.getPeerCertificate();
        resolve({
          host,
          ok: true,
          ms: Date.now() - started,
          authorized: socket.authorized,
          protocol: socket.getProtocol(),
          subject: cert?.subject?.CN ?? null,
          valid_to: cert?.valid_to ?? null,
        });
        socket.end();
      }
    );
    socket.setTimeout(timeoutMs, () => {
      resolve({ host, ok: false, ms: Date.now() - started, error: "tls_timeout" });
      socket.destroy();
    });
    socket.on("error", (error) => {
      resolve({
        host,
        ok: false,
        ms: Date.now() - started,
        error: error.message,
      });
    });
  });
}

function tcpCheck(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port }, () => {
      resolve({ host, port, ok: true, ms: Date.now() - started });
      socket.end();
    });
    socket.setTimeout(timeoutMs, () => {
      resolve({ host, port, ok: false, ms: Date.now() - started, error: "tcp_timeout" });
      socket.destroy();
    });
    socket.on("error", (error) => {
      resolve({
        host,
        port,
        ok: false,
        ms: Date.now() - started,
        error: error.message,
      });
    });
  });
}

async function httpProbe({
  label,
  url,
  headers = {},
  method = "GET",
  timeoutMs = 5000,
  body,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    return {
      label,
      url: url.replace(/\/\/[^/]+@/, "//***@"),
      method,
      status: res.status,
      ms: Date.now() - started,
      ok: res.status >= 200 && res.status < 500,
      body_head: text.slice(0, 180).replace(/\s+/g, " "),
      request_id:
        res.headers.get("sb-request-id") ||
        res.headers.get("x-request-id") ||
        res.headers.get("cf-ray") ||
        null,
    };
  } catch (error) {
    return {
      label,
      url,
      method,
      status: null,
      ms: Date.now() - started,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

const local = loadEnv("apps/web/.env.vercel.production.local");
const fallback = loadEnv("apps/web/.env.local");
const env = { ...fallback, ...local };

const url = String(env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const anon = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const service = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const host = url ? new URL(url).host : "sjmszohmhudayxawfows.supabase.co";

console.log(
  JSON.stringify({
    section: "env_metadata",
    vars: [
      sanitizeMeta("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL),
      sanitizeMeta("EXPO_PUBLIC_SUPABASE_URL", env.EXPO_PUBLIC_SUPABASE_URL),
      sanitizeMeta("NEXT_PUBLIC_SUPABASE_ANON_KEY", env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      sanitizeMeta("SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY),
      sanitizeMeta("EXPO_PUBLIC_SUPABASE_ANON_KEY", env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
    ],
  })
);

const dnsResult = await dnsCheck(host);
console.log(JSON.stringify({ section: "dns", ...dnsResult }));

const tlsResult = await tlsCheck(host);
console.log(JSON.stringify({ section: "tls", ...tlsResult }));

const tcp443 = await tcpCheck(host, 443);
console.log(JSON.stringify({ section: "tcp_443", ...tcp443 }));

const authHeaders = {
  apikey: service || anon,
  Authorization: `Bearer ${service || anon}`,
};

const probes = [];
probes.push(
  await httpProbe({
    label: "auth_health_no_key",
    url: `https://${host}/auth/v1/health`,
    timeoutMs: 8000,
  })
);
probes.push(
  await httpProbe({
    label: "auth_health_with_key",
    url: `https://${host}/auth/v1/health`,
    headers: authHeaders,
    timeoutMs: 8000,
  })
);
probes.push(
  await httpProbe({
    label: "rest_root",
    url: `https://${host}/rest/v1/`,
    headers: {
      ...authHeaders,
      Accept: "application/openapi+json",
    },
    timeoutMs: 8000,
  })
);
probes.push(
  await httpProbe({
    label: "rest_cron_job_locks_limit_1",
    url: `https://${host}/rest/v1/cron_job_locks?select=job_name&limit=1`,
    headers: {
      ...authHeaders,
      Accept: "application/json",
      Prefer: "count=exact",
    },
    timeoutMs: 8000,
  })
);
probes.push(
  await httpProbe({
    label: "storage_bucket_list",
    url: `https://${host}/storage/v1/bucket`,
    headers: authHeaders,
    timeoutMs: 8000,
  })
);
probes.push(
  await httpProbe({
    label: "functions_root",
    url: `https://${host}/functions/v1/`,
    headers: authHeaders,
    timeoutMs: 8000,
  })
);

for (const p of probes) {
  console.log(JSON.stringify({ section: "http", ...p }));
}

// Also probe known pooler / db hosts (TCP only; no credentials printed)
const dbHosts = [
  `db.${host.replace(".supabase.co", "")}.supabase.co`,
  `aws-0-us-east-2.pooler.supabase.com`,
];
for (const dbHost of [`db.sjmszohmhudayxawfows.supabase.co`, "aws-0-us-east-2.pooler.supabase.com"]) {
  const d = await dnsCheck(dbHost);
  console.log(JSON.stringify({ section: "db_dns", ...d }));
  const t5432 = await tcpCheck(dbHost, 5432, 8000);
  console.log(JSON.stringify({ section: "db_tcp_5432", ...t5432 }));
  const t6543 = await tcpCheck(dbHost, 6543, 8000);
  console.log(JSON.stringify({ section: "db_tcp_6543", ...t6543 }));
}
