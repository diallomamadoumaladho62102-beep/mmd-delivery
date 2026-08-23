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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRestaurantRole(role: string | null | undefined): boolean {
  const normalized = String(role ?? "")
    .trim()
    .toLowerCase();
  return normalized === "restaurant" || normalized === "restaurateur";
}

/**
 * Restaurant manual Cash Out — Instant debit card, no $ min, 1/day ET.
 * Destination acct_ is always restaurant_profiles.stripe_account_id (server-side).
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

  const restaurantUserId = userData.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const bodyRestaurantId = String(body.restaurant_id ?? body.restaurant_user_id ?? "").trim();
  if (bodyRestaurantId && bodyRestaurantId !== restaurantUserId) {
    return mmdLocationJson(
      {
        ok: false,
        error: "Forbidden",
        message: "restaurant_id body parameter is not accepted",
      },
      403,
    );
  }

  // Reject client-controlled amount / stripe destination.
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
      .eq("id", restaurantUserId)
      .maybeSingle();

    if (roleErr) {
      return mmdLocationJson(
        { ok: false, error: "Profile read failed", details: roleErr.message },
        400,
      );
    }

    if (!isRestaurantRole((profileRow as { role?: string } | null)?.role)) {
      return mmdLocationJson(
        { ok: false, error: "Forbidden", message: "Restaurant role required" },
        403,
      );
    }

    const result = await executeWorkerCashOut({
      supabaseAdmin,
      recipientType: "restaurant",
      recipientUserId: restaurantUserId,
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
      restaurant_user_id: restaurantUserId,
    });
  } catch (e) {
    console.error("[wallet/restaurant-cashout]", e);
    return mmdLocationJson(
      {
        ok: false,
        error: toUserFacingError(e, "Unable to request cash out."),
      },
      500,
    );
  }
}
