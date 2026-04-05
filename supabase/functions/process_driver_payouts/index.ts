import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Result = { payout_id: string; ok: boolean; step?: string; info?: any };

serve(async (_req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")!;

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    const supabase = createClient(supabaseUrl, supabaseService, {
      auth: { persistSession: false },
    });

    // 0) Lire payouts scheduled
    const { data: payouts, error: payErr } = await supabase
      .from("driver_payouts")
      .select("id, driver_id, amount, currency, status, scheduled_at, stripe_payout_id, stripe_transfer_id")
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true })
      .limit(20);

    if (payErr) {
      return new Response(JSON.stringify({ ok: false, step: "select_payouts", error: payErr.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!payouts || payouts.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, debug: "No scheduled payouts" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    const results: Result[] = [];

    for (const p of payouts) {
      if (!p?.id || !p?.driver_id) {
        results.push({ payout_id: String(p?.id ?? "null"), ok: false, step: "invalid_row" });
        continue;
      }

      // anti double-run (si déjà un payout OU un transfer est enregistré)
      if (p.stripe_payout_id || p.stripe_transfer_id) {
        results.push({
          payout_id: p.id,
          ok: false,
          step: "already_has_stripe_refs",
          info: { stripe_payout_id: p.stripe_payout_id, stripe_transfer_id: p.stripe_transfer_id },
        });
        continue;
      }

      // 1) Vérifier orders attachés
      const { count, error: cntErr } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("driver_payout_id", p.id);

      if (cntErr) {
        results.push({ payout_id: p.id, ok: false, step: "count_orders_error", info: cntErr.message });
        continue;
      }
      if (!count || count <= 0) {
        await supabase.from("driver_payouts").update({ status: "canceled" }).eq("id", p.id);
        results.push({ payout_id: p.id, ok: false, step: "no_orders_attached", info: { count } });
        continue;
      }

      // 2) Charger driver Stripe account
      const { data: dp, error: dpErr } = await supabase
        .from("driver_profiles")
        .select("stripe_account_id, stripe_onboarded, user_id, id")
        .or(`user_id.eq.${p.driver_id},id.eq.${p.driver_id}`)
        .single();

      if (dpErr || !dp?.stripe_account_id || dp?.stripe_onboarded === false) {
        await supabase.from("driver_payouts").update({ status: "canceled" }).eq("id", p.id);
        results.push({
          payout_id: p.id,
          ok: false,
          step: "driver_not_ready",
          info: dpErr?.message ?? "missing stripe_account_id or not onboarded",
        });
        continue;
      }

      const cur = (p.currency ?? "USD").toLowerCase();
      const amountCents = Math.round(Number(p.amount) * 100);

      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        await supabase.from("driver_payouts").update({ status: "canceled" }).eq("id", p.id);
        results.push({ payout_id: p.id, ok: false, step: "invalid_amount", info: p.amount });
        continue;
      }

      // 3) TRANSFER (platform -> driver connect balance)
      let transferId: string;
      try {
        const transfer = await stripe.transfers.create({
          amount: amountCents,
          currency: cur,
          destination: dp.stripe_account_id,
          description: `MMD driver earnings transfer for payout ${p.id}`,
          metadata: { payout_id: p.id, driver_id: p.driver_id },
        });
        transferId = transfer.id;
      } catch (e: any) {
        await supabase.from("driver_payouts").update({ status: "canceled" }).eq("id", p.id);
        results.push({ payout_id: p.id, ok: false, step: "stripe_transfer_error", info: e?.message ?? String(e) });
        continue;
      }

      // 4) Enregistrer le transferId (pour audit + anti double-run)
      const { error: saveTrErr } = await supabase
        .from("driver_payouts")
        .update({ stripe_transfer_id: transferId })
        .eq("id", p.id);

      if (saveTrErr) {
        // IMPORTANT: on ne “canceled” pas si transfer déjà fait => on garde scheduled mais avec transfer_id enregistré (ci-dessus a échoué)
        results.push({ payout_id: p.id, ok: false, step: "save_transfer_id_error", info: saveTrErr.message });
        continue;
      }

      // 5) Finalize DB : status=paid + orders.driver_paid_out=true
      // Ici, on met stripe_payout_id = transferId (ou mieux: adapte finalize_driver_payout pour accepter transfer_id)
      const { error: finErr } = await supabase.rpc("finalize_driver_payout", {
        p_payout_id: p.id,
        p_stripe_payout_id: transferId,
      });

      if (finErr) {
        // Surtout pas canceled => transfer déjà fait.
        results.push({ payout_id: p.id, ok: false, step: "finalize_error", info: finErr.message });
        continue;
      }

      processed++;
      results.push({ payout_id: p.id, ok: true, step: "transferred" });
    }

    return new Response(JSON.stringify({ ok: true, processed, examined: payouts.length, results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, step: "uncaught", error: e?.message ?? String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
