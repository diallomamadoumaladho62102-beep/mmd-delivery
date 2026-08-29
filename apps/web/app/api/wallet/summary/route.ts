import { NextRequest } from "next/server";
import { getBearerToken, getSupabaseAdminClient, getSupabaseUserClient, mmdLocationJson } from "@/lib/mmdLocationCore";
import { assertProfileActive, inactiveAccountBody } from "@/lib/requireActiveAccount";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";
import { buildWorkerWalletSummary } from "@/lib/finance/workerWalletSummary";
import { getWalletBalance } from "@/lib/payoutTransactionService";
import type { WalletAccountType } from "@/lib/payoutTypes";
import { currencyForPlatformCountry } from "@/lib/platformCurrency";
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

const CLIENT_WALLET_NOTE =
  "Personal clients use MMD credit for checkout discounts. The ledger shows payment activity (charges and refunds). There is no Connect cashout; top-up is Business-wallet only.";

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
  const currency = String(
    url.searchParams.get("currency") ?? currencyForPlatformCountry(countryCode)
  )
    .trim()
    .toUpperCase();

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const account = await assertProfileActive(supabaseAdmin, data.user.id);
    if (account.ok === false) {
      return mmdLocationJson(inactiveAccountBody(account), account.status);
    }

    if (accountType === "driver") {
      const summary = await buildWorkerWalletSummary(supabaseAdmin, {
        role: "driver",
        userId: data.user.id,
        countryCode,
      });
      return mmdLocationJson({ ok: true, ...summary });
    }

    if (accountType === "restaurant") {
      const summary = await buildWorkerWalletSummary(supabaseAdmin, {
        role: "restaurant",
        userId: data.user.id,
        countryCode,
      });
      return mmdLocationJson({ ok: true, ...summary });
    }

    if (accountType === "seller") {
      const summary = await buildWorkerWalletSummary(supabaseAdmin, {
        role: "seller",
        userId: data.user.id,
        countryCode,
      });
      return mmdLocationJson({ ok: true, ...summary });
    }

    if (accountType === "client") {
      const userId = data.user.id;
      const [balanceCents, availableRes, ledgerRes] = await Promise.all([
        getWalletBalance(supabaseAdmin, "client", userId, currency),
        supabaseAdmin.rpc("mmd_credit_available_cents", { p_user_id: userId }),
        supabaseAdmin
          .from("wallet_ledger")
          .select("direction, amount_cents, reference_type")
          .eq("account_type", "client")
          .eq("account_user_id", userId)
          .limit(500),
      ]);

      if (availableRes.error) {
        throw new Error(availableRes.error.message);
      }
      if (ledgerRes.error && ledgerRes.error.code !== "42P01") {
        throw new Error(ledgerRes.error.message);
      }

      const availableRaw = availableRes.data;
      const availableCents =
        availableRaw != null && Number.isFinite(Number(availableRaw))
          ? Math.max(0, Math.round(Number(availableRaw)))
          : 0;

      let refundedCents = 0;
      let creditsCents = 0;
      let debitsCents = 0;
      for (const row of ledgerRes.data ?? []) {
        const amt = Math.max(0, Math.round(Number((row as { amount_cents?: unknown }).amount_cents ?? 0)));
        const direction = String((row as { direction?: unknown }).direction ?? "").toLowerCase();
        const refType = String((row as { reference_type?: unknown }).reference_type ?? "").toLowerCase();
        if (direction === "credit") {
          creditsCents += amt;
          if (refType.includes("refund")) refundedCents += amt;
        } else if (direction === "debit") {
          debitsCents += amt;
        }
      }

      return mmdLocationJson({
        ok: true,
        account_type: "client",
        country_code: countryCode,
        currency,
        balance_cents: balanceCents,
        available_cents: availableCents,
        refunded_cents: refundedCents,
        credits_cents: creditsCents,
        debits_cents: debitsCents,
        can_cashout: false,
        cashout_block_reason: "client_spend_wallet",
        note: CLIENT_WALLET_NOTE,
        money_out_model: MONEY_OUT_MODEL,
      });
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
