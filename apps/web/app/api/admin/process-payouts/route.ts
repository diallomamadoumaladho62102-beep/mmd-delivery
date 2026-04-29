import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AdminAccessError, assertCanRetryPayout } from "@/lib/adminServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEKLY_PAYOUT_DAY_UTC = 0; // 0 = Sunday

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
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  const vercelCron = request.headers.get("x-vercel-cron");

  if (vercelCron) return true;

  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");

  return Boolean(expected && provided && expected === provided);
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
}) {
  const { request, orderId, target, cron } = params;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (cron) {
    const secret = process.env.STRIPE_TRANSFERS_ADMIN_SECRET;

    if (!secret) {
      throw new Error(
        "Missing STRIPE_TRANSFERS_ADMIN_SECRET for cron payout processing."
      );
    }

    headers["x-admin-secret"] = secret;
  } else {
    const bearer = getIncomingBearerToken(request);

    if (!bearer) {
      throw new Error("Missing Authorization Bearer token.");
    }

    headers.Authorization = bearer;
  }

  const response = await fetch(`${getOrigin(request)}/api/stripe/transfers/run`, {
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify({
      order_id: orderId,
      target,
      dry_run: false,
    }),
  });

  const data = await response.json().catch(() => null);

  return {
    response,
    data,
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
      return {
        order_id: order.id,
        target,
        ok: false,
        status: response.status,
        error:
          typeof data?.error === "string"
            ? data.error
            : `Transfer failed with status ${response.status}`,
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

export async function POST(request: NextRequest) {
  try {
    const { actor, cron } = await authorize(request);
    const supabase = getSupabaseAdmin();

    const { searchParams } = request.nextUrl;

    const forceRun =
      searchParams.get("force") === "true" || searchParams.get("force") === "1";

    if (!forceRun && !isWeeklyPayoutDay()) {
      return json({
        ok: true,
        skipped: true,
        actor,
        cron,
        message: "Weekly payouts only run on Sunday.",
        weekly_payout_day_utc: "Sunday",
      });
    }

    const limit = Math.min(
      Math.max(Number(searchParams.get("limit") ?? 25), 1),
      100
    );

    const { weekStartIso, weekEndIso } = getPreviousWeekWindowUtc();

    let query = supabase
      .from("orders")
      .select(
        `
          id,
          created_at,
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
      .order("created_at", { ascending: true })
      .limit(limit);

    if (!forceRun) {
      query = query.gte("created_at", weekStartIso).lt("created_at", weekEndIso);
    }

    const { data: orders, error } = await query;

    if (error) {
      throw new Error(`Failed to load eligible orders: ${error.message}`);
    }

    const typedOrders = (orders ?? []) as OrderRow[];
    const results: ProcessResult[] = [];

    for (const order of typedOrders) {
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

    return json({
      ok: true,
      actor,
      cron,
      weekly: !forceRun,
      force_run: forceRun,
      payout_day_utc: "Sunday",
      payout_window_start: forceRun ? null : weekStartIso,
      payout_window_end: forceRun ? null : weekEndIso,
      checked_orders: typedOrders.length,
      processed,
      skipped,
      failed,
      results,
    });
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