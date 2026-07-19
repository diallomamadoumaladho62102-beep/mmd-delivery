import { NextRequest, NextResponse } from "next/server";
import { requireSellerApiUser } from "@/lib/sellerLoyaltyAuth";
import { buildSellerLoyaltySummary } from "@/lib/loyalty/marketplaceLoyaltyApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireSellerApiUser(req);
    if (auth.ok === false) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }
    const { admin, sellerUserId } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rewardId = String(body.reward_id ?? "").trim();
    if (!rewardId) {
      return NextResponse.json({ ok: false, error: "Missing reward_id" }, { status: 400 });
    }
    const idempotencyKey =
      typeof body.idempotency_key === "string" && body.idempotency_key.trim()
        ? body.idempotency_key.trim().slice(0, 120)
        : null;

    const { data, error } = await admin.rpc("mmd_marketplace_redeem_reward", {
      p_seller_user_id: sellerUserId,
      p_reward_id: rewardId,
      p_idempotency_key: idempotencyKey,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok === false) {
      return NextResponse.json({ ok: false, ...result }, { status: 400 });
    }

    const summary = await buildSellerLoyaltySummary(admin, sellerUserId);
    return NextResponse.json({ ok: true, result, summary });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
