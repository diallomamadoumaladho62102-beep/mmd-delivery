import type { SupabaseClient } from "@supabase/supabase-js";

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

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: webhookCount, error: webhookError } = await supabase
    .from("stripe_webhook_events")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sinceIso);

  checks.push({
    name: "stripe_webhook_events_24h",
    ok: !webhookError,
    severity: webhookError ? "critical" : "info",
    detail: webhookError?.message,
    count: webhookCount ?? 0,
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
