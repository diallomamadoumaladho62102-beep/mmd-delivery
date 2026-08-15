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
  createFullAvailableConnectPayout,
  driverBankPayoutIdempotencyKey,
  ensureDriverConnectManualPayoutSchedule,
  getNowPartsInTimeZone,
  isDriverBankPayoutWindow,
  DRIVER_BANK_PAYOUT_TIMEZONE,
} from "@/lib/finance/driverConnectBankPayout";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";
import {
  createPayoutTransaction,
  updatePayoutTransactionStatus,
} from "@/lib/payoutTransactionService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOB = "driver-connect-bank-payouts";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * Sunday 04:00 America/New_York bank payouts for drivers (full Connect available).
 *
 * Vercel cron: `0 8,9 * * 0` UTC (covers EST 09:00 UTC and EDT 08:00 UTC = 4am ET).
 * Handler no-ops unless local NY time is Sunday 04:xx (or force=1).
 *
 * No $20 minimum — 100% of eligible available balance is paid out.
 * Manual Cash Out keeps its own minimum separately.
 */
async function handle(req: NextRequest) {
  const force =
    req.nextUrl.searchParams.get("force") === "1" ||
    req.nextUrl.searchParams.get("force") === "true";
  const dryRun =
    req.nextUrl.searchParams.get("dry_run") === "1" ||
    req.nextUrl.searchParams.get("dry_run") === "true";
  const limit = readCronBatchLimit(req.nextUrl.searchParams, 50);
  const start = startCronRun(JOB, dryRun);
  const parts = getNowPartsInTimeZone(DRIVER_BANK_PAYOUT_TIMEZONE);

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
      const rows: Array<{
        user_id: string;
        stripe_account_id: string | null;
      }> = [];
      for (let from = 0; from < 5000; from += pageSize) {
        const { data, error } = await supabaseAdmin
          .from("driver_profiles")
          .select("user_id, stripe_account_id")
          .not("stripe_account_id", "is", null)
          .range(from, from + pageSize - 1);
        if (error) {
          throw new Error(`driver_profiles_select_failed: ${error.message}`);
        }
        const batch = (data ?? []).filter((d) =>
          String(d.stripe_account_id ?? "").startsWith("acct_"),
        );
        rows.push(...batch);
        if ((data ?? []).length < pageSize) break;
      }

      const batch = rows.slice(0, Math.max(0, limit));
      const results: Array<Record<string, unknown>> = [];
      let paid = 0;
      let skipped = 0;
      let failed = 0;
      let partial = false;

      for (const row of batch) {
        if (isDeadlineApproaching(start.startedMs)) {
          partial = true;
          break;
        }

        const userId = String(row.user_id);
        const acct = String(row.stripe_account_id);
        const schedule = await ensureDriverConnectManualPayoutSchedule(acct);
        if (schedule.ok === false) {
          failed += 1;
          results.push({
            driver_id: userId,
            ok: false,
            error: `manual_schedule:${schedule.error}`,
          });
          continue;
        }

        if (dryRun) {
          skipped += 1;
          results.push({
            driver_id: userId,
            ok: true,
            dry_run: true,
            stripe_account_id: acct,
          });
          continue;
        }

        const idempotencyKey = driverBankPayoutIdempotencyKey(
          acct,
          parts.dateKey,
        );
        const payout = await createFullAvailableConnectPayout({
          stripeAccountId: acct,
          driverUserId: userId,
          idempotencyKey,
          metadata: {
            et_date: parts.dateKey,
            timezone: DRIVER_BANK_PAYOUT_TIMEZONE,
          },
        });

        if (payout.ok === false) {
          failed += 1;
          results.push({
            driver_id: userId,
            ok: false,
            error: payout.error,
          });
          continue;
        }

        if (payout.skipped) {
          skipped += 1;
          results.push({
            driver_id: userId,
            ok: true,
            skipped: true,
            reason: payout.reason,
          });
          continue;
        }

        try {
          const audit = await createPayoutTransaction(supabaseAdmin, {
            countryCode: "US",
            recipientType: "driver",
            recipientUserId: userId,
            provider: "stripe_connect",
            methodCode: "payout_stripe_connect_sunday",
            amountCents: payout.amountCents,
            currency: String(payout.payout.currency ?? "usd").toUpperCase(),
            status: "processing",
            payoutMode: "automatic",
            destinationAccount: acct,
            externalReference: payout.payout.id,
            providerPayload: {
              source: "cron_driver_sunday_bank_payout",
              stripe_payout_id: payout.payout.id,
              et_date: parts.dateKey,
              timezone: DRIVER_BANK_PAYOUT_TIMEZONE,
              no_minimum: true,
              money_out_model: MONEY_OUT_MODEL.driverBankPayout,
            },
          });
          await updatePayoutTransactionStatus(supabaseAdmin, audit.id, "paid", {
            external_reference: payout.payout.id,
            provider_payload: {
              source: "cron_driver_sunday_bank_payout",
              stripe_payout_id: payout.payout.id,
              money_out_model: MONEY_OUT_MODEL.driverBankPayout,
            },
          });
        } catch (ledgerErr) {
          console.warn(
            "[cron:driver-connect-bank-payouts] ledger write fail-open",
            ledgerErr instanceof Error ? ledgerErr.message : ledgerErr,
          );
        }

        paid += 1;
        results.push({
          driver_id: userId,
          ok: true,
          stripe_payout_id: payout.payout.id,
          amount_cents: payout.amountCents,
          currency: payout.payout.currency,
        });
      }

      return {
        ok: true as const,
        timezone: DRIVER_BANK_PAYOUT_TIMEZONE,
        local_date: parts.dateKey,
        scanned: rows.length,
        eligible: batch.length,
        paid,
        skipped,
        failed,
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
