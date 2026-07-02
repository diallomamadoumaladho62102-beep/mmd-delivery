import type Stripe from "stripe";
import { foodStripeUnitAmount } from "@/lib/foodCurrencyGuard";

export type CheckoutBreakdownCents = {
  subtotalCents: number;
  deliveryFeeCents?: number;
  serviceFeeCents?: number;
  taxCents?: number;
  totalCents: number;
};

export type CheckoutBreakdownLine = {
  name: string;
  description?: string;
  amountCents: number;
};

function positiveCents(value: number | undefined): number {
  const cents = Math.round(Number(value ?? 0));
  return Number.isFinite(cents) && cents > 0 ? cents : 0;
}

export function buildCheckoutBreakdownLines(
  input: CheckoutBreakdownCents & {
    subtotalLabel?: string;
    deliveryFeeLabel?: string;
    serviceFeeLabel?: string;
    taxLabel?: string;
  }
): CheckoutBreakdownLine[] {
  const lines: CheckoutBreakdownLine[] = [];

  const subtotalCents = positiveCents(input.subtotalCents);
  const deliveryFeeCents = positiveCents(input.deliveryFeeCents);
  const serviceFeeCents = positiveCents(input.serviceFeeCents);
  const taxCents = positiveCents(input.taxCents);

  if (subtotalCents > 0) {
    lines.push({
      name: input.subtotalLabel ?? "Subtotal",
      amountCents: subtotalCents,
    });
  }

  if (deliveryFeeCents > 0) {
    lines.push({
      name: input.deliveryFeeLabel ?? "Delivery fee",
      amountCents: deliveryFeeCents,
    });
  }

  if (serviceFeeCents > 0) {
    lines.push({
      name: input.serviceFeeLabel ?? "Service fee",
      amountCents: serviceFeeCents,
    });
  }

  if (taxCents > 0) {
    lines.push({
      name: input.taxLabel ?? "Tax",
      amountCents: taxCents,
    });
  }

  const computedTotal =
    subtotalCents + deliveryFeeCents + serviceFeeCents + taxCents;
  const totalCents = positiveCents(input.totalCents);

  if (lines.length === 0) {
    lines.push({
      name: input.subtotalLabel ?? "Total",
      amountCents: totalCents,
    });
    return lines;
  }

  if (totalCents > computedTotal) {
    lines.push({
      name: "Other fees",
      amountCents: totalCents - computedTotal,
    });
  }

  return lines;
}

export function buildStripeCheckoutLineItems(params: {
  currency: string;
  productName: string;
  breakdown: CheckoutBreakdownCents;
  labels?: {
    subtotal?: string;
    deliveryFee?: string;
    serviceFee?: string;
    tax?: string;
  };
}): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const currency = String(params.currency ?? "USD").toLowerCase();
  const breakdownLines = buildCheckoutBreakdownLines({
    ...params.breakdown,
    subtotalLabel: params.labels?.subtotal,
    deliveryFeeLabel: params.labels?.deliveryFee,
    serviceFeeLabel: params.labels?.serviceFee,
    taxLabel: params.labels?.tax,
  });

  const totalFromLines = breakdownLines.reduce(
    (sum, line) => sum + line.amountCents,
    0
  );
  const expectedTotal = positiveCents(params.breakdown.totalCents);

  if (breakdownLines.length <= 1) {
    const amountCents = expectedTotal > 0 ? expectedTotal : totalFromLines;
    return [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: foodStripeUnitAmount(currency, amountCents),
          product_data: {
            name: params.productName,
            description: `Total ${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`,
          },
        },
      },
    ];
  }

  return breakdownLines.map((line) => ({
    quantity: 1,
    price_data: {
      currency,
      unit_amount: foodStripeUnitAmount(currency, line.amountCents),
      product_data: {
        name: `${params.productName} — ${line.name}`,
        description: line.description,
      },
    },
  }));
}
