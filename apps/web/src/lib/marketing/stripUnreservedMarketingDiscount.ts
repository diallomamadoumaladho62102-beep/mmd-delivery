import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 10 / 7.1: when pricing baked a marketing discount but reserve failed,
 * strip the unreserved discount from the persisted entity so the client cannot
 * pay less than the server-authorized amount (fail-closed for money).
 */
export type StripMarketingDiscountInput = {
  kind: "food" | "delivery";
  entityId: string;
  marketingOrderDiscount: number;
  marketingDeliveryDiscount: number;
  /** Current persisted totals (currency major units, same as pricing). */
  discounts: number;
  deliveryFee: number;
  total: number;
  subtotalCents?: number | null;
  deliveryFeeCents?: number | null;
  totalCents?: number | null;
  tax?: number | null;
  serviceFee?: number | null;
};

export type StripMarketingDiscountResult = {
  stripped: boolean;
  orderDiscount: number;
  deliveryDiscount: number;
  newDiscounts: number;
  newDeliveryFee: number;
  newTotal: number;
  snapshot: Record<string, unknown>;
};

function roundMoney(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function computeStripUnreservedMarketingDiscount(
  input: StripMarketingDiscountInput
): StripMarketingDiscountResult {
  const orderDiscount = Math.max(0, Number(input.marketingOrderDiscount) || 0);
  const deliveryDiscount = Math.max(
    0,
    Number(input.marketingDeliveryDiscount) || 0
  );
  if (orderDiscount <= 0 && deliveryDiscount <= 0) {
    return {
      stripped: false,
      orderDiscount: 0,
      deliveryDiscount: 0,
      newDiscounts: Number(input.discounts) || 0,
      newDeliveryFee: Number(input.deliveryFee) || 0,
      newTotal: Number(input.total) || 0,
      snapshot: { reason: "no_marketing_discount" },
    };
  }

  const prevDiscounts = Number(input.discounts) || 0;
  const prevDelivery = Number(input.deliveryFee) || 0;
  const prevTotal = Number(input.total) || 0;

  const newDiscounts = roundMoney(
    Math.max(0, prevDiscounts - orderDiscount - deliveryDiscount)
  );
  const newDeliveryFee = roundMoney(prevDelivery + deliveryDiscount);
  const newTotal = roundMoney(prevTotal + orderDiscount + deliveryDiscount);

  return {
    stripped: true,
    orderDiscount,
    deliveryDiscount,
    newDiscounts,
    newDeliveryFee,
    newTotal,
    snapshot: {
      reason: "unreserved_marketing_discount_stripped",
      kind: input.kind,
      entity_id: input.entityId,
      previous: {
        discounts: prevDiscounts,
        delivery_fee: prevDelivery,
        total: prevTotal,
        subtotal_cents: input.subtotalCents ?? null,
        delivery_fee_cents: input.deliveryFeeCents ?? null,
        total_cents: input.totalCents ?? null,
        tax: input.tax ?? null,
        service_fee: input.serviceFee ?? null,
      },
      stripped: {
        order_discount: orderDiscount,
        delivery_discount: deliveryDiscount,
      },
      corrected: {
        discounts: newDiscounts,
        delivery_fee: newDeliveryFee,
        total: newTotal,
        delivery_fee_cents: Math.round(newDeliveryFee * 100),
        total_cents: Math.round(newTotal * 100),
      },
      at: new Date().toISOString(),
    },
  };
}

export async function applyStripUnreservedMarketingDiscount(
  supabaseAdmin: SupabaseClient,
  input: StripMarketingDiscountInput
): Promise<StripMarketingDiscountResult> {
  const computed = computeStripUnreservedMarketingDiscount(input);
  if (!computed.stripped) return computed;

  const table = input.kind === "food" ? "orders" : "delivery_requests";
  const patch: Record<string, unknown> = {
    discounts: computed.newDiscounts,
    delivery_fee: computed.newDeliveryFee,
    total: computed.newTotal,
    delivery_fee_cents: Math.round(computed.newDeliveryFee * 100),
    updated_at: new Date().toISOString(),
  };

  // Prefer not to write generated columns; total_cents may be generated on orders.
  if (input.kind === "delivery") {
    patch.total_cents = Math.round(computed.newTotal * 100);
  }

  const { error } = await supabaseAdmin
    .from(table)
    .update(patch)
    .eq("id", input.entityId);

  if (error) {
    console.error(
      `[marketing] strip unreserved discount failed (${input.kind})`,
      error.message,
      computed.snapshot
    );
    throw new Error(
      `marketing_strip_failed: client would underpay without reservation (${error.message})`
    );
  }

  console.warn(
    `[marketing] ${input.kind} fail-closed: stripped unreserved marketing discount`,
    {
      entityId: input.entityId,
      orderDiscount: computed.orderDiscount,
      deliveryDiscount: computed.deliveryDiscount,
      newTotal: computed.newTotal,
    }
  );

  try {
    await supabaseAdmin.from("admin_alerts").insert({
      kind: "marketing_unreserved_discount",
      severity: "warning",
      title: `Marketing discount stripped (${input.kind})`,
      body: `Entity ${input.entityId}: removed unreserved marketing discount to prevent undercharge.`,
      metadata: computed.snapshot,
    });
  } catch {
    // Alert table may not exist in all envs — non-blocking after strip succeeded.
  }

  return computed;
}
