import { NextRequest } from "next/server";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
import { listSellerWalletActivity } from "@/lib/finance/sellerWalletActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Seller marketplace money activity (payouts, ledger entries, refunds).
 */
export async function GET(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) {
    return mmdLocationJson(
      { ok: false, error: "Missing Authorization Bearer token" },
      401
    );
  }

  const supabaseUser = getSupabaseUserClient(token);
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data.user?.id) {
    return mmdLocationJson({ ok: false, error: "Invalid token" }, 401);
  }

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.round(limitRaw), 1), 100)
    : 50;

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const items = await listSellerWalletActivity(
      supabaseAdmin,
      data.user.id,
      limit
    );
    return mmdLocationJson({ ok: true, account_type: "seller", items });
  } catch (e) {
    return mmdLocationJson(
      {
        ok: false,
        error: e instanceof Error ? e.message : "seller_wallet_activity_failed",
      },
      500
    );
  }
}
