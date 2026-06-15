import type { SupabaseClient } from "@supabase/supabase-js";

/** Production may use `received_at` (legacy) or `created_at` (migration). */
export const STRIPE_WEBHOOK_EVENT_TIMESTAMP_COLUMNS = [
  "received_at",
  "created_at",
  "processed_at",
  "inserted_at",
] as const;

export type StripeWebhookEvents24hResult = {
  ok: boolean;
  count: number;
  column: string | null;
  fallback?: "total_count";
  warning?: string;
  error?: string;
};

function isMissingColumnError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("does not exist");
}

export async function countStripeWebhookEvents24h(
  supabase: SupabaseClient
): Promise<StripeWebhookEvents24hResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  for (const column of STRIPE_WEBHOOK_EVENT_TIMESTAMP_COLUMNS) {
    const { count, error } = await supabase
      .from("stripe_webhook_events")
      .select("id", { count: "exact", head: true })
      .gte(column, since);

    if (!error) {
      return { ok: true, count: count ?? 0, column };
    }

    if (isMissingColumnError(error)) {
      continue;
    }
  }

  const { count: total, error: totalError } = await supabase
    .from("stripe_webhook_events")
    .select("id", { count: "exact", head: true });

  if (totalError) {
    return {
      ok: false,
      count: 0,
      column: null,
      error: totalError.message || "count_failed",
    };
  }

  return {
    ok: true,
    count: total ?? 0,
    column: null,
    fallback: "total_count",
    warning:
      "No webhook timestamp column available for 24h filter; reporting total row count instead",
  };
}
