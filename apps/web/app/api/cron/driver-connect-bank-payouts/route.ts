import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronJobLock } from "@/lib/cronJobLock";
import { finishCronRun, startCronRun } from "@/lib/cronObservability";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import {
  CRON_JOB_BUDGET_MS,
  CRON_SUPABASE_TIMEOUT_MS,
  CRON_VERCEL_MAX_DURATION_SEC,
  isDeadlineApproaching,
  readCronBatchLimit,
} from "@/lib/cronTimeouts";
import {
  driverBankPayoutIdempotencyKey,
  restaurantBankPayoutIdempotencyKey,
  sellerBankPayoutIdempotencyKey,
  getNowPartsInTimeZone,
  isDriverBankPayoutWindow,
  DRIVER_BANK_PAYOUT_TIMEZONE,
} from "@/lib/finance/driverConnectBankPayout";
import { classifyStripeConnectAccountId } from "@/lib/finance/sundayBankEligibility";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";
import {
  executeWorkerSundayBankPayout,
  lockWorkerConnectManualPayoutSchedule,
} from "@/lib/finance/workerFinance";
import { ensureSundayBankPayoutAuditRecord } from "@/lib/finance/bankPayoutLedgerBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOB = "driver-connect-bank-payouts";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * Sunday 04:00 America/New_York bank payouts for drivers, restaurants, and sellers
 * (full Connect available balance → ba_* standard).
 *
 * Trigger: GitHub Actions (dual Sunday UTC schedules — Hobby Vercel cannot do both):
 * - `0 8 * * 0` → 04:00 EDT
 * - `0 9 * * 0` → 04:00 EST
 * Handler pays when local NY time is Sunday and hour >= 4 (or force=1).
 * Same-Sunday retries after 04:00 recover delayed GitHub Actions fires.
 * No weekday automatic bank sweep.
 * schedule_only=1 (+ force): set Connect payout interval=manual without creating payouts.
 *
 * SCT (platform → Connect) is independent and must already have run — this is bank payout only.
 * Instant Cash Out remains the mid-week fast path when Stripe Instant eligibility allows.
 */
