import { NextRequest, NextResponse } from "next/server";
import { stripe, webhookSecret } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  try {
    const event = stripe.webhooks.constructEvent(raw, sig!, webhookSecret!);
    if (event.type === "checkout.session.completed") {
      // TODO: maj commande -> accepted / preparing
    }
    return NextResponse.json({ received: true });
  } catch (e: any) {
    return new NextResponse(`Webhook Error: ${e.message}`, { status: 400 });
  }
}


