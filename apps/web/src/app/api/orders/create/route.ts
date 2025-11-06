import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { lineItems, successUrl, cancelUrl } = body;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: lineItems,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return NextResponse.json({ id: session.id, url: session.url });
}

