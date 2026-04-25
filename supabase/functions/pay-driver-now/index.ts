import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getErrorMessage(e: unknown) {
  if (e instanceof Error && e.message) return e.message;
  return String(e);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey) {
      return json({ error: "Missing server environment variables" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const driverId = String(body?.driver_id ?? "").trim();
    const cur = String(body?.currency ?? "USD").trim().toUpperCase();

    if (!driverId) {
      return json({ error: "driver_id required" }, 400);
    }

    if (!/^[A-Za-z0-9_-]+$/.test(driverId)) {
      return json({ error: "Invalid driver_id" }, 400);
    }

    if (!/^[A-Z]{3}$/.test(cur)) {
      return json({ error: "Invalid currency" }, 400);
    }

    const { data: prof, error: profErr } = await supabase
      .from("driver_profiles")
      .select("id, user_id, stripe_account_id, stripe_onboarded")
      .or(`user_id.eq.${driverId},id.eq.${driverId}`)
      .maybeSingle();

    if (profErr) {
      return json({ error: profErr.message }, 400);
    }

    if (!prof) {
      return json({ error: "Driver profile not found" }, 404);
    }

    if (!prof.stripe_account_id) {
      return json({ error: "Driver has no stripe_account_id" }, 400);
    }

    if (prof.stripe_onboarded === false) {
      return json({ error: "Driver not onboarded" }, 400);
    }

    const payoutDriverId = prof.user_id || prof.id || driverId;

    const { data: prep, error: prepErr } = await supabase.rpc(
      "admin_pay_driver_now",
      {
        p_driver_id: payoutDriverId,
        p_currency: cur,
      }
    );

    if (prepErr) {
      return json({ error: prepErr.message }, 400);
    }

    const row = Array.isArray(prep) ? prep[0] : prep;
    const payoutAmount = Number(row?.payout_amount ?? 0);
    const payoutId = row?.payout_id;

    if (!payoutId || !Number.isFinite(payoutAmount) || payoutAmount <= 0) {
      return json({
        ok: true,
        message: "Nothing to pay",
        payout_amount: 0,
      });
    }

    const amountCents = Math.round(payoutAmount * 100);

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return json({ error: "Invalid payout amount" }, 400);
    }

    const payout = await stripe.payouts.create(
      {
        amount: amountCents,
        currency: cur.toLowerCase(),
        metadata: {
          driver_id: payoutDriverId,
          driver_profile_id: String(prof.id ?? ""),
          payout_id: String(payoutId),
          source: "mobile_wallet_cashout",
        },
      },
      {
        stripeAccount: prof.stripe_account_id,
        idempotencyKey: `driver-payout:${payoutId}`,
      }
    );

    const { error: finErr } = await supabase.rpc("finalize_driver_payout", {
      p_payout_id: payoutId,
      p_stripe_payout_id: payout.id,
    });

    if (finErr) {
      return json(
        {
          error: "Stripe payout created but DB finalize failed",
          details: finErr.message,
          payout_id: payoutId,
          stripe_payout_id: payout.id,
        },
        500
      );
    }

    return json({
      ok: true,
      payout_id: payoutId,
      stripe_payout_id: payout.id,
      payout_amount: payoutAmount,
      currency: cur,
    });
  } catch (e) {
    return json({ error: getErrorMessage(e) }, 500);
  }
});