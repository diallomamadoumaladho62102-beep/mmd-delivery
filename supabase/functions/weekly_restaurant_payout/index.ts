import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

// URL publique des Edge Functions (prod)
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Use POST" }, 405);

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }
    if (!CRON_SECRET) {
      return json({ error: "Missing CRON_SECRET" }, 500);
    }

    // ✅ petite barrière: le CRON doit envoyer x-cron-secret
    const provided = req.headers.get("x-cron-secret") ?? "";
    if (provided !== CRON_SECRET) {
      return json({ error: "Forbidden (bad cron secret)" }, 403);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1) Restaurants avec payouts activés
    const { data: restaurants, error: rErr } = await admin
      .from("restaurant_profiles")
      .select("user_id")
      .eq("stripe_payouts_enabled", true);

    if (rErr) throw rErr;

    if (!restaurants || restaurants.length === 0) {
      return json({ ok: true, message: "No restaurants to payout", count: 0 });
    }

    // 2) Boucle payout
    const results: any[] = [];

    for (const r of restaurants) {
      try {
        // IMPORTANT: on appelle pay_restaurant_now en mode CRON (pas besoin de JWT user)
        const res = await fetch(`${FUNCTIONS_BASE}/pay_restaurant_now`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": Deno.env.get("SUPABASE_ANON_KEY") ?? "", // optionnel si ton pay_restaurant_now ne l'exige pas
            "x-cron-secret": CRON_SECRET, // ✅ pass-through
          },
          body: JSON.stringify({ restaurant_user_id: r.user_id, auto: true }),
        });

        const out = await res.json().catch(() => ({}));
        results.push({ restaurant_user_id: r.user_id, status: res.status, out });
      } catch (e: any) {
        results.push({
          restaurant_user_id: r.user_id,
          status: 500,
          out: { error: e?.message ?? "Unknown error" },
        });
      }
    }

    return json({
      ok: true,
      message: "Weekly restaurant payouts done",
      count: restaurants.length,
      results,
    });
  } catch (e: any) {
    console.log("weekly_restaurant_payout error:", e?.message ?? e);
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
});
