import { NextRequest } from "next/server";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
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
 * Replaces Edge `pay-driver-now` which is disabled by MMD_EDGE_PAYOUTS_DISABLED in production.
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

    const { data: prep, error: prepErr } = await supabaseAdmin.rpc("admin_pay_driver_now", {
      p_driver_id: driverUserId,
      p_currency: currency,
    });

    if (prepErr) {
      const message = prepErr.message ?? "Cash out failed";
      const status = message.includes("cashout_rate_limited") ? 429 : 400;
      return mmdLocationJson({ ok: false, error: message }, status);
    }

    const row = Array.isArray(prep) ? prep[0] : prep;
    const payoutAmount = Number(
      (row as { payout_amount?: unknown } | null)?.payout_amount ?? 0
    );
    const payoutId = (row as { payout_id?: unknown } | null)?.payout_id;

    if (!payoutId || !Number.isFinite(payoutAmount) || payoutAmount <= 0) {
      return mmdLocationJson({
        ok: true,
        message: "Nothing to pay",
        payout_amount: 0,
        payout_amount_cents: 0,
      });
    }

    const amountCents = Math.round(payoutAmount * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return mmdLocationJson({ ok: false, error: "Invalid payout amount" }, 400);
    }

    const payout = await stripe.payouts.create(
      {
        amount: amountCents,
        currency: currency.toLowerCase(),
        metadata: {
          driver_id: driverUserId,
          driver_profile_id: String(prof.id ?? ""),
          payout_id: String(payoutId),
          source: "mobile_wallet_cashout_vercel",
        },
      },
      {
        stripeAccount: String(prof.stripe_account_id),
        idempotencyKey: `driver-payout:${payoutId}`,
      }
    );

    const { error: finErr } = await supabaseAdmin.rpc("finalize_driver_payout", {
      p_payout_id: payoutId,
      p_stripe_payout_id: payout.id,
    });

    if (finErr) {
      return mmdLocationJson(
        {
          ok: false,
          error: "Stripe payout created but DB finalize failed",
          details: finErr.message,
          payout_id: payoutId,
          stripe_payout_id: payout.id,
        },
        500
      );
    }

    return mmdLocationJson({
      ok: true,
      payout_id: payoutId,
      stripe_payout_id: payout.id,
      payout_amount: payoutAmount,
      payout_amount_cents: amountCents,
      currency,
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
