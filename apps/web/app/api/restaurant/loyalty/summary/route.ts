import { NextRequest, NextResponse } from "next/server";
import { requireRestaurantApiUser } from "@/lib/restaurantCommandCenterAuth";
import { buildRestaurantLoyaltySummary } from "@/lib/loyalty/restaurantLoyaltyApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRestaurantApiUser(req);
    if (auth.ok === false) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }

    const summary = await buildRestaurantLoyaltySummary(auth.ctx.admin, auth.ctx.restaurantUserId);
    return NextResponse.json({ ok: true, summary });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
