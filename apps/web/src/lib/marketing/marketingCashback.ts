import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyMarketingClient } from "@/lib/marketing/marketingNotifications";

export async function creditAvailableMarketingCashbackBatch(
  supabaseAdmin: SupabaseClient,
  limit = 100
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc(
    "mmd_marketing_credit_cashback_batch",
    { p_limit: Math.max(1, Math.min(limit, 500)) }
  );
  if (error) {
    return { ok: false, error: error.message };
  }

  const result = (data ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(result.ids) ? (result.ids as string[]) : [];

  for (const id of ids.slice(0, 50)) {
    try {
      const { data: row } = await supabaseAdmin
        .from("marketing_cashback_ledger")
        .select("id,user_id,amount_cents,status,currency")
        .eq("id", id)
        .maybeSingle();
      if (!row || row.status !== "credited") continue;
      await notifyMarketingClient({
        supabaseAdmin,
        userId: String(row.user_id),
        title: "Cashback crédité",
        body: `Votre cashback de ${Number(row.amount_cents) / 100} ${row.currency ?? "USD"} a été ajouté au Crédit MMD.`,
        event: "cashback_credited",
      });
    } catch (e) {
      console.warn(
        "[marketing] cashback notify failed",
        e instanceof Error ? e.message : e
      );
    }
  }

  return result;
}

export async function clawbackMarketingCashback(
  supabaseAdmin: SupabaseClient,
  params: {
    cashbackId: string;
    reason?: string | null;
    idempotencyKey?: string | null;
    notifyUser?: boolean;
  }
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc(
    "mmd_marketing_clawback_cashback",
    {
      p_cashback_id: params.cashbackId,
      p_reason: params.reason ?? null,
      p_idempotency_key: params.idempotencyKey ?? null,
    }
  );
  if (error) return { ok: false, error: error.message };
  const result = (data ?? {}) as Record<string, unknown>;

  if (params.notifyUser !== false && result.ok && result.clawed_back) {
    const { data: row } = await supabaseAdmin
      .from("marketing_cashback_ledger")
      .select("user_id,amount_cents,currency")
      .eq("id", params.cashbackId)
      .maybeSingle();
    if (row?.user_id) {
      await notifyMarketingClient({
        supabaseAdmin,
        userId: String(row.user_id),
        title: "Cashback repris",
        body: "Un cashback marketing a été repris suite à un remboursement ou une annulation.",
        event: "cashback_clawback",
      });
    }
  }

  return result;
}
