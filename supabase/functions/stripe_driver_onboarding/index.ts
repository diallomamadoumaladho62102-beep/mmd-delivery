/// Driver Stripe Connect onboarding — disabled until a production implementation ships.
/// Mobile uses web/API Connect flows; this Edge function must not remain a stub.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const DISABLED_BODY = {
  ok: false,
  error: "stripe_driver_onboarding_disabled",
  message:
    "Driver Stripe onboarding is handled via the production Connect API. This Edge function is intentionally disabled.",
} as const;

Deno.serve((_req) =>
  new Response(JSON.stringify(DISABLED_BODY), {
    status: 410,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  })
);