async function handle(req: NextRequest) {
  const force =
    req.nextUrl.searchParams.get("force") === "1" ||
    req.nextUrl.searchParams.get("force") === "true";
  const dryRun =
    req.nextUrl.searchParams.get("dry_run") === "1" ||
    req.nextUrl.searchParams.get("dry_run") === "true";
  const scheduleOnly =
    req.nextUrl.searchParams.get("schedule_only") === "1" ||
    req.nextUrl.searchParams.get("schedule_only") === "true";
  const limit = readCronBatchLimit(req.nextUrl.searchParams, 50);
  const start = startCronRun(JOB, dryRun);
  const parts = getNowPartsInTimeZone(DRIVER_BANK_PAYOUT_TIMEZONE);
  console.info("[driver-connect-bank-payouts] started", {
    timezone: DRIVER_BANK_PAYOUT_TIMEZONE,
    local_weekday: parts.weekday,
    local_hour: parts.hour,
    local_date: parts.dateKey,
    earning_period: parts.dateKey,
    force,
    dry_run: dryRun,
    schedule_only: scheduleOnly,
  });

  if (!isAuthorizedCronRequest(req)) {
    return json(
      finishCronRun(start, {
        ok: false,
        error: "Unauthorized",
        lock_acquired: false,
      }),
      401,
    );
  }

  if (!force && !isDriverBankPayoutWindow()) {
    return json(
      finishCronRun(start, {
        ok: true,
        skipped: 1,
        reason: "outside_sunday_4am_america_new_york_window",
        timezone: DRIVER_BANK_PAYOUT_TIMEZONE,
        local_weekday: parts.weekday,
        local_hour: parts.hour,
        local_date: parts.dateKey,
        lock_acquired: false,
        money_out_model: MONEY_OUT_MODEL,
      }),
    );
  }

  const supabaseAdmin = buildCronSupabaseAdmin(CRON_SUPABASE_TIMEOUT_MS);

  const locked = await withCronJobLock(
    supabaseAdmin,
    JOB,
    async () => {
      const pageSize = 100;
      type ProfileRow = {
        user_id: string;
        stripe_account_id: string | null;
      };
      async function loadProfiles(
        table: "driver_profiles" | "restaurant_profiles" | "sellers",
      ): Promise<ProfileRow[]> {
        const rows: ProfileRow[] = [];
        for (let from = 0; from < 5000; from += pageSize) {
          const { data, error } = await supabaseAdmin
            .from(table)
            .select("user_id, stripe_account_id")
            .range(from, from + pageSize - 1);
          if (error) {
            throw new Error(`${table}_select_failed: ${error.message}`);
          }
          rows.push(...((data ?? []) as unknown as ProfileRow[]));
          if ((data ?? []).length < pageSize) break;
        }
        return rows;
      }

      const [allDrivers, allRestaurants, allSellers] = await Promise.all([
        loadProfiles("driver_profiles"),
        loadProfiles("restaurant_profiles"),
        loadProfiles("sellers"),
      ]);

      type BankTarget = {
        role: "driver" | "restaurant" | "seller";
        user_id: string;
        stripe_account_id: string;
      };
      function partitionRole(
        role: BankTarget["role"],
        rows: ProfileRow[],
      ): { missing: ProfileRow[]; eligible: BankTarget[] } {
        const missing: ProfileRow[] = [];
        const eligible: BankTarget[] = [];
        for (const row of rows) {
          const classified = classifyStripeConnectAccountId(row.stripe_account_id);
          if (!classified.ok || !classified.accountId) {
            missing.push(row);
            continue;
          }
          eligible.push({
            role,
            user_id: row.user_id,
            stripe_account_id: classified.accountId,
          });
        }
        return { missing, eligible };
      }

      const drivers = partitionRole("driver", allDrivers);
      const restaurants = partitionRole("restaurant", allRestaurants);
      const sellers = partitionRole("seller", allSellers);

      // Separate caps so restaurant/seller Sunday bank is never starved by a large driver set.
      const batch: BankTarget[] = [
        ...drivers.eligible.slice(0, Math.max(0, limit)),
        ...restaurants.eligible.slice(0, Math.max(0, limit)),
        ...sellers.eligible.slice(0, Math.max(0, limit)),
      ];
      const results: Array<Record<string, unknown>> = [];
      let paid = 0;
      let skipped = 0;
      let failed = 0;
      let missingStripeAccount = 0;
      let schedulesUpdated = 0;
      let partial = false;

      const missingCap = 100;
      function recordMissing(role: BankTarget["role"], rows: ProfileRow[]) {
        missingStripeAccount += rows.length;
        skipped += rows.length;
        for (const row of rows.slice(0, missingCap)) {
          results.push({
            role,
            recipient_user_id: row.user_id,
            ok: true,
            skipped: true,
            reason: "missing_stripe_account",
            payout_blocked: true,
            block_label:
              "PAYOUT BLOCKED — STRIPE CONNECT ACCOUNT NOT CONFIGURED",
          });
        }
      }
      recordMissing("driver", drivers.missing);
      recordMissing("restaurant", restaurants.missing);
      recordMissing("seller", sellers.missing);

      for (const row of batch) {
        if (isDeadlineApproaching(start.startedMs)) {
          partial = true;
          break;
        }

        const role = row.role;
        const userId = String(row.user_id);
        const acct = String(row.stripe_account_id);
        const schedule = await lockWorkerConnectManualPayoutSchedule(acct);
        if (schedule.ok === false) {
          failed += 1;
          results.push({
            role,
            recipient_user_id: userId,
            ok: false,
            error: `manual_schedule:${schedule.error}`,
          });
          continue;
        }
        schedulesUpdated += 1;

        if (scheduleOnly || dryRun) {
          skipped += 1;
          results.push({
            role,
            recipient_user_id: userId,
            ok: true,
            dry_run: dryRun || undefined,
            schedule_only: scheduleOnly || undefined,
            stripe_account_id: acct,
            payout_interval: "manual",
          });
          continue;
        }

        const idempotencyKey =
          role === "restaurant"
            ? restaurantBankPayoutIdempotencyKey(acct, parts.dateKey)
            : role === "seller"
              ? sellerBankPayoutIdempotencyKey(acct, parts.dateKey)
              : driverBankPayoutIdempotencyKey(acct, parts.dateKey);
        const moneyModel =
          role === "restaurant"
            ? MONEY_OUT_MODEL.restaurantBankPayout
            : role === "seller"
              ? MONEY_OUT_MODEL.sellerBankPayout
              : MONEY_OUT_MODEL.driverBankPayout;
        const ledgerSource =
          role === "restaurant"
            ? "cron_restaurant_sunday_bank_payout"
            : role === "seller"
              ? "cron_seller_sunday_bank_payout"
              : "cron_driver_sunday_bank_payout";

        const payout = await executeWorkerSundayBankPayout({
          stripeAccountId: acct,
          recipientUserId: userId,
          recipientType: role,
          driverUserId: role === "driver" ? userId : undefined,
          idempotencyKey,
          metadata: {
            et_date: parts.dateKey,
            timezone: DRIVER_BANK_PAYOUT_TIMEZONE,
          },
        });

        if (payout.ok === false) {
          failed += 1;
          results.push({
            role,
            recipient_user_id: userId,
            ok: false,
            error: payout.error,
          });
          continue;
        }

        if (!("payout" in payout)) {
          skipped += 1;
          results.push({
            role,
            recipient_user_id: userId,
            ok: true,
            skipped: true,
            reason: payout.reason,
            available_cents: "availableCents" in payout ? payout.availableCents : 0,
            pending_cents: "pendingCents" in payout ? payout.pendingCents : 0,
          });
          continue;
        }

        const stripePayout = payout.payout;
        const amountCents = payout.amountCents;

        const audit = await ensureSundayBankPayoutAuditRecord(supabaseAdmin, {
          countryCode: "US",
          recipientType: role,
          recipientUserId: userId,
          amountCents,
          currency: String(stripePayout.currency ?? "usd").toUpperCase(),
          stripePayoutId: stripePayout.id,
          destinationAccount: acct,
          ledgerSource,
          etDateKey: parts.dateKey,
          moneyModel,
        });

        if (audit.ok === false) {
          failed += 1;
          results.push({
            role,
            recipient_user_id: userId,
            ok: false,
            reconcile_required: true,
            stripe_payout_id: audit.stripe_payout_id,
            error: audit.error,
          });
          continue;
        }

        paid += 1;
        results.push({
          role,
          recipient_user_id: userId,
          ok: true,
          stripe_payout_id: stripePayout.id,
          payout_transaction_id: audit.payoutTransactionId,
          audit_created: audit.created,
          amount_cents: amountCents,
          currency: stripePayout.currency,
        });
      }

      const skipReasons = results
        .filter((row) => row.skipped === true)
        .map((row) => String(row.reason ?? "skipped"));
      const failReasons = results
        .filter((row) => row.ok === false)
        .map((row) => String(row.error ?? "failed"));
      console.info("[driver-connect-bank-payouts] cycle", {
        timezone: DRIVER_BANK_PAYOUT_TIMEZONE,
        local_date: parts.dateKey,
        scanned_drivers: allDrivers.length,
        scanned_restaurants: allRestaurants.length,
        scanned_sellers: allSellers.length,
        eligible: batch.length,
        paid,
        skipped,
        failed,
        missing_stripe_account: missingStripeAccount,
        skip_reasons: skipReasons,
        fail_reasons: failReasons,
        total_amount_cents: results.reduce(
          (sum, row) => sum + (Number(row.amount_cents) || 0),
          0,
        ),
      });

      return {
        ok: true as const,
        timezone: DRIVER_BANK_PAYOUT_TIMEZONE,
        local_date: parts.dateKey,
        scanned: allDrivers.length + allRestaurants.length + allSellers.length,
        scanned_drivers: allDrivers.length,
        scanned_restaurants: allRestaurants.length,
        scanned_sellers: allSellers.length,
        eligible: batch.length,
        paid,
        skipped,
        failed,
        missing_stripe_account: missingStripeAccount,
        schedules_updated: schedulesUpdated,
        schedule_only: scheduleOnly,
        partial,
        no_minimum_cents: true,
        results,
      };
    },
    {
      lockedBy: `bank:${start.run_id}`,
      ttlSeconds: Math.ceil(CRON_JOB_BUDGET_MS / 1000) + 30,
    },
  );

  if (locked.ok === false) {
    return json(
      finishCronRun(start, {
        ok: false,
        reason: String(locked.error ?? "lock_busy"),
        lock_acquired: false,
      }),
      200,
    );
  }

  return json(
    finishCronRun(start, {
      ...locked.result,
      ok: true,
      processed: locked.result.paid,
      lock_acquired: true,
      batch_limit: limit,
      vercel_max_duration_sec: CRON_VERCEL_MAX_DURATION_SEC,
      job_budget_ms: CRON_JOB_BUDGET_MS,
      money_out_model: MONEY_OUT_MODEL,
    }),
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
