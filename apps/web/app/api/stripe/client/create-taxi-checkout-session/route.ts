import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import {
  getSupabaseAdminClient,
  getSupabaseUserClient,
  getTaxiRideId,
  normalizeStatus,
  taxiJson,
} from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  taxiRideId?: string;
  taxi_ride_id?: string;
  successUrl?: string;
  cancelUrl?: string;
};

function getBearer(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function buildCheckoutUrls(taxiRideId: string, req: NextRequest) {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    req.nextUrl.origin.replace(/\/$/, "");

  return {
    successUrl: `${origin}/stripe/success?taxiRideId=${encodeURIComponent(taxiRideId)}`,
    cancelUrl: `${origin}/stripe/cancel?taxiRideId=${encodeURIComponent(taxiRideId)}`,
  };
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearer(req);
    if (!token) {
      return taxiJson({ error: "Missing Authorization Bearer token" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    let taxiRideId = "";

    try {
      taxiRideId = getTaxiRideId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return taxiJson({ error: message }, 400);
    }

    const supabaseUser = getSupabaseUserClient(token);
    const supabaseAdmin = getSupabaseAdminClient();

    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();

    if (userErr || !user?.id) {
      return taxiJson({ error: "Invalid token" }, 401);
    }

    const { data: ride, error: rideError } = await supabaseAdmin
      .from("taxi_rides")
      .select(
        "id,client_user_id,status,payment_status,total_cents,currency,stripe_session_id,stripe_payment_intent_id,promotion_id,discount_cents"
      )
      .eq("id", taxiRideId)
      .maybeSingle();

    if (rideError) {
      return taxiJson({ error: rideError.message }, 500);
    }

    if (!ride) {
      return taxiJson({ error: "Taxi ride not found" }, 404);
    }

    if (String(ride.client_user_id) !== user.id) {
      return taxiJson({ error: "Forbidden" }, 403);
    }

    if (normalizeStatus(ride.payment_status) === "paid") {
      return taxiJson({
        ok: true,
        already_paid: true,
        taxi_ride_id: taxiRideId,
      });
    }

    const status = normalizeStatus(ride.status);
    if (!["quoted", "pending_payment", "draft"].includes(status)) {
      return taxiJson({ error: "Ride is not payable at this stage" }, 400);
    }

    const amountCents = Math.round(Number(ride.total_cents ?? 0));
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return taxiJson({ error: "Invalid taxi ride amount" }, 400);
    }

    const currency = String(ride.currency ?? "USD").trim().toLowerCase();
    const urls = buildCheckoutUrls(taxiRideId, req);
    const idempotencyKey = `taxi_checkout_${taxiRideId}_${user.id}_${amountCents}_${currency}`;

    await supabaseAdmin
      .from("taxi_rides")
      .update({
        status: "pending_payment",
        payment_status: "processing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", taxiRideId)
      .neq("payment_status", "paid");

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: taxiRideId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: amountCents,
              product_data: {
                name: `MMD Taxi ${taxiRideId.slice(0, 8)}`,
                description: `Taxi ride payment • ${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`,
              },
            },
          },
        ],
        success_url: body.successUrl?.trim() || urls.successUrl,
        cancel_url: body.cancelUrl?.trim() || urls.cancelUrl,
        metadata: {
          module: "taxi",
          taxi_ride_id: taxiRideId,
          taxiRideId: taxiRideId,
          user_id: String(user.id),
          amount_cents: String(amountCents),
          amount_dollars: (amountCents / 100).toFixed(2),
          promotion_id: ride.promotion_id ? String(ride.promotion_id) : "",
          discount_cents: String(Number(ride.discount_cents ?? 0)),
          source_route: "/api/stripe/client/create-taxi-checkout-session",
        },
        payment_intent_data: {
          metadata: {
            module: "taxi",
            taxi_ride_id: taxiRideId,
            taxiRideId: taxiRideId,
            user_id: String(user.id),
            amount_cents: String(amountCents),
            amount_dollars: (amountCents / 100).toFixed(2),
            promotion_id: ride.promotion_id ? String(ride.promotion_id) : "",
            discount_cents: String(Number(ride.discount_cents ?? 0)),
            source_route: "/api/stripe/client/create-taxi-checkout-session",
          },
        },
      },
      { idempotencyKey }
    );

    if (!session.id || !session.url) {
      return taxiJson({ error: "Stripe returned an invalid checkout session" }, 500);
    }

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent &&
            typeof session.payment_intent === "object" &&
            "id" in session.payment_intent
          ? String((session.payment_intent as { id?: string }).id ?? "")
          : null;

    await supabaseAdmin
      .from("taxi_rides")
      .update({
        stripe_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", taxiRideId);

    await logTaxiEventServer(supabaseAdmin, {
      rideId: taxiRideId,
      eventType: "checkout_started",
      oldStatus: status,
      newStatus: "pending_payment",
      actorId: user.id,
      triggeredRole: "client",
      description: "Taxi checkout session created",
      metadata: { stripe_session_id: session.id, promotion_id: ride.promotion_id },
    });

    return taxiJson({
      ok: true,
      url: session.url,
      session_id: session.id,
      taxi_ride_id: taxiRideId,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    console.error("[create-taxi-checkout-session]", message);
    return taxiJson({ error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
