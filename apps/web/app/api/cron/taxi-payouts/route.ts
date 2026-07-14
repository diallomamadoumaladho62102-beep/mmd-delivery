import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronJobLock } from "@/lib/cronJobLock";
import { finishCronRun, startCronRun } from "@/lib/cronObservability";
import { evaluateTaxiPayoutEligibility } from "@/lib/taxiPayoutEligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB = "taxi-payouts";
const DEFAULT_HOLD_HOURS = 24;
const DEFAULT_LIMIT = 25;

/**
 * Taxi driver payout cron — production-safe.
 *
 * Safety does NOT rely solely on DRY_RUN:
 * - Every transfer requires strict eligibility (completed, paid, hold, amount,
 *   Connect ready, no refund/dispute, no prior payout).
 * - With zero eligible rides the cron succeeds with `no_eligible_drivers`
 *   and issues zero Stripe Transfers.
 *
 * DRY_RUN remains available for ops rehearsal (`TAXI_PAYOUTS_DRY_RUN=true`
 * or `?dry_run=1`). Default is live scan + transfer only when eligible.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase admin env");
  return createClient(url, key, { auth: { persistSession: false } });
}

function readDryRun(req: NextRequest): boolean {
  const urlFlag = req.nextUrl.searchParams.get("dry_run");
  if (urlFlag === "1" || urlFlag === "true") return true;
  if (urlFlag === "0" || urlFlag === "false") return false;
  // Default live eligibility scan; transfers still gated per ride.
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

type EligibleRide = {
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
  const start = startCronRun(JOB, dryRun);

  try {
    if (!isAuthorizedCronRequest(req)) {
      return json(
        finishCronRun(start, {
          ok: false,
          error: "Unauthorized",
          lock_acquired: false,
        }),
        401
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const origin = req.nextUrl.origin;
    const authHeader = req.headers.get("authorization") ?? "";
    const holdMs = holdHours() * 60 * 60 * 1000;
    const nowMs = Date.now();

    const locked = await withCronJobLock(
      supabaseAdmin,
      JOB,
      async () => {
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

        const { data: commissions, error: comErr } = await supabaseAdmin
          .from("taxi_commissions")
          .select(
            "taxi_ride_id, driver_cents, platform_cents, driver_paid_out, driver_transfer_id"
          )
          .eq("driver_paid_out", false)
          .gt("driver_cents", 0)
          .limit(DEFAULT_LIMIT * 3);

        if (comErr) {
          throw new Error(`taxi_commissions_select_failed: ${comErr.message}`);
        }

        const commissionRows = (commissions ?? []) as CommissionRow[];
        const commissionByRide = new Map(
          commissionRows.map((row) => [String(row.taxi_ride_id), row])
        );
        const rideIds = [...commissionByRide.keys()].filter(Boolean);

        if (!rideIds.length) {
          return {
            ok: true as const,
            reason: "no_eligible_drivers",
            hold_hours: holdHours(),
            scanned: 0,
            eligible: 0,
            processed: 0,
            paid: 0,
            skipped: 0,
            failed: 0,
            transfers_created: 0,
            no_eligible_drivers: true,
            ...counters,
            results: [] as Array<Record<string, unknown>>,
          };
        }

        const { data: rides, error: rideErr } = await supabaseAdmin
          .from("taxi_rides")
          .select(
            "id, status, payment_status, refund_status, driver_id, completed_at, updated_at"
          )
          .in("id", rideIds)
          .limit(DEFAULT_LIMIT * 3);

        if (rideErr) {
          throw new Error(`taxi_rides_select_failed: ${rideErr.message}`);
        }

        const eligible: EligibleRide[] = [];
        for (const ride of (rides ?? []) as EligibleRide[]) {
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

        const batch = eligible.slice(0, DEFAULT_LIMIT);
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
            ...counters,
            results: [] as Array<Record<string, unknown>>,
          };
        }

        const results: Array<Record<string, unknown>> = [];
        let paid = 0;
        let skipped = 0;
        let failed = 0;

        for (const ride of batch) {
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
                taxi_ride_id: ride.id,
                ok: true,
                already_paid: true,
              });
              continue;
            }

            if (body.ok === true) {
              if (dryRun || body.dry_run === true) {
                skipped += 1;
              } else {
                paid += 1;
                counters.transfers_created += 1;
              }
              results.push({
                taxi_ride_id: ride.id,
                ok: true,
                status: response.status,
                dry_run: dryRun || body.dry_run === true,
              });
              continue;
            }

            const err = String(body.error ?? "");
            if (err === "connect_not_ready" || err === "Driver payout account missing") {
              counters.connect_not_ready += 1;
              skipped += 1;
            } else if (err === "refund_or_dispute") {
              counters.refunded += 1;
              skipped += 1;
            } else if (err === "invalid_amount" || err.includes("amount")) {
              counters.invalid_amount += 1;
              skipped += 1;
            } else {
              failed += 1;
            }
            results.push({
              taxi_ride_id: ride.id,
              ok: false,
              status: response.status,
              error: err || null,
            });
          } catch (error) {
            failed += 1;
            results.push({
              taxi_ride_id: ride.id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

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
          ...counters,
          results,
        };
      },
      { ttlSeconds: 15 * 60 }
    );

    if (!locked.ok) {
      return json(
        finishCronRun(start, {
          ok: true,
          skipped: 1,
          reason: "lock_busy",
          lock_acquired: false,
          transfers_created: 0,
          no_eligible_drivers: false,
        })
      );
    }

    return json(
      finishCronRun(start, {
        ...locked.result,
        ok: true,
        processed: locked.result.processed ?? locked.result.paid ?? 0,
        lock_acquired: true,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[taxi-payouts] fatal", { message, run_id: start.run_id });
    return json(
      finishCronRun(start, {
        ok: false,
        error: "Internal server error",
        lock_acquired: false,
        transfers_created: 0,
      }),
      500
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
