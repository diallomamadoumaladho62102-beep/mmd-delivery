import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ProcessResult = {
  payout_id: string | null;
  ok: boolean;
  transfer_id?: string;
  amount?: number;
  currency?: string;
  error?: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    const cronSecret = Deno.env.get("CRON_SECRET");
    const cronHeader = req.headers.get("x-cron-secret");

    if (!cronSecret || cronHeader !== cronSecret) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !serviceKey || !stripeKey) {
      return json({ ok: false, error: "Missing server env vars" }, 500);
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: payouts, error: payoutErr } = await supabase
      .from("driver_payouts")
      .select(
        "id, driver_id, amount, currency, status, stripe_transfer_id, stripe_payout_id"
      )
      .eq("status", "scheduled")
      .is("stripe_transfer_id", null)
      .order("scheduled_at", { ascending: true })
      .limit(20);

    if (payoutErr) {
      return json(
        { ok: false, step: "load_payouts", error: payoutErr.message },
        500
      );
    }

    if (!payouts?.length) {
      return json({ ok: true, processed: 0, message: "No scheduled payouts" });
    }

    const results: ProcessResult[] = [];

    for (const payout of payouts) {
      try {
        const payoutId = String(payout.id ?? "");
        const driverId = String(payout.driver_id ?? "");
        const amount = Number(payout.amount ?? 0);
        const currency = String(payout.currency ?? "USD").toLowerCase();

        if (!payoutId || !driverId || !Number.isFinite(amount) || amount <= 0) {
          results.push({
            payout_id: payoutId || null,
            ok: false,
            error: "Invalid payout row",
          });
          continue;
        }

        const { count, error: orderCountErr } = await supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("driver_payout_id", payoutId)
          .eq("driver_id", driverId)
          .eq("driver_paid_out", false);

        if (orderCountErr) {
          results.push({
            payout_id: payoutId,
            ok: false,
            error: orderCountErr.message,
          });
          continue;
        }

        if (!count || count <= 0) {
          await supabase
            .from("driver_payouts")
            .update({ status: "canceled" })
            .eq("id", payoutId);

          results.push({
            payout_id: payoutId,
            ok: false,
            error: "No unpaid orders attached",
          });
          continue;
        }

        const { data: profile, error: profileErr } = await supabase
          .from("driver_profiles")
          .select("id, user_id, stripe_account_id, stripe_onboarded")
          .or(`user_id.eq.${driverId},id.eq.${driverId}`)
          .maybeSingle();

        if (
          profileErr ||
          !profile?.stripe_account_id ||
          profile.stripe_onboarded === false
        ) {
          results.push({
            payout_id: payoutId,
            ok: false,
            error: profileErr?.message ?? "Driver Stripe account not ready",
          });
          continue;
        }

        const amountCents = Math.round(amount * 100);

        if (!Number.isFinite(amountCents) || amountCents <= 0) {
          results.push({
            payout_id: payoutId,
            ok: false,
            error: "Invalid payout amount",
          });
          continue;
        }

        const transfer = await stripe.transfers.create(
          {
            amount: amountCents,
            currency,
            destination: profile.stripe_account_id,
            description: `MMD driver payout ${payoutId}`,
            metadata: {
              payout_id: payoutId,
              driver_id: driverId,
              source: "process_driver_payouts",
            },
          },
          {
            idempotencyKey: `driver-payout-transfer:${payoutId}`,
          }
        );

        const { error: saveTransferErr } = await supabase
          .from("driver_payouts")
          .update({
            stripe_transfer_id: transfer.id,
          })
          .eq("id", payoutId);

        if (saveTransferErr) {
          results.push({
            payout_id: payoutId,
            ok: false,
            transfer_id: transfer.id,
            error: `Transfer created but save failed: ${saveTransferErr.message}`,
          });
          continue;
        }

        const { error: finalizeErr } = await supabase.rpc(
          "finalize_driver_payout",
          {
            p_payout_id: payoutId,
            p_stripe_payout_id: transfer.id,
          }
        );

        if (finalizeErr) {
          results.push({
            payout_id: payoutId,
            ok: false,
            transfer_id: transfer.id,
            error: `Transfer created but finalize failed: ${finalizeErr.message}`,
          });
          continue;
        }

        results.push({
          payout_id: payoutId,
          ok: true,
          transfer_id: transfer.id,
          amount,
          currency: currency.toUpperCase(),
        });
      } catch (e) {
        results.push({
          payout_id: String(payout?.id ?? "") || null,
          ok: false,
          error: errMsg(e),
        });
      }
    }

    const processed = results.filter((r) => r.ok).length;

    return json({
      ok: true,
      processed,
      examined: payouts.length,
      results,
    });
  } catch (e) {
    return json({ ok: false, error: errMsg(e) }, 500);
  }
});