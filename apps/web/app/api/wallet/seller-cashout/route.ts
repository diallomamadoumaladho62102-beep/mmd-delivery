import { NextRequest } from "next/server";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";
import { executeWorkerCashOut } from "@/lib/finance/workerFinance";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
import { toUserFacingError } from "@/lib/userFacingError";
import { assertProfileActive, inactiveAccountBody } from "@/lib/requireActiveAccount";
import { checkDistributedRateLimit, getRequestClientIp } from "@/lib/apiRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSellerRole(role: string | null | undefined): boolean {
  const normalized = String(role ?? "")
    .trim()
    .toLowerCase();
  return (
    normalized === "seller" ||
    normalized === "marketplace_seller" ||
    normalized === "vendeur"
  );
}

/**
 * Seller / Marketplace manual Cash Out — Instant card or Instant bank, no $ min, 1/day ET.
 * Destination acct_ is always sellers.stripe_account_id (server-side).
 */
export async function POST(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) {
    return mmdLocationJson({ ok: false, error: "Missing Authorization Bearer token" }, 401);
  }

  const supabaseUser = getSupabaseUserClient(token);
  const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
  if (userErr || !userData.user?.id) {
    return mmdLocationJson({ ok: false, error: "Invalid token" }, 401);
  }

  const sellerUserId = userData.user.id;
  const supabaseAdminEarly = getSupabaseAdminClient();
  const account = await assertProfileActive(supabaseAdminEarly, sellerUserId);
  if (account.ok === false) {
    return mmdLocationJson(inactiveAccountBody(account), account.status);
  }
  const cashoutRate = await checkDistributedRateLimit({
    supabaseAdmin: supabaseAdminEarly,
    namespace: "wallet-cashout",
    key: `${getRequestClientIp(req.headers)}:${sellerUserId}`,
    limit: 5,
    windowMs: 60_000,
  });
  if (cashoutRate.limited) {
    return mmdLocationJson(
      { ok: false, error: "rate_limited", message: "Too many cash out attempts" },
      429,
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const bodySellerId = String(body.seller_id ?? body.seller_user_id ?? "").trim();
  if (bodySellerId && bodySellerId !== sellerUserId) {
    return mmdLocationJson(
      {
        ok: false,
        error: "Forbidden",
        message: "seller_id body parameter is not accepted",
      },
      403,
    );
  }

  if (body.amount_cents != null || body.amount != null || body.stripe_account_id) {
    return mmdLocationJson(
      {
        ok: false,
        error: "Forbidden",
        message: "amount and stripe_account_id are not client-controllable",
      },
      403,
    );
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data: profileRow, error: roleErr } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", sellerUserId)
      .maybeSingle();

    if (roleErr) {
      return mmdLocationJson(
        { ok: false, error: "Profile read failed", details: roleErr.message },
        400,
      );
    }

    if (!isSellerRole((profileRow as { role?: string } | null)?.role)) {
      return mmdLocationJson(
        { ok: false, error: "Forbidden", message: "Seller role required" },
        403,
      );
    }

    const result = await executeWorkerCashOut({
      supabaseAdmin,
      recipientType: "seller",
      recipientUserId: sellerUserId,
      currency: String(body.currency ?? "USD"),
      source: "mobile_wallet_cashout",
    });

    if (result.ok === false) {
      return mmdLocationJson(
        {
          ok: false,
          error: result.error,
          message: result.message,
          payout_amount_cents: result.payout_amount_cents,
          currency: result.currency,
          last_cashout_at: result.last_cashout_at,
          money_out_model: result.money_out_model ?? MONEY_OUT_MODEL,
        },
        result.status,
      );
    }

    return mmdLocationJson({
      ok: true,
      stripe_payout_id: result.stripe_payout_id,
      payout_amount_cents: result.payout_amount_cents,
      currency: result.currency,
      money_out_model: result.money_out_model,
      message: result.message,
      payout_transaction_id: result.payout_transaction_id,
      claim_id: result.claim_id,
      seller_user_id: sellerUserId,
    });
  } catch (e) {
    console.error("[wallet/seller-cashout]", e);
    return mmdLocationJson(
      {
        ok: false,
        error: toUserFacingError(e, "Unable to request cash out."),
      },
      500,
    );
  }
}
