/**
 * LEGACY Edge scheduled driver payouts — PERMANENTLY DISABLED.
 *
 * SCT retry / process-payouts: Vercel /api/admin/process-payouts
 * Sunday bank: Vercel cron /api/cron/driver-connect-bank-payouts → WorkerFinance
 *
 * This function must never call stripe.payouts.create or stripe.transfers.create
 * as a parallel money-out engine.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  return json(
    {
      ok: true,
      disabled: true,
      permanently: true,
      handler: "vercel",
      path: "/api/admin/process-payouts",
      sunday_path: "/api/cron/driver-connect-bank-payouts",
      message:
        "Legacy Edge process_driver_payouts is permanently disabled. Use WorkerFinance via Vercel.",
    },
    200,
  );
});
