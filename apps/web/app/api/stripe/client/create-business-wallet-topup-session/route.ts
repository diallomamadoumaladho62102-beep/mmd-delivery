import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { PAYMENT_METADATA_SCHEMA_VERSION } from "@/lib/requirePaymentIntentSucceeded";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appBaseUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://www.mmddelivery.com";
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const businessAccountId = String(body.business_account_id ?? "").trim();
    const amountCents = Math.round(Number(body.amount_cents ?? 0));

    if (!businessAccountId) {
      return taxiJson({ ok: false, error: "business_account_id_required" }, 400);
    }
    if (!Number.isFinite(amountCents) || amountCents < 500) {
      return taxiJson({ ok: false, error: "min_topup_500_cents" }, 400);
    }

    const { data: membership, error: memErr } = await auth.supabaseAdmin
      .from("taxi_business_members")
      .select("id,role")
      .eq("business_account_id", businessAccountId)
      .eq("user_id", auth.user.id)
      .eq("active", true)
      .maybeSingle();

    if (memErr) return taxiJson({ ok: false, error: memErr.message }, 500);
    if (!membership || !["manager", "admin"].includes(String(membership.role))) {
      return taxiJson({ ok: false, error: "forbidden" }, 403);
    }

    const { data: account, error: accountErr } = await auth.supabaseAdmin
      .from("taxi_business_accounts")
      .select("id,name,currency,stripe_customer_id,active")
      .eq("id", businessAccountId)
      .maybeSingle();

    if (accountErr || !account) {
      return taxiJson({ ok: false, error: accountErr?.message ?? "not_found" }, 404);
    }
    if (account.active === false) {
      return taxiJson({ ok: false, error: "account_inactive" }, 400);
    }

    const currency = String(account.currency ?? "USD").toLowerCase();
    const base = appBaseUrl();

    let customerId = String(account.stripe_customer_id ?? "").trim() || undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: auth.user.email ?? undefined,
        metadata: {
          business_account_id: businessAccountId,
          kind: "business_wallet",
        },
      });
      customerId = customer.id;
      await auth.supabaseAdmin
        .from("taxi_business_accounts")
        .update({ stripe_customer_id: customerId })
        .eq("id", businessAccountId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      success_url: `${base}/business/wallet?topup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/business/wallet?topup=cancel`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: amountCents,
            product_data: {
              name: `MMD Business Wallet top-up — ${account.name}`,
            },
          },
        },
      ],
      metadata: {
        schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
        kind: "business_wallet_topup",
        service_type: "business_wallet",
        business_account_id: businessAccountId,
        user_id: auth.user.id,
        amount_cents: String(amountCents),
      },
      payment_intent_data: {
        metadata: {
          schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
          kind: "business_wallet_topup",
          service_type: "business_wallet",
          business_account_id: businessAccountId,
          user_id: auth.user.id,
          amount_cents: String(amountCents),
        },
      },
    });

    return taxiJson({
      ok: true,
      session_id: session.id,
      url: session.url,
      amount_cents: amountCents,
      currency: currency.toUpperCase(),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
