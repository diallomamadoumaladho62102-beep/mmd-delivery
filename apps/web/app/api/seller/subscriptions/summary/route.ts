import { NextRequest, NextResponse } from "next/server";
import { requireSellerApiUser } from "@/lib/sellerLoyaltyAuth";
import { buildSubscriptionPortalSummary } from "@/lib/subscriptions/subscriptionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireSellerApiUser(req);
    if (auth.ok === false) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }
    const summary = await buildSubscriptionPortalSummary(
      auth.ctx.admin,
      "seller",
      auth.ctx.sellerUserId
    );
    return NextResponse.json({ ok: true, ...summary });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
