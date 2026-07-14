import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronJobLock } from "@/lib/cronJobLock";
import { finishCronRun, startCronRun } from "@/lib/cronObservability";
import { createCronPhaseTracer, maskResourceId } from "@/lib/cronPhaseTrace";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import {
  CRON_JOB_BUDGET_MS,
  CRON_SUPABASE_TIMEOUT_MS,
  CRON_VERCEL_MAX_DURATION_SEC,
  CronTimeoutError,
  isDeadlineApproaching,
  readCronBatchLimit,
} from "@/lib/cronTimeouts";
import { evaluateTaxiPayoutEligibility } from "@/lib/taxiPayoutEligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Confirmed ceiling for this Vercel project (same as /api/ai/chat). */
export const maxDuration = 60;

const JOB = "taxi-payouts";
const DEFAULT_HOLD_HOURS = 24;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function readDryRun(req: NextRequest): boolean {
  const urlFlag = req.nextUrl.searchParams.get("dry_run");
  if (urlFlag === "1" || urlFlag === "true") return true;
  if (urlFlag === "0" || urlFlag === "false") return false;
  const env = String(process.env.TAXI_PAYOUTS_DRY_RUN ?? "false")
    .trim()
    .toLowerCase();
  return env === "true" || env === "1";
}

function holdHours(): number {
  const n = Number(process.env.TAXI_PAYOUT_HOLD_HOURS ?? DEFAULT_HOLD_HOURS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HOLD_HOURS;
}

type CommissionRow = {
  taxi_ride_id: string;
  driver_cents: number | null;
  platform_cents: number | null;
  driver_paid_out: boolean | null;
  driver_transfer_id: string | null;
};

type RideRow = {
  id: string;
  completed_at: string | null;
  updated_at: string | null;
  payment_status: string | null;
  refund_status: string | null;
  status: string | null;
  driver_id: string | null;
};

async function handle(req: NextRequest) {
  const dryRun = readDryRun(req);
  const limit = readCronBatchLimit(req.nextUrl.searchParams, 1);
  const start = startCronRun(JOB, dryRun);
  const trace = createCronPhaseTracer(JOB, start.run_id);
  trace.mark("request_received", { batch_size: limit });

  try {
    if (!isAuthorizedCronRequest(req)) {
      trace.mark("response_sent");
      return json(
        finishCronRun(start, {
          ok: false,
          error: "Unauthorized",
          lock_acquired: false,
          phases: trace.phases,
        }),
        401
      );
    }
    trace.mark("auth_validated");

    const supabaseAdmin = buildCronSupabaseAdmin(CRON_SUPABASE_TIMEOUT_MS);
    const holdMs = holdHours() * 60 * 60 * 1000;
    const nowMs = Date.now();
    const inventoryOnly =
      req.nextUrl.searchParams.get("inventory_only") === "1" || limit === 0;

    trace.mark("lock_attempt_started");
    const locked = await withCronJobLock(
      supabaseAdmin,
      JOB,
      async () => {
        trace.mark("lock_acquired");

        const counters = {
          transfers_created: 0,
          already_paid: 0,
          connect_not_ready: 0,
          refunded: 0,
          disputed: 0,
          invalid_amount: 0,
          hold_window: 0,
          other_skipped: 0,
        };

        trace.mark("supabase_query_started", {
          detail: { query: "taxi_commissions_unpaid" },
        });
        const { data: commissions, error: comErr } = await supabaseAdmin
          .from("taxi_commissions")
          .select(
            "taxi_ride_id, driver_cents, platform_cents, driver_paid_out, driver_transfer_id"
          )
          .eq("driver_paid_out", false)
          .gt("driver_cents", 0)
          .limit(Math.max(1, limit) * 3);
        if (comErr) {
          throw new Error(`taxi_commissions_select_failed: ${comErr.message}`);
        }
        trace.mark("supabase_query_finished", {
          detail: { rows: (commissions ?? []).length },
        });

        const commissionRows = (commissions ?? []) as CommissionRow[];
        const commissionByRide = new Map(
          commissionRows.map((row) => [String(row.taxi_ride_id), row])
        );
        const rideIds = [...commissionByRide.keys()].filter(Boolean);

        if (!rideIds.length || inventoryOnly) {
          return {
            ok: true as const,
            reason: "no_eligible_drivers",
            hold_hours: holdHours(),
            scanned: rideIds.length,
            eligible: 0,
            processed: 0,
            paid: 0,
            skipped: 0,
            failed: 0,
            transfers_created: 0,
            no_eligible_drivers: true,
            inventory_only: inventoryOnly,
            ...counters,
            results: [] as Array<Record<string, unknown>>,
          };
        }

        trace.mark("supabase_query_started", {
          detail: { query: "taxi_rides_by_ids" },
        });
        const { data: rides, error: rideErr } = await supabaseAdmin
          .from("taxi_rides")
          .select(
            "id, status, payment_status, refund_status, driver_id, completed_at, updated_at"
          )
          .in("id", rideIds)
          .limit(Math.max(1, limit) * 3);
        if (rideErr) {
          throw new Error(`taxi_rides_select_failed: ${rideErr.message}`);
        }
        trace.mark("supabase_query_finished", {
          detail: { rows: (rides ?? []).length },
        });

        const eligible: RideRow[] = [];
        for (const ride of (rides ?? []) as RideRow[]) {
          const commission = commissionByRide.get(ride.id);
          if (!commission) {
            counters.other_skipped += 1;
            continue;
          }
          const gate = evaluateTaxiPayoutEligibility({
            rideStatus: ride.status,
            paymentStatus: ride.payment_status,
            refundStatus: ride.refund_status,
            driverId: ride.driver_id,
            driverCents: commission.driver_cents,
            driverPaidOut: commission.driver_paid_out,
            driverTransferId: commission.driver_transfer_id,
            completedAt: ride.completed_at ?? ride.updated_at,
            holdUntilMs: holdMs,
            nowMs,
            connectReady: null,
          });
          if (gate.ok && gate.alreadyPaid) {
            counters.already_paid += 1;
            continue;
          }
          if (gate.ok === false) {
            if (gate.reason === "refund_or_dispute") {
              const refund = String(ride.refund_status ?? "").toLowerCase();
              if (refund === "disputed") counters.disputed += 1;
              else counters.refunded += 1;
            } else if (gate.reason === "invalid_amount") {
              counters.invalid_amount += 1;
            } else if (gate.reason === "hold_window") {
              counters.hold_window += 1;
            } else if (gate.reason === "connect_not_ready") {
              counters.connect_not_ready += 1;
            } else {
              counters.other_skipped += 1;
            }
            continue;
          }
          eligible.push(ride);
        }

        const batch = eligible.slice(0, Math.max(0, limit));
        if (!batch.length) {
          return {
            ok: true as const,
            reason: "no_eligible_drivers",
            hold_hours: holdHours(),
            scanned: rideIds.length,
            eligible: 0,
            processed: 0,
            paid: 0,
            skipped:
              counters.already_paid +
              counters.refunded +
              counters.disputed +
              counters.invalid_amount +
              counters.hold_window +
              counters.connect_not_ready +
              counters.other_skipped,
            failed: 0,
            transfers_created: 0,
            no_eligible_drivers: true,
            inventory_only: false,
            ...counters,
            results: [] as Array<Record<string, unknown>>,
          };
        }

        // Live payout path only when batch eligible AND not forced dry gate.
        // Default when dry_run=false still requires all taxi-run eligibility.
        const origin = req.nextUrl.origin;
        const authHeader = req.headers.get("authorization") ?? "";
        const results: Array<Record<string, unknown>> = [];
        let paid = 0;
        let skipped = 0;
        let failed = 0;
        let partial = false;

        trace.mark("processing_started", { batch_size: batch.length });
        for (const ride of batch) {
          if (isDeadlineApproaching(start.startedMs)) {
            partial = true;
            trace.mark("job_deadline_reached");
            break;
          }
          try {
            const response = await fetch(
              `${origin}/api/stripe/transfers/taxi-run`,
              {
                method: "POST",
                headers: {
                  Authorization: authHeader,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  taxi_ride_id: ride.id,
                  dry_run: dryRun,
                }),
                signal: AbortSignal.timeout(15_000),
              }
            );
            const body = (await response.json().catch(() => ({}))) as Record<
              string,
              unknown
            >;
            if (body.already_succeeded === true) {
              counters.already_paid += 1;
              skipped += 1;
              results.push({
                taxi_ride_id: maskResourceId(ride.id),
                ok: true,
                already_paid: true,
              });
              continue;
            }
            if (body.ok === true) {
              if (dryRun || body.dry_run === true) skipped += 1;
              else {
                paid += 1;
                counters.transfers_created += 1;
              }
              results.push({
                taxi_ride_id: maskResourceId(ride.id),
                ok: true,
                dry_run: dryRun || body.dry_run === true,
              });
              continue;
            }
            failed += 1;
            results.push({
              taxi_ride_id: maskResourceId(ride.id),
              ok: false,
              error: String(body.error ?? "taxi_run_failed"),
            });
          } catch (error) {
            failed += 1;
            results.push({
              taxi_ride_id: maskResourceId(ride.id),
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        trace.mark("processing_finished", {
          detail: { paid, skipped, failed, partial },
        });

        return {
          ok: true as const,
          reason: null as string | null,
          hold_hours: holdHours(),
          scanned: rideIds.length,
          eligible: batch.length,
          processed: paid,
          paid,
          skipped,
          failed,
          transfers_created: counters.transfers_created,
          no_eligible_drivers: false,
          inventory_only: false,
          partial,
          ...counters,
          results,
        };
      },
      {
        lockedBy: `taxi:${start.run_id}`,
        ttlSeconds: Math.ceil(CRON_JOB_BUDGET_MS / 1000) + 30,
      }
    );

    if (locked.ok === false) {
      trace.mark("lock_busy", { detail: { error: locked.error } });
      trace.mark("response_sent");
      return json(
        finishCronRun(start, {
          ok: true,
          skipped: 1,
          reason: locked.error,
          lock_acquired: false,
          transfers_created: 0,
          no_eligible_drivers: false,
          phases: trace.phases,
          vercel_max_duration_sec: CRON_VERCEL_MAX_DURATION_SEC,
          job_budget_ms: CRON_JOB_BUDGET_MS,
        })
      );
    }

    trace.mark("response_sent");
    return json(
      finishCronRun(start, {
        ...locked.result,
        ok: true,
        processed: locked.result.processed ?? locked.result.paid ?? 0,
        lock_acquired: true,
        batch_limit: limit,
        phases: trace.phases,
        vercel_max_duration_sec: CRON_VERCEL_MAX_DURATION_SEC,
        job_budget_ms: CRON_JOB_BUDGET_MS,
      })
    );
  } catch (error) {
    const code =
      error instanceof CronTimeoutError
        ? error.code
        : error instanceof Error
          ? error.message
          : String(error);
    trace.mark("error", { detail: { code } });
    trace.mark("response_sent");
    return json(
      finishCronRun(start, {
        ok: false,
        error: code,
        lock_acquired: false,
        transfers_created: 0,
        phases: trace.phases,
      }),
      error instanceof CronTimeoutError ? 504 : 500
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
