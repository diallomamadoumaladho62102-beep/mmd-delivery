import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AdminAccessError, assertCanRetryPayout } from "@/lib/adminServer";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronJobLock } from "@/lib/cronJobLock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEKLY_PAYOUT_DAY_UTC = 0; // 0 = Sunday
const HYBRID_LOOKBACK_DAYS = 14;
const PROCESS_PAYOUTS_JOB = "process-payouts";

type PayoutMode = "hybrid" | "weekly" | "immediate";

function getPayoutMode(): PayoutMode {
  const raw = String(process.env.MMD_PAYOUT_MODE ?? "hybrid")
    .trim()
    .toLowerCase();

  if (raw === "weekly" || raw === "immediate") {
    return raw;
  }

  return "hybrid";
}

type OrderRow = {
  id: string;
  created_at: string | null;
  payment_status: string | null;
  status: string | null;

  restaurant_id: string | null;
  restaurant_user_id: string | null;

  restaurant_paid_out: boolean | null;
  driver_paid_out: boolean | null;
  restaurant_transfer_id: string | null;
  driver_transfer_id: string | null;
};

type ProcessResult = {
  order_id: string;
  target: "restaurant" | "driver";
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
  data?: unknown;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isCronAuthorized(request: NextRequest): boolean {
  return isAuthorizedCronRequest(request);
}

async function authorize(request: NextRequest): Promise<{
  actor: string;
  cron: boolean;
}> {
  if (isCronAuthorized(request)) {
    return {
      actor: "cron:weekly-process-payouts",
      cron: true,
    };
  }

  const admin = await assertCanRetryPayout(request);

  return {
    actor: admin.userId,
    cron: false,
  };
}

function isWeeklyPayoutDay(): boolean {
  return new Date().getUTCDay() === WEEKLY_PAYOUT_DAY_UTC;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function getPreviousWeekWindowUtc(): {
  weekStartIso: string;
  weekEndIso: string;
} {
  const todayStart = startOfUtcDay(new Date());

  const weekEnd = todayStart;
  const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  return {
    weekStartIso: weekStart.toISOString(),
    weekEndIso: weekEnd.toISOString(),
  };
}

function getOrigin(request: NextRequest) {
  return request.nextUrl.origin;
}

function getIncomingBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  return authHeader;
}

function hasRestaurant(order: OrderRow): boolean {
  return Boolean(order.restaurant_user_id || order.restaurant_id);
}

async function callTransferRun(params: {
  request: NextRequest;
  orderId: string;
  target: "restaurant" | "driver";
  cron: boolean;
  vertical?: "food" | "package";
}) {
  const { request, orderId, target, cron } = params;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (cron) {
    const secret = (process.env.CRON_SECRET || "").trim();

    if (!secret) {
      throw new Error(
        "Missing CRON_SECRET for cron payout processing."
      );
    }

    headers.Authorization = `Bearer ${secret}`;
    headers["x-cron-secret"] = secret;
  } else {
    const bearer = getIncomingBearerToken(request);

    if (!bearer) {
      throw new Error("Missing Authorization Bearer token.");
    }

    headers.Authorization = bearer;
  }

  // Shared WorkerFinance SCT client (same path as ensureWorkerConnectCredit).
  const { invokeOrderConnectTransfer } = await import(
    "@/lib/finance/orderConnectTransferClient"
  );
  const credit = await invokeOrderConnectTransfer({
    baseUrl: getOrigin(request),
    authorizationHeader: headers.Authorization,
    orderId,
    target,
    dryRun: false,
  });

  return {
    response: {
      ok: credit.ok,
      status: credit.status,
    } as Response,
    data: credit.raw ?? {
      ok: credit.ok,
      error: credit.error,
      transfer_id: credit.transferId,
      already: credit.already,
      worker_finance_sct: true,
      vertical: params.vertical ?? "food",
    },
  };
}

async function processTarget(params: {
  request: NextRequest;
  order: OrderRow;
  target: "restaurant" | "driver";
  cron: boolean;
}): Promise<ProcessResult> {
  const { request, order, target, cron } = params;

  if (target === "restaurant" && !hasRestaurant(order)) {
    return {
      order_id: order.id,
      target,
      ok: true,
      skipped: true,
      data: "Skipped restaurant payout: this order has no restaurant reference.",
    };
  }

  const alreadyPaid =
    target === "restaurant"
      ? order.restaurant_paid_out === true &&
        Boolean(order.restaurant_transfer_id)
      : order.driver_paid_out === true && Boolean(order.driver_transfer_id);

  if (alreadyPaid) {
    return {
      order_id: order.id,
      target,
      ok: true,
      skipped: true,
      data: "Already paid out",
    };
  }

  try {
    const { response, data } = await callTransferRun({
      request,
      orderId: order.id,
      target,
      cron,
    });

    if (!response.ok) {
      const errMsg =
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : `Transfer failed with status ${response.status}`;
      return {
        order_id: order.id,
        target,
        ok: false,
        status: response.status,
        error: errMsg,
        data,
      };
    }

    return {
      order_id: order.id,
      target,
      ok: true,
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      order_id: order.id,
      target,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown transfer error",
    };
  }
}

async function runProcessPayouts(request: NextRequest) {
  try {
    const { actor, cron } = await authorize(request);
    const supabase = getSupabaseAdmin();

    const { searchParams } = request.nextUrl;

    const forceRun =
      searchParams.get("force") === "true" || searchParams.get("force") === "1";

    const payoutMode = getPayoutMode();

    // immediate: first SCT still runs on delivered-confirm, but cron MUST retry
    // unpaid rows (driver_transfer_id / restaurant_transfer_id still null).
    // Skipping cron entirely left confirmed earnings stuck in awaiting_transfer.

    if (!forceRun && payoutMode === "weekly" && !isWeeklyPayoutDay()) {
      return json({
        ok: true,
        skipped: true,
        actor,
        cron,
        message: "Weekly payouts only run on Sunday (MMD_PAYOUT_MODE=weekly).",
        payout_mode: payoutMode,
        weekly_payout_day_utc: "Sunday",
      });
    }

    const locked = await withCronJobLock(
      supabase,
      PROCESS_PAYOUTS_JOB,
      async () => {
        // Attempt to keep platform payouts manual so auto bank payouts cannot
        // drain funds needed for worker SCTs. Stripe often requires Dashboard
        // for the platform account itself — surface requires_dashboard clearly.
        let platformPayoutSchedule: unknown = null;
        try {
          const { ensurePlatformManualPayoutSchedule } = await import(
            "@/lib/finance/platformPayoutGuard"
          );
          platformPayoutSchedule = await ensurePlatformManualPayoutSchedule();
        } catch (schedErr) {
          platformPayoutSchedule = {
            ok: false,
            error:
              schedErr instanceof Error ? schedErr.message : String(schedErr),
            requires_dashboard: true,
          };
        }

        const limit = Math.min(
          Math.max(Number(searchParams.get("limit") ?? 25), 1),
          100
        );

        // Package orphans: create/repair linked orders BEFORE the order SCT loop
        // so delivered+paid delivery_requests with null transfer enter the queue.
        let packageOrphanEnsure: unknown = null;
        try {
          const { ensureOrphanPackageDriverSctOrders } = await import(
            "@/lib/finance/ensurePackageDriverSctOrder"
          );
          packageOrphanEnsure = await ensureOrphanPackageDriverSctOrders(
            supabase,
            { limit: Math.min(limit, 25) },
          );
        } catch (orphanErr) {
          console.error("[process-payouts] package orphan ensure failed", {
            message:
              orphanErr instanceof Error ? orphanErr.message : String(orphanErr),
          });
          packageOrphanEnsure = {
            error:
              orphanErr instanceof Error ? orphanErr.message : String(orphanErr),
          };
        }

        const { weekStartIso, weekEndIso } = getPreviousWeekWindowUtc();
        const hybridSinceIso = new Date(
          Date.now() - HYBRID_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
        ).toISOString();

        // Unpaid SCT only — confirmed earnings must not age out of lookback
        // and sit forever in awaiting_transfer_cents.
        let query = supabase
          .from("orders")
          .select(
            `
          id,
          created_at,
          delivered_confirmed_at,
          payment_status,
          status,
          restaurant_id,
          restaurant_user_id,
          restaurant_paid_out,
          driver_paid_out,
          restaurant_transfer_id,
          driver_transfer_id
        `
          )
          .eq("payment_status", "paid")
          .in("status", ["delivered", "completed"])
          .or("driver_transfer_id.is.null,restaurant_transfer_id.is.null")
          .order("delivered_confirmed_at", { ascending: true, nullsFirst: false })
          .limit(limit);

        if (!forceRun) {
          if (payoutMode === "weekly") {
            // Weekly SCT retry: delivery confirmation window (not order.created_at).
            query = query
              .not("delivered_confirmed_at", "is", null)
              .gte("delivered_confirmed_at", weekStartIso)
              .lt("delivered_confirmed_at", weekEndIso);
          }
          // hybrid + immediate: process all unpaid delivered/paid SCTs (no
          // delivered_confirmed_at window) so stuck transfers keep retrying.
        }

        const { data: orders, error } = await query;

        if (error) {
          throw new Error(`Failed to load eligible orders: ${error.message}`);
        }

        const typedOrders = (orders ?? []) as OrderRow[];
        const results: ProcessResult[] = [];

        for (const order of typedOrders) {
          const { data: commissionRow, error: commissionErr } = await supabase
            .from("order_commissions")
            .select("order_id")
            .eq("order_id", order.id)
            .maybeSingle<{ order_id: string }>();

          if (commissionErr || !commissionRow?.order_id) {
            console.error("[process-payouts] skipping order without commissions", {
              order_id: order.id,
              error: commissionErr?.message ?? "order_commissions_missing",
            });
            results.push({
              order_id: order.id,
              target: "restaurant",
              ok: false,
              skipped: true,
              error: "order_commissions_missing",
            });
            results.push({
              order_id: order.id,
              target: "driver",
              ok: false,
              skipped: true,
              error: "order_commissions_missing",
            });
            continue;
          }

          if (hasRestaurant(order)) {
            results.push(
              await processTarget({
                request,
                order,
                target: "restaurant",
                cron,
              })
            );
          } else {
            results.push({
              order_id: order.id,
              target: "restaurant",
              ok: true,
              skipped: true,
              data: "Skipped restaurant payout: errand/simple delivery order.",
            });
          }

          results.push(
            await processTarget({
              request,
              order,
              target: "driver",
              cron,
            })
          );
        }

        const processed = results.filter((r) => r.ok && !r.skipped).length;
        const skipped = results.filter((r) => r.skipped).length;
        const failed = results.filter((r) => !r.ok).length;

        return {
          ok: true as const,
          actor,
          cron,
          payout_mode: payoutMode,
          weekly: payoutMode === "weekly" && !forceRun,
          force_run: forceRun,
          payout_day_utc: "Sunday",
          payout_window_start:
            forceRun || payoutMode !== "weekly" ? null : weekStartIso,
          payout_window_end:
            forceRun || payoutMode !== "weekly" ? null : weekEndIso,
          hybrid_lookback_since:
            forceRun || payoutMode === "weekly" ? null : hybridSinceIso,
          package_orphan_ensure: packageOrphanEnsure,
          platform_payout_schedule: platformPayoutSchedule,
          checked_orders: typedOrders.length,
          processed,
          skipped,
          failed,
          results,
        };
      },
      { ttlSeconds: 20 * 60 }
    );

    if (!locked.ok) {
      return json({
        ok: true,
        skipped: true,
        reason: "lock_busy",
        job: PROCESS_PAYOUTS_JOB,
        actor,
        cron,
      });
    }

    return json(locked.result);
  } catch (error) {
    const status = error instanceof AdminAccessError ? error.status : 500;

    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown payout error",
      },
      status
    );
  }
}

export async function GET(request: NextRequest) {
  return runProcessPayouts(request);
}

export async function POST(request: NextRequest) {
  return runProcessPayouts(request);
}