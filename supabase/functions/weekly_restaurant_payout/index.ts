import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SITE_URL = (
  Deno.env.get("PUBLIC_APP_URL") ??
  Deno.env.get("NEXT_PUBLIC_SITE_URL") ??
  Deno.env.get("SITE_URL") ??
  ""
).replace(/\/$/, "");

function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  // Canonical restaurant payouts live on Vercel (admin/cron), not Edge→Edge JWT.
  // Legacy Edge money-out is disabled unless MMD_EDGE_PAYOUTS_DISABLED=false.
  if (
    Deno.env.get("MMD_EDGE_PAYOUTS_DISABLED") !== "false" ||
    !SITE_URL
  ) {
    return json(req, {
      ok: true,
      disabled: true,
      handler: "vercel",
      path: "/api/admin/process-payouts",
      message:
        "Edge weekly restaurant payout is disabled by default. Use Vercel /api/admin/process-payouts with cron auth.",
    });
  }

  try {
    if (req.method !== "POST") return json(req, { error: "Use POST" }, 405);
    if (!CRON_SECRET) return json(req, { error: "Missing CRON_SECRET" }, 500);

    const provided = req.headers.get("x-cron-secret") ?? "";
    if (provided !== CRON_SECRET) {
      return json(req, { error: "Forbidden (bad cron secret)" }, 403);
    }

    const res = await fetch(`${SITE_URL}/api/admin/process-payouts?force=true&limit=100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${CRON_SECRET}`,
        "x-cron-secret": CRON_SECRET,
      },
      body: JSON.stringify({ source: "edge_weekly_restaurant_payout" }),
    });

    const out = await res.json().catch(() => ({}));
    return json(
      req,
      {
        ok: res.ok,
        handler: "vercel",
        status: res.status,
        out,
      },
      res.ok ? 200 : 502
    );
  } catch (e) {
    return json(
      req,
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      500
    );
  }
});
