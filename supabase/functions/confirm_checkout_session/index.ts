// S0-2: Disabled — unauthenticated service-role path could mark orders paid.
// Canonical flow: Stripe webhook (Next.js or Edge) + mark_order_paid RPC.
// Mobile: poll orders.payment_status after checkout (apps/mobile/src/lib/stripe.ts).

import { buildCorsHeaders } from "../_shared/cors.ts";

function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return json(req, 200, { ok: true });
  }

  if (req.method !== "POST") {
    return json(req, 405, { error: "Method Not Allowed" });
  }

  return json(req, 410, {
    ok: false,
    error: "confirm_checkout_session_disabled",
    message:
      "This endpoint is disabled. Use Stripe webhook + database polling for payment confirmation.",
    replacement: "stripe_webhook + mark_order_paid",
  });
});
