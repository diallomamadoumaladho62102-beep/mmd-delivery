import { NextRequest } from "next/server";
import { getBearerToken, getSupabaseAdminClient, getSupabaseUserClient, mmdLocationJson } from "@/lib/mmdLocationCore";
import { listWalletLedgerForUser } from "@/lib/payoutTransactionService";
import type { WalletAccountType } from "@/lib/payoutTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCOUNT_TYPES = new Set<WalletAccountType>([
  "driver",
  "restaurant",
  "seller",
  "partner",
  "client",
]);

export async function GET(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) {
    return mmdLocationJson({ ok: false, error: "Missing Authorization Bearer token" }, 401);
  }

  const supabaseUser = getSupabaseUserClient(token);
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data.user?.id) {
    return mmdLocationJson({ ok: false, error: "Invalid token" }, 401);
  }

  const url = new URL(req.url);
  const accountType = String(url.searchParams.get("account_type") ?? "driver").trim() as WalletAccountType;
  if (!ACCOUNT_TYPES.has(accountType)) {
    return mmdLocationJson({ ok: false, error: "invalid_account_type" }, 400);
  }

  const limitRaw = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.round(limitRaw), 1), 100) : 50;

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const items = await listWalletLedgerForUser(
      supabaseAdmin,
      accountType,
      data.user.id,
      limit
    );

    return mmdLocationJson({
      ok: true,
      account_type: accountType,
      items,
    });
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "wallet_history_failed" },
      500
    );
  }
}
