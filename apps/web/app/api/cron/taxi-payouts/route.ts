import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronJobLock } from "@/lib/cronJobLock";
import { evaluateTaxiPayoutEligibility } from "@/lib/taxiPayoutEligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB = "taxi-payouts";
const DEFAULT_HOLD_HOURS = 24;
const DEFAULT_LIMIT = 25;

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
  // Financial taxi payouts default to dry-run unless explicitly disabled.
  const env = String(process.env.TAXI_PAYOUTS_DRY_RUN ?? "true")
    .trim()
    .toLowerCase();
  const urlFlag = req.nextUrl.searchParams.get("dry_run");
  if (urlFlag === "0" || urlFlag === "false") return false;
  if (urlFlag === "1" || urlFlag === "true") return true;
  return env !== "false";
}

function holdHours(): number {
  const n = Number(process.env.TAXI_PAYOUT_HOLD_HOURS ?? DEFAULT_HOLD_HOURS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HOLD_HOURS;
}

type CommissionRow = {
  taxi_ride_id: string;
  driver_cents: number | null;
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
  if (!isAuthorizedCronRequest(req)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const dryRun = readDryRun(req);
  const supabaseAdmin = getSupabaseAdmin();
  const origin = req.nextUrl.origin;
  const authHeader = req.headers.get("authorization") ?? "";
  const holdMs = holdHours() * 60 * 60 * 1000;
  const nowMs = Date.now();

  const locked = await withCronJobLock(
    supabaseAdmin,
    JOB,
    async () => {
      const { data: commissions, error: comErr } = await supabaseAdmin
        .from("taxi_commissions")
        .select("taxi_ride_id, driver_cents, driver_paid_out, driver_transfer_id")
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
          dry_run: dryRun,
          scanned: 0,
          eligible: 0,
          paid: 0,
          skipped: 0,
          failed: 0,
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

      const eligible = ((rides ?? []) as EligibleRide[])
        .filter((ride) => {
          const commission = commissionByRide.get(ride.id);
          if (!commission) return false;
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
            // Connect readiness is re-checked inside taxi-run via Stripe retrieve.
            connectReady: null,
          });
          return gate.ok && !gate.alreadyPaid;
        })
        .slice(0, DEFAULT_LIMIT);

      const results: Array<Record<string, unknown>> = [];
      let paid = 0;
      let skipped = 0;
      let failed = 0;

      for (const ride of eligible) {
        try {
          const response = await fetch(`${origin}/api/stripe/transfers/taxi-run`, {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              taxi_ride_id: ride.id,
              dry_run: dryRun,
            }),
          });
          const body = (await response.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;

          if (body.already_succeeded === true || body.ok === true) {
            if (
              body.already_succeeded === true ||
              body.skipped === true ||
              dryRun ||
              body.dry_run === true
            ) {
              skipped += 1;
            } else {
              paid += 1;
            }
            results.push({
              taxi_ride_id: ride.id,
              ok: true,
              status: response.status,
              dry_run: dryRun || body.dry_run === true,
              body,
            });
            continue;
          }

          failed += 1;
          results.push({
            taxi_ride_id: ride.id,
            ok: false,
            status: response.status,
            body,
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
        dry_run: dryRun,
        hold_hours: holdHours(),
        scanned: rideIds.length,
        eligible: eligible.length,
        paid,
        skipped,
        failed,
        results,
      };
    },
    { ttlSeconds: 15 * 60 }
  );

  if (!locked.ok) {
    return json({
      ok: true,
      skipped: true,
      reason: "lock_busy",
      job: JOB,
    });
  }

  return json(locked.result);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
