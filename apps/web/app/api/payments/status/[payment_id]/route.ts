import { NextRequest } from "next/server";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
  parseUuid,
} from "@/lib/mmdLocationCore";
import { getPaymentTransactionById } from "@/lib/paymentTransactionService";
import { refreshPaymentStatus } from "@/lib/paymentWebhookService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ payment_id: string }>;
};

export async function GET(req: NextRequest, context: RouteContext) {
  const token = getBearerToken(req);
  if (!token) {
    return mmdLocationJson({ ok: false, error: "Missing Authorization Bearer token" }, 401);
  }

  const supabaseUser = getSupabaseUserClient(token);
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data.user?.id) {
    return mmdLocationJson({ ok: false, error: "Invalid token" }, 401);
  }

  const { payment_id: paymentIdRaw } = await context.params;
  let paymentId: string;
  try {
    paymentId = parseUuid(paymentIdRaw, "payment_id");
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "invalid_payment_id" },
      400
    );
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    let transaction = await getPaymentTransactionById(supabaseAdmin, paymentId);
    if (!transaction) {
      return mmdLocationJson({ ok: false, error: "payment_not_found" }, 404);
    }
    if (transaction.user_id !== data.user.id) {
      return mmdLocationJson({ ok: false, error: "forbidden" }, 403);
    }

    if (
      transaction.external_reference &&
      !["paid", "failed", "canceled", "expired"].includes(transaction.status)
    ) {
      const refreshed = await refreshPaymentStatus(supabaseAdmin, transaction);
      if (refreshed.ok) {
        transaction = refreshed.payment;
      }
    }

    return mmdLocationJson({
      ok: true,
      payment_id: transaction.id,
      status: transaction.status,
      provider: transaction.provider,
      method_code: transaction.method_code,
      amount_cents: transaction.amount_cents,
      currency: transaction.currency,
      external_reference: transaction.external_reference,
      payment_url: transaction.payment_url,
      entity_type: transaction.entity_type,
      entity_id: transaction.entity_id,
      country_code: transaction.country_code,
      paid_at: transaction.paid_at,
      failure_reason: transaction.failure_reason,
    });
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "payment_status_failed" },
      500
    );
  }
}
