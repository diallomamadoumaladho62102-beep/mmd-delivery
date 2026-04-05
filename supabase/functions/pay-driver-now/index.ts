import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });

Deno.serve(async (req) => {
  try {
    // Auth (admin only) : soit via service role, soit tu valides un rôle admin dans DB
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // important
      { auth: { persistSession: false } }
    );

    const { driver_id, currency } = await req.json();
    if (!driver_id) return new Response(JSON.stringify({ error: "driver_id required" }), { status: 400 });

    const cur = (currency ?? "USD").toUpperCase();

    // 1) préparer payout côté DB
    const { data: prep, error: prepErr } = await supabase
      .rpc("admin_pay_driver_now", { p_driver_id: driver_id, p_currency: cur });

    if (prepErr) return new Response(JSON.stringify({ error: prepErr.message }), { status: 400 });

    const row = Array.isArray(prep) ? prep[0] : prep; // selon supabase rpc
    const payout_amount = Number(row?.payout_amount ?? 0);
    const payout_id = row?.payout_id;

    if (!payout_id || payout_amount <= 0) {
      return Response.json({ ok: true, message: "Nothing to pay", payout_amount: 0 });
    }

    // 2) récupérer stripe_account_id
    const { data: prof, error: profErr } = await supabase
      .from("driver_profiles")
      .select("stripe_account_id, stripe_onboarded")
      .eq("id", driver_id)
      .single();

    if (profErr) throw profErr;
    if (!prof?.stripe_account_id) throw new Error("Driver has no stripe_account_id");
    if (prof?.stripe_onboarded === false) throw new Error("Driver not onboarded");

    // 3) créer payout Stripe (amount en cents)
    const amount_cents = Math.round(payout_amount * 100);

    const payout = await stripe.payouts.create(
      { amount: amount_cents, currency: cur.toLowerCase() },
      { stripeAccount: prof.stripe_account_id }
    );

    // 4) finaliser DB (paid_out = true seulement ici)
    const { error: finErr } = await supabase
      .rpc("finalize_driver_payout", { p_payout_id: payout_id, p_stripe_payout_id: payout.id });

    if (finErr) throw finErr;

    return Response.json({ ok: true, payout_id, stripe_payout_id: payout.id, payout_amount });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
