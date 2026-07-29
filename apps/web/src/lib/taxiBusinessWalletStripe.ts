import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { creditBusinessWalletTopup } from "@/lib/taxiBusinessWalletService";

function metaGet(
  metadata: Stripe.Metadata | null | undefined,
  keys: string[]
): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const val = String(metadata[key] ?? "").trim();
    if (val) return val;
  }
  return null;
}

export async function handleBusinessWalletTopupPayment(params: {
  supabaseAdmin: SupabaseClient;
  paymentIntent?: Stripe.PaymentIntent | null;
  session?: Stripe.Checkout.Session | null;
  source: string;
}): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const metadata =
    params.paymentIntent?.metadata ?? params.session?.metadata ?? null;
  const kind = metaGet(metadata, ["kind"]);
  if (kind !== "business_wallet_topup") {
    return { ok: true, skipped: "not_business_wallet_topup" };
  }

  const businessAccountId = metaGet(metadata, ["business_account_id"]);
  if (!businessAccountId) {
    return { ok: false, error: "missing_business_account_id" };
  }

  const paymentIntentId =
    params.paymentIntent?.id ??
    (typeof params.session?.payment_intent === "string"
      ? params.session.payment_intent
      : params.session?.payment_intent &&
          typeof params.session.payment_intent === "object"
        ? params.session.payment_intent.id
        : null);

  if (!paymentIntentId) {
    return { ok: false, error: "missing_payment_intent" };
  }

  const amountCents = Math.round(
    Number(
      metaGet(metadata, ["amount_cents"]) ??
        params.paymentIntent?.amount ??
        params.session?.amount_total ??
        0
    )
  );
  const currency = String(
    params.paymentIntent?.currency ?? params.session?.currency ?? "usd"
  ).toUpperCase();

  let chargeId: string | null = null;
  const latest = params.paymentIntent?.latest_charge;
  if (typeof latest === "string") chargeId = latest;
  else if (latest && typeof latest === "object" && "id" in latest) {
    chargeId = String((latest as { id: string }).id);
  }

  const result = await creditBusinessWalletTopup(params.supabaseAdmin, {
    businessAccountId,
    amountCents,
    currency,
    paymentIntentId,
    chargeId,
  });

  if (result.ok === false) return { ok: false, error: result.error };
  console.log("[business-wallet] top-up credited", {
    businessAccountId,
    paymentIntentId,
    amountCents,
    source: params.source,
  });
  return { ok: true };
}
