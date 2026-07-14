import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronJobLock } from "@/lib/cronJobLock";
import { finishCronRun, startCronRun } from "@/lib/cronObservability";
import {
  PAYMENT_EXPIRATION_LOCK_JOB,
  runExpireStalePayments,
} from "@/lib/expireStalePayments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Compatibility alias for historical Vercel cron `/api/orders/expire-unpaid`.
 * Delegates to the same runner as `/api/cron/expire-stale-payments` and shares
 * the `payment-expiration` lock so both cannot cancel the same rows concurrently.
 *
 * Canonical schedule owner: `/api/cron/expire-stale-payments`.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function methodNotAllowed() {
  return NextResponse.json(
    { error: "Method not allowed" },
    {
      status: 405,
      headers: {
        Allow: "GET, POST",
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function getStripe(): Stripe | null {
  const key = String(process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

function readDryRun(req: NextRequest): boolean {
  const fromEnv =
    String(process.env.EXPIRE_STALE_PAYMENTS_DRY_RUN ?? "")
      .trim()
      .toLowerCase() === "true";
  const urlFlag = req.nextUrl.searchParams.get("dry_run");
  if (urlFlag === "1" || urlFlag === "true") return true;
  if (urlFlag === "0" || urlFlag === "false") return false;
  return fromEnv;
}

async function handle(req: NextRequest) {
  const dryRun = readDryRun(req);
  const start = startCronRun("expire-unpaid", dryRun);

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
    const locked = await withCronJobLock(
      supabaseAdmin,
      PAYMENT_EXPIRATION_LOCK_JOB,
      async () =>
        runExpireStalePayments({
          supabaseAdmin,
          stripe: getStripe(),
          dryRun,
        }),
      { ttlSeconds: 10 * 60 }
    );

    if (!locked.ok) {
      return json(
        finishCronRun(start, {
          ok: true,
          skipped: 1,
          reason: "lock_busy",
          job_lock: PAYMENT_EXPIRATION_LOCK_JOB,
          lock_acquired: false,
          alias_of: "expire-stale-payments",
        })
      );
    }

    return json(
      finishCronRun(start, {
        ok: true,
        dry_run: locked.result.dry_run,
        scanned: locked.result.scanned,
        canceled_local: locked.result.canceled_local,
        stripe_pi_canceled: locked.result.stripe_pi_canceled,
        stripe_pi_skipped: locked.result.stripe_pi_skipped,
        stripe_pi_already_canceled: locked.result.stripe_pi_already_canceled,
        error_count: locked.result.errors,
        details: locked.result.details,
        processed: locked.result.canceled_local,
        eligible: locked.result.scanned,
        skipped: locked.result.stripe_pi_skipped,
        failed: locked.result.errors,
        lock_acquired: true,
        alias_of: "expire-stale-payments",
        job_lock: PAYMENT_EXPIRATION_LOCK_JOB,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[expire-unpaid] fatal", { message, run_id: start.run_id });
    return json(
      finishCronRun(start, {
        ok: false,
        error: "Internal server error",
        lock_acquired: false,
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

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
