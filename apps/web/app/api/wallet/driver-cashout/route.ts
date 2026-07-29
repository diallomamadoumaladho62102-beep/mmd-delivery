import { NextRequest } from "next/server";
import {
  DRIVER_CASHOUT_MINIMUM_CENTS,
  fetchConnectUsdBalanceCents,
  isDriverCashoutRateLimited,
} from "@/lib/driverWalletService";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
import {
  createPayoutTransaction,
  updatePayoutTransactionStatus,
} from "@/lib/payoutTransactionService";
import { stripe } from "@/lib/stripe";
import { toUserFacingError } from "@/lib/userFacingError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isDriverRole(role: string | null | undefined): boolean {
  const normalized = String(role ?? "")
    .trim()
    .toLowerCase();
  return normalized === "driver" || normalized === "livreur";
}

/**
 * Canonical Driver wallet Cash Out (Vercel).
 * Withdraws Stripe Connect **available** balance only via Express payout.
 * Does NOT call admin_pay_driver_now / finalize_driver_payout — unpaid
 * delivery earnings await SCT via transfers/run.
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

  const driverUserId = userData.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const bodyDriverId = String(body.driver_id ?? "").trim();
  if (bodyDriverId && bodyDriverId !== driverUserId) {
    return mmdLocationJson(
      { ok: false, error: "Forbidden", message: "driver_id body parameter is not accepted" },
      403
    );
  }

  const currency = String(body.currency ?? "USD")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return mmdLocationJson({ ok: false, error: "Invalid currency" }, 400);
  }
  if (currency !== "USD") {
    return mmdLocationJson({ ok: false, error: "Unsupported currency" }, 400);
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();

    const { data: profileRow, error: roleErr } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", driverUserId)
      .maybeSingle();

    if (roleErr) {
      return mmdLocationJson(
        { ok: false, error: "Profile read failed", details: roleErr.message },
        400
      );
    }

    if (!isDriverRole((profileRow as { role?: string } | null)?.role)) {
      return mmdLocationJson(
        { ok: false, error: "Forbidden", message: "Driver role required" },
        403
      );
    }

    const { data: prof, error: profErr } = await supabaseAdmin
      .from("driver_profiles")
      .select("id, user_id, stripe_account_id, stripe_onboarded")
      .eq("user_id", driverUserId)
      .maybeSingle();

    if (profErr) {
      return mmdLocationJson({ ok: false, error: profErr.message }, 400);
    }
    if (!prof) {
      return mmdLocationJson({ ok: false, error: "Driver profile not found" }, 404);
    }

    if (!prof.stripe_account_id) {
      return mmdLocationJson(
        {
          ok: false,
          error: "Driver has no Stripe account",
          message:
            "Aucun compte Stripe Connect trouvé. Appuyez sur Activer les virements pour commencer.",
        },
        400
      );
    }

    if (prof.stripe_onboarded === false) {
      return mmdLocationJson(
        {
          ok: false,
          error: "stripe_setup_required",
          message:
            "Complétez la configuration Stripe pour activer les virements, puis réessayez.",
        },
        400
      );
    }

    // Live Connect gate: never create a payout against a non-ready Express account.
    try {
      const connectAccount = await stripe.accounts.retrieve(
        String(prof.stripe_account_id)
      );
      if (
        !connectAccount.details_submitted ||
        !connectAccount.charges_enabled ||
        !connectAccount.payouts_enabled
      ) {
        return mmdLocationJson(
          {
            ok: false,
            error: "stripe_setup_required",
            message:
              "Votre compte Stripe n'est pas encore prêt pour les virements. Terminez la vérification, puis réessayez.",
          },
          400
        );
      }
    } catch (connectErr) {
      return mmdLocationJson(
        {
          ok: false,
          error: "stripe_account_lookup_failed",
          message: toUserFacingError(
            connectErr,
            "Impossible de vérifier le compte Stripe. Réessayez dans quelques instants."
          ),
        },
        400
      );
    }

    const stripeAccountId = String(prof.stripe_account_id);
    const rateLimit = await isDriverCashoutRateLimited(supabaseAdmin, driverUserId);
    if (rateLimit.limited) {
      return mmdLocationJson(
        {
          ok: false,
          error: "cashout_rate_limited",
          message:
            "Vous avez déjà demandé un cash out récemment. Réessayez dans 24 heures.",
          last_cashout_at: rateLimit.lastCashoutAt,
          money_out_model: MONEY_OUT_MODEL,
        },
        429
      );
    }

    let availableCents = 0;
    try {
      const balance = await fetchConnectUsdBalanceCents(stripeAccountId);
      availableCents = balance.availableCents;
    } catch (balanceErr) {
      return mmdLocationJson(
        {
          ok: false,
          error: "stripe_balance_lookup_failed",
          message: toUserFacingError(
            balanceErr,
            "Impossible de lire le solde Stripe. Réessayez dans quelques instants."
          ),
        },
        400
      );
    }

    if (!Number.isFinite(availableCents) || availableCents <= 0) {
      return mmdLocationJson({
        ok: true,
        stripe_payout_id: null,
        payout_amount_cents: 0,
        currency,
        money_out_model: MONEY_OUT_MODEL,
        message:
          "Nothing to pay — Connect available balance is empty. Unpaid delivery earnings await SCT transfer.",
      });
    }

    if (availableCents < DRIVER_CASHOUT_MINIMUM_CENTS) {
      return mmdLocationJson(
        {
          ok: false,
          error: "below_minimum",
          message: `Minimum cash out is ${DRIVER_CASHOUT_MINIMUM_CENTS} cents.`,
          payout_amount_cents: availableCents,
          currency,
          money_out_model: MONEY_OUT_MODEL,
        },
        400
      );
    }

    const amountCents = availableCents;

    const audit = await createPayoutTransaction(supabaseAdmin, {
      countryCode: "US",
      recipientType: "driver",
      recipientUserId: driverUserId,
      provider: "stripe_connect",
      methodCode: "payout_stripe_connect",
      amountCents,
      currency,
      status: "processing",
      payoutMode: "manual",
      destinationAccount: stripeAccountId,
      providerPayload: {
        source: "mobile_wallet_cashout",
        money_out_model: MONEY_OUT_MODEL.driverCashout,
      },
    });

    let payout;
    try {
      payout = await stripe.payouts.create(
        {
          amount: amountCents,
          currency: currency.toLowerCase(),
          metadata: {
            driver_id: driverUserId,
            driver_profile_id: String(prof.id ?? ""),
            payout_transaction_id: String(audit.id),
            source: "mobile_wallet_cashout",
          },
        },
        {
          stripeAccount: stripeAccountId,
          idempotencyKey: `driver-connect-payout:${audit.id}`,
        }
      );
    } catch (stripeErr) {
      await updatePayoutTransactionStatus(supabaseAdmin, audit.id, "failed", {
        failure_reason: toUserFacingError(stripeErr, "Stripe payout create failed"),
      });
      throw stripeErr;
    }

    await updatePayoutTransactionStatus(supabaseAdmin, audit.id, "paid", {
      external_reference: payout.id,
      provider_payload: {
        source: "mobile_wallet_cashout",
        stripe_payout_id: payout.id,
        money_out_model: MONEY_OUT_MODEL.driverCashout,
      },
    });

    return mmdLocationJson({
      ok: true,
      stripe_payout_id: payout.id,
      payout_amount_cents: amountCents,
      currency,
      money_out_model: MONEY_OUT_MODEL,
      message: "Connect available balance payout created.",
      payout_transaction_id: audit.id,
      driver_id: driverUserId,
    });
  } catch (e) {
    console.error("[wallet/driver-cashout]", e);
    return mmdLocationJson(
      {
        ok: false,
        error: toUserFacingError(e, "Unable to request cash out."),
      },
      500
    );
  }
}
