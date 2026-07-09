import type { SupabaseClient } from "@supabase/supabase-js";
import { countStripeWebhookEvents24h } from "@/lib/stripeWebhookEventsHealth";
import {
  captureProductionException,
  captureProductionMessage,
} from "@/lib/sentryCapture";

export type ProductionMonitoringCheck = {
  name: string;
  ok: boolean;
  severity: "critical" | "warning" | "info";
  detail?: string;
  count?: number;
};

export type ProductionMonitoringSnapshot = {
  ok: boolean;
  time: string;
  env: string;
  checks: ProductionMonitoringCheck[];
};

type CriticalErrorRecord = {
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
  at: string;
};

const recentCriticalErrors: CriticalErrorRecord[] = [];
const MAX_RECENT_CRITICAL_ERRORS = 50;

function trimWebhookUrl(): string {
  return String(process.env.MONITORING_WEBHOOK_URL ?? "").trim();
}

export function recordProductionCriticalError(
  scope: string,
  message: string,
  meta?: Record<string, unknown>
) {
  const entry: CriticalErrorRecord = {
    scope,
    message,
    meta,
    at: new Date().toISOString(),
  };

  recentCriticalErrors.unshift(entry);
  if (recentCriticalErrors.length > MAX_RECENT_CRITICAL_ERRORS) {
    recentCriticalErrors.length = MAX_RECENT_CRITICAL_ERRORS;
  }

  console.error("[production-critical]", entry);

  captureProductionMessage(scope, message, meta);
  if (meta?.error) {
    captureProductionException(scope, meta.error, meta);
  }

  // Fire-and-forget ops webhook for payment/dispatch critical scopes.
  const criticalScopes = /payment|stripe|payout|dispatch|webhook|taxi|order/i;
  if (criticalScopes.test(scope) && trimWebhookUrl()) {
    void sendProductionMonitoringAlert({
      severity: "critical",
      scope,
      message,
      meta: meta ?? {},
    });
  }
}

export async function sendProductionMonitoringAlert(payload: Record<string, unknown>) {
  const webhookUrl = trimWebhookUrl();
  if (!webhookUrl) return { sent: false, reason: "webhook_not_configured" };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "mmd-delivery",
        time: new Date().toISOString(),
        ...payload,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return { sent: false, reason: `webhook_status_${response.status}` };
    }

    return { sent: true };
  } catch (error) {
    recordProductionCriticalError("monitoring_webhook", "Alert delivery failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { sent: false, reason: "webhook_error" };
  }
}

export function getRecentProductionCriticalErrors(limit = 20) {
  return recentCriticalErrors.slice(0, Math.max(1, Math.min(limit, MAX_RECENT_CRITICAL_ERRORS)));
}

export async function runProductionMonitoringChecks(
  supabase: SupabaseClient
): Promise<ProductionMonitoringSnapshot> {
  const checks: ProductionMonitoringCheck[] = [];
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";

  const { count: platformCount, error: platformError } = await supabase
    .from("platform_countries")
    .select("country_code", { count: "exact", head: true });

  checks.push({
    name: "platform_countries",
    ok: !platformError,
    severity: "critical",
    detail: platformError?.message,
    count: platformCount ?? 0,
  });

  const webhook24h = await countStripeWebhookEvents24h(supabase);
  checks.push({
    name: "stripe_webhook_events_24h",
    ok: webhook24h.ok,
    severity: webhook24h.ok ? "info" : "critical",
    detail: webhook24h.error ?? webhook24h.warning,
    count: webhook24h.count,
  });

  for (const table of [
    "taxi_dispatch_alerts",
    "taxi_payment_alerts",
    "taxi_payout_alerts",
  ] as const) {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("status", "open");

    checks.push({
      name: `${table}_open`,
      ok: !error,
      severity: error ? "warning" : "info",
      detail: error?.message,
      count: count ?? 0,
    });
  }

  checks.push({
    name: "recent_critical_errors",
    ok: recentCriticalErrors.length === 0,
    severity: recentCriticalErrors.length > 0 ? "critical" : "info",
    count: recentCriticalErrors.length,
  });

  const cronSecretSet = Boolean(String(process.env.CRON_SECRET ?? "").trim());
  checks.push({
    name: "cron_secret_configured",
    ok: cronSecretSet || env !== "production",
    severity: "critical",
    detail: cronSecretSet ? undefined : "CRON_SECRET missing",
  });

  const mapboxServer = Boolean(String(process.env.MAPBOX_ACCESS_TOKEN ?? "").trim());
  const mapboxPublic = Boolean(
    String(process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim() ||
      String(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "").trim()
  );
  checks.push({
    name: "mapbox_tokens",
    ok: mapboxServer && mapboxPublic,
    severity: "critical",
    detail: !mapboxServer
      ? "MAPBOX_ACCESS_TOKEN missing"
      : !mapboxPublic
        ? "NEXT_PUBLIC_MAPBOX_TOKEN missing"
        : undefined,
  });

  const sentryConfigured = Boolean(
    String(process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN ?? "").trim()
  );
  checks.push({
    name: "sentry_dsn",
    ok: sentryConfigured || env !== "production",
    severity: "critical",
    detail: sentryConfigured ? undefined : "NEXT_PUBLIC_SENTRY_DSN missing",
  });

  const marketplaceE2E =
    process.env.MARKETPLACE_SELLER_PAYOUTS_E2E_READY === "true";
  const marketplaceLiveEnv =
    process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED === "true" ||
    process.env.MARKETPLACE_DISPATCH_LIVE_ENABLED === "true" ||
    process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED === "true";
  checks.push({
    name: "marketplace_live_locked",
    ok: !marketplaceLiveEnv || marketplaceE2E,
    severity: "critical",
    detail:
      marketplaceLiveEnv && !marketplaceE2E
        ? "Marketplace live env flags ON without MARKETPLACE_SELLER_PAYOUTS_E2E_READY"
        : undefined,
  });

  const ok = checks.every(
    (check) => check.ok || check.severity === "info" || check.severity === "warning"
  );

  const snapshot: ProductionMonitoringSnapshot = {
    ok,
    time: new Date().toISOString(),
    env,
    checks,
  };

  if (!ok) {
    await sendProductionMonitoringAlert({
      level: "critical",
      message: "Production monitoring checks degraded",
      checks: checks.filter((check) => !check.ok),
    });
  }

  return snapshot;
}
