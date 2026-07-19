import { NextRequest, NextResponse } from "next/server";
import { ensureSellerReferralCode } from "@/lib/loyalty/marketplaceLoyaltyApi";
import { requireSellerApiUser } from "@/lib/sellerLoyaltyAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFERRAL_BASE_URL = "https://www.mmddelivery.com/vendeur/r";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireSellerApiUser(req);
    if (auth.ok === false) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }
    const { admin, sellerUserId } = auth.ctx;

    const code = await ensureSellerReferralCode(admin, sellerUserId);

    const { data: referrals } = await admin
      .from("marketplace_referrals")
      .select("id, referred_user_id, status, created_at, rewarded_at")
      .eq("referrer_user_id", sellerUserId)
      .order("created_at", { ascending: false })
      .limit(100);

    const list = referrals ?? [];
    const rewarded = list.filter((r) => r.status === "rewarded").length;

    return NextResponse.json({
      ok: true,
      code,
      link: code ? `${REFERRAL_BASE_URL}/${code}` : null,
      referrals: list,
      counts: { total: list.length, rewarded, pending: list.length - rewarded },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireSellerApiUser(req);
    if (auth.ok === false) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }
    const { admin, sellerUserId } = auth.ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const code = String(body.code ?? "").trim();
    if (!code) return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });

    const { data, error } = await admin.rpc("mmd_marketplace_referral_apply", {
      p_referred_user_id: sellerUserId,
      p_code: code,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok === false) {
      return NextResponse.json({ ok: false, ...result }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
