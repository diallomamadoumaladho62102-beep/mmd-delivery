import { NextRequest, NextResponse } from "next/server";
import { requireSellerApiUser } from "@/lib/sellerLoyaltyAuth";
import { buildSellerLoyaltySummary } from "@/lib/loyalty/marketplaceLoyaltyApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireSellerApiUser(req);
    if (auth.ok === false) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }

    const summary = await buildSellerLoyaltySummary(auth.ctx.admin, auth.ctx.sellerUserId);
    return NextResponse.json({ ok: true, summary });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
