/**
 * LEGACY Edge Cash Out — PERMANENTLY DISABLED.
 *
 * Sole Worker Cash Out path: Vercel POST /api/wallet/driver-cashout
 * → WorkerFinance.executeWorkerCashOut (Instant debit card only).
 *
 * This function must never call stripe.payouts.create.
 */
import { buildCorsHeaders } from "../_shared/cors.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type Json = Record<string, unknown>;

function json(req: Request, body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  return json(
    req,
    {
      ok: false,
      disabled: true,
      permanently: true,
      handler: "vercel",
      path: "/api/wallet/driver-cashout",
      message:
        "Legacy Edge pay-driver-now is permanently disabled. Use WorkerFinance via POST /api/wallet/driver-cashout.",
    },
    410,
  );
});
