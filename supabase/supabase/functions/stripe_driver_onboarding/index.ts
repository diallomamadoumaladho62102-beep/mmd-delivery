import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const { user_id, return_url, refresh_url } = await req.json();

    if (!user_id || !return_url || !refresh_url) {
      return new Response(JSON.stringify({ error: "Missing user_id/return_url/refresh_url" }), { status: 400 });
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: driver, error: dErr } = await supabase
      .from("driver_profiles")
      .select("user_id, stripe_account_id")
      .eq("user_id", user_id)
      .single();

    if (dErr || !driver) {
      return new Response(JSON.stringify({ error: "driver_profiles not found", details: dErr }), { status: 400 });
    }

    let accountId = driver.stripe_account_id as string | null;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        capabilities: { transfers: { requested: true } },
      });

      accountId = account.id;

      const { error: updErr } = await supabase
        .from("driver_profiles")
        .update({
          stripe_account_id: accountId,
          stripe_onboarded: false,
          payout_enabled: false,
          stripe_onboarded_at: null,
        })
        .eq("user_id", user_id);

      if (updErr) {
        return new Response(JSON.stringify({ error: "DB update failed", details: updErr }), { status: 500 });
      }
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url,
      return_url,
      type: "account_onboarding",
    });

    return new Response(JSON.stringify({ url: link.url, stripe_account_id: accountId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
