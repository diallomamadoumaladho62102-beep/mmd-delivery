import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanAccessPayouts,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  classifySundayBankDbEligibility,
  sundayBankBlockLabel,
} from "@/lib/finance/sundayBankEligibility";
import { fetchConnectUsdBalanceCents } from "@/lib/finance/connectUsdBalance";
import {
  DRIVER_BANK_PAYOUT_TIMEZONE,
  getNowPartsInTimeZone,
  isDriverBankPayoutWindow,
} from "@/lib/finance/driverConnectBankPayout";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Role = "driver" | "restaurant" | "seller";

type ProfileRow = {
  user_id: string;
  stripe_account_id?: string | null;
  restaurant_name?: string | null;
  business_name?: string | null;
  stripe_payouts_enabled?: boolean | null;
  stripe_charges_enabled?: boolean | null;
  stripe_details_submitted?: boolean | null;
  stripe_onboarded?: boolean | null;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

async function loadPages(
  supabase: ReturnType<typeof buildSupabaseAdminClient>,
  table: "driver_profiles" | "restaurant_profiles" | "sellers",
  select: string,
): Promise<ProfileRow[]> {
  const pageSize = 100;
  const rows: ProfileRow[] = [];
  for (let from = 0; from < 5000; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}_select_failed: ${error.message}`);
    rows.push(...((data ?? []) as unknown as ProfileRow[]));
    if ((data ?? []).length < pageSize) break;
  }
  return rows;
}

export async function GET(request: NextRequest) {
  try {
    await assertCanAccessPayouts(request);
    const supabase = buildSupabaseAdminClient();
    const liveBalances =
      request.nextUrl.searchParams.get("live_balances") === "1";
    const roleFilter = String(request.nextUrl.searchParams.get("role") ?? "")
      .trim()
      .toLowerCase();

    const [drivers, restaurants, sellers] = await Promise.all([
      loadPages(
        supabase,
        "driver_profiles",
        "user_id, stripe_account_id, stripe_onboarded",
      ),
      loadPages(
        supabase,
        "restaurant_profiles",
        "user_id, restaurant_name, stripe_account_id, stripe_payouts_enabled, stripe_charges_enabled, stripe_details_submitted",
      ),
      loadPages(
        supabase,
        "sellers",
        "user_id, business_name, stripe_account_id, stripe_payouts_enabled, stripe_charges_enabled, stripe_details_submitted",
      ),
    ]);

    const now = new Date();
    const parts = getNowPartsInTimeZone(DRIVER_BANK_PAYOUT_TIMEZONE, now);

    type Item = {
      role: Role;
      user_id: string;
      display_name: string | null;
      stripe_account_id: string | null;
      connect_status: string;
      connect_status_label: string;
      eligible: boolean;
      reason: string | null;
      block_label: string;
      available_cents: number | null;
      pending_cents: number | null;
      last_payout_id: string | null;
      last_payout_status: string | null;
      last_stripe_payout_id: string | null;
      last_payout_amount_cents: number | null;
      last_payout_error: string | null;
      last_payout_at: string | null;
    };

    const items: Item[] = [];
    function pushRole(role: Role, rows: ProfileRow[], nameKey: keyof ProfileRow) {
      for (const row of rows) {
        const classified = classifySundayBankDbEligibility(row);
        items.push({
          role,
          user_id: row.user_id,
          display_name: (row[nameKey] as string | null | undefined) ?? null,
          stripe_account_id: classified.stripeAccountId,
          connect_status: classified.connectStatus,
          connect_status_label: classified.connectStatusLabel,
          eligible: classified.eligible,
          reason: classified.reason,
          block_label: classified.eligible
            ? "Eligible"
            : sundayBankBlockLabel(classified.reason),
          available_cents: null,
          pending_cents: null,
          last_payout_id: null,
          last_payout_status: null,
          last_stripe_payout_id: null,
          last_payout_amount_cents: null,
          last_payout_error: null,
          last_payout_at: null,
        });
      }
    }

    if (!roleFilter || roleFilter === "driver") {
      pushRole("driver", drivers, "user_id");
    }
    if (!roleFilter || roleFilter === "restaurant") {
      pushRole("restaurant", restaurants, "restaurant_name");
    }
    if (!roleFilter || roleFilter === "seller") {
      pushRole("seller", sellers, "business_name");
    }

    const { data: sundayPayouts, error: sundayPayoutsError } = await supabase
      .from("payout_transactions")
      .select(
        "id, recipient_type, recipient_user_id, status, amount_cents, external_reference, failure_reason, created_at, method_code",
      )
      .eq("method_code", "payout_stripe_connect_sunday")
      .order("created_at", { ascending: false })
      .limit(500);
    if (sundayPayoutsError) {
      throw new Error(`sunday_payouts_select_failed: ${sundayPayoutsError.message}`);
    }
    const latestByRecipient = new Map<
      string,
      {
        id: string;
        status: string | null;
        amount_cents: number | null;
        external_reference: string | null;
        failure_reason: string | null;
        created_at: string | null;
      }
    >();
    for (const row of sundayPayouts ?? []) {
      const key = `${String(row.recipient_type)}:${String(row.recipient_user_id)}`;
      if (latestByRecipient.has(key)) continue;
      latestByRecipient.set(key, {
        id: String(row.id),
        status: row.status ?? null,
        amount_cents: Number(row.amount_cents) || 0,
        external_reference: row.external_reference ?? null,
        failure_reason: row.failure_reason ?? null,
        created_at: row.created_at ?? null,
      });
    }
    for (const item of items) {
      const latest = latestByRecipient.get(`${item.role}:${item.user_id}`);
      if (!latest) continue;
      item.last_payout_id = latest.id;
      item.last_payout_status = latest.status;
      item.last_stripe_payout_id = latest.external_reference;
      item.last_payout_amount_cents = latest.amount_cents;
      item.last_payout_error = latest.failure_reason;
      item.last_payout_at = latest.created_at;
    }

    if (liveBalances) {
      const withAccount = items
        .filter((row) => String(row.stripe_account_id ?? "").startsWith("acct_"))
        .slice(0, 40);
      await Promise.all(
        withAccount.map(async (row) => {
          try {
            const bal = await fetchConnectUsdBalanceCents(
              String(row.stripe_account_id),
            );
            row.available_cents = bal.availableCents;
            row.pending_cents = bal.pendingCents;
            if (row.eligible && bal.availableCents <= 0) {
              row.eligible = false;
              row.reason =
                bal.pendingCents > 0
                  ? "pending_funds_settling"
                  : "zero_available_balance";
              row.block_label = sundayBankBlockLabel(row.reason);
            }
          } catch {
            row.reason = row.reason ?? "stripe_balance_unavailable";
          }
        }),
      );
    }

    const summary = {
      total: items.length,
      eligible: items.filter((row) => row.eligible).length,
      missing_stripe_account: items.filter(
        (row) =>
          row.reason === "missing_stripe_account" ||
          row.reason === "invalid_stripe_account",
      ).length,
      stripe_connect_not_ready: items.filter(
        (row) => row.reason === "stripe_connect_not_ready",
      ).length,
      pending_funds: items.filter(
        (row) => row.reason === "pending_funds_settling",
      ).length,
      zero_available: items.filter(
        (row) => row.reason === "zero_available_balance",
      ).length,
      last_processing: items.filter((row) => row.last_payout_status === "processing")
        .length,
      last_paid: items.filter((row) => row.last_payout_status === "paid").length,
      last_failed: items.filter((row) => row.last_payout_status === "failed").length,
      drivers: items.filter((row) => row.role === "driver").length,
      restaurants: items.filter((row) => row.role === "restaurant").length,
      sellers: items.filter((row) => row.role === "seller").length,
    };

    return json({
      ok: true,
      timezone: DRIVER_BANK_PAYOUT_TIMEZONE,
      local_weekday: parts.weekday,
      local_hour: parts.hour,
      local_date: parts.dateKey,
      in_sunday_window: isDriverBankPayoutWindow(now),
      live_balances: liveBalances,
      summary,
      items,
    });
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return json({ ok: false, error: error.message }, error.status);
    }
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "sunday_eligibility_failed",
      },
      500,
    );
  }
}
