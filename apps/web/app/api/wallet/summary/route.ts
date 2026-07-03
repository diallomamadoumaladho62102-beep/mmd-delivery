import { NextRequest } from "next/server";
import { getBearerToken, getSupabaseAdminClient, getSupabaseUserClient, mmdLocationJson } from "@/lib/mmdLocationCore";
import { buildDriverWalletSummary } from "@/lib/driverWalletService";
import { getWalletBalance } from "@/lib/payoutTransactionService";
import type { WalletAccountType } from "@/lib/payoutTypes";
import { normalizeCountryCode } from "@/lib/paymentProviderRouting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCOUNT_TYPES = new Set<WalletAccountType>([
  "driver",
  "restaurant",
  "seller",
  "partner",
  "client",
]);

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  FR: "EUR",
  GN: "GNF",
  SN: "XOF",
  CI: "XOF",
};

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

  const countryCode = normalizeCountryCode(url.searchParams.get("country_code") ?? "US");
  const currency = String(url.searchParams.get("currency") ?? CURRENCY_BY_COUNTRY[countryCode] ?? "USD")
    .trim()
    .toUpperCase();

  try {
    const supabaseAdmin = getSupabaseAdminClient();

    if (accountType === "driver") {
      const summary = await buildDriverWalletSummary(
        supabaseAdmin,
        data.user.id,
        countryCode
      );
      return mmdLocationJson({ ok: true, ...summary });
    }

    const balanceCents = await getWalletBalance(
      supabaseAdmin,
      accountType,
      data.user.id,
      currency
    );

    return mmdLocationJson({
      ok: true,
      account_type: accountType,
      country_code: countryCode,
      currency,
      balance_cents: balanceCents,
    });
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "wallet_summary_failed" },
      500
    );
  }
}
