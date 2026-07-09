/**
 * Ops probe: send real Sentry events using configured DSNs.
 * Run from apps/web so @sentry/nextjs is available.
 *
 *   cd apps/web
 *   pnpm exec tsx scripts/sentry-probe.ts --web
 *   pnpm exec tsx scripts/sentry-probe.ts --mobile
 *   pnpm exec tsx scripts/sentry-probe.ts --both
 *   pnpm exec tsx scripts/sentry-probe.ts --web-api
 */
import * as Sentry from "@sentry/nextjs";

const args = new Set(process.argv.slice(2));
const siteUrl = (
  process.env.PRODUCTION_SITE_URL ||
  process.env.APP_BASE_URL ||
  "https://www.mmddelivery.com"
).replace(/\/$/, "");

function messageFor(target: string) {
  return `MMD Sentry ${target} probe ${new Date().toISOString()}`;
}

async function probeDsn(target: "web" | "mobile", dsn: string) {
  Sentry.init({
    dsn,
    enabled: true,
    environment: process.env.VERCEL_ENV || process.env.APP_ENV || "production",
    tracesSampleRate: 0,
  });

  const message = messageFor(target);
  const err = new Error(message);
  err.name = "MmdSentryProbeError";
  const eventId = Sentry.captureException(err, {
    tags: { mmd_sentry_probe: "true", probe_target: target },
    extra: { probe: true, script: "apps/web/scripts/sentry-probe.ts" },
  });
  const flushed = await Sentry.flush(8000);
  await Sentry.close(2000);

  const ok = Boolean(eventId) && flushed;
  console.log(
    JSON.stringify({ ok, target, event_id: eventId || null, message, flushed }, null, 2)
  );
  if (!ok) throw new Error(`${target} probe failed`);
  console.log(
    `PASS ${target} — open Sentry project ${
      target === "web" ? "mmd-delivery-web" : "mmd-delivery-mobile"
    } and search tag mmd_sentry_probe`
  );
}

async function probeWebApi() {
  const secret = String(
    process.env.MONITORING_SECRET || process.env.CRON_SECRET || ""
  ).trim();
  if (!secret) throw new Error("Set MONITORING_SECRET or CRON_SECRET for --web-api");

  const res = await fetch(`${siteUrl}/api/monitoring/sentry-probe`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "x-cron-secret": secret,
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  console.log("[web-api]", res.status, JSON.stringify(json, null, 2));
  if (!res.ok || json.ok !== true) throw new Error("web-api probe failed");
  console.log("PASS web-api — check mmd-delivery-web for event_id", json.event_id);
}

async function main() {
  const both = args.has("--both");
  const wantWeb = args.has("--web") || both;
  const wantMobile = args.has("--mobile") || both;
  const wantApi = args.has("--web-api");

  if (!wantWeb && !wantMobile && !wantApi) {
    console.log(`Usage:
  pnpm exec tsx scripts/sentry-probe.ts --web
  pnpm exec tsx scripts/sentry-probe.ts --mobile
  pnpm exec tsx scripts/sentry-probe.ts --both
  pnpm exec tsx scripts/sentry-probe.ts --web-api
`);
    process.exit(2);
  }

  let failed = 0;

  if (wantApi) {
    try {
      await probeWebApi();
    } catch (e) {
      console.error("FAIL web-api", e instanceof Error ? e.message : e);
      failed += 1;
    }
  }

  if (wantWeb) {
    const dsn = String(
      process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN || ""
    ).trim();
    try {
      if (!dsn) throw new Error("NEXT_PUBLIC_SENTRY_DSN / SENTRY_DSN missing");
      await probeDsn("web", dsn);
    } catch (e) {
      console.error("FAIL web", e instanceof Error ? e.message : e);
      failed += 1;
    }
  }

  if (wantMobile) {
    const dsn = String(process.env.EXPO_PUBLIC_SENTRY_DSN || "").trim();
    try {
      if (!dsn) throw new Error("EXPO_PUBLIC_SENTRY_DSN missing");
      await probeDsn("mobile", dsn);
    } catch (e) {
      console.error("FAIL mobile", e instanceof Error ? e.message : e);
      failed += 1;
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
