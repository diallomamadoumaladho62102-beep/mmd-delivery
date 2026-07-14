import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronJobLock } from "@/lib/cronJobLock";
import { finishCronRun, startCronRun } from "@/lib/cronObservability";
import { createCronPhaseTracer, maskResourceId } from "@/lib/cronPhaseTrace";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import {
  CRON_JOB_BUDGET_MS,
  CRON_STRIPE_TIMEOUT_MS,
  CRON_SUPABASE_TIMEOUT_MS,
  CRON_VERCEL_MAX_DURATION_SEC,
  CronTimeoutError,
  readCronBatchLimit,
  withTimeout,
} from "@/lib/cronTimeouts";
import {
  PAYMENT_EXPIRATION_LOCK_JOB,
  runExpireStalePayments,
} from "@/lib/expireStalePayments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = CRON_VERCEL_MAX_DURATION_SEC;

/**
 * Canonical payment-expiration cron.
 * Owns: unpaid/processing orders + delivery_requests past expires_at (+15m margin),
 * Stripe PaymentIntent cancel when safe, shared lock `payment-expiration`.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function getStripe(): Stripe | null {
  const key = String(process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) return null;
  return new Stripe(key, {
    apiVersion: "2023-10-16",
    timeout: CRON_STRIPE_TIMEOUT_MS,
    maxNetworkRetries: 0,
  });
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
  const limit = readCronBatchLimit(req.nextUrl.searchParams, 1);
  const start = startCronRun("expire-stale-payments", dryRun);
  const trace = createCronPhaseTracer("expire-stale-payments", start.run_id);
  trace.mark("request_received", { batch_size: limit });

  try {
    if (!isAuthorizedCronRequest(req)) {
      trace.mark("response_sent", { detail: { auth: false } });
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
    const stripe = getStripe();

    trace.mark("lock_attempt_started");
    const locked = await withCronJobLock(
      supabaseAdmin,
      PAYMENT_EXPIRATION_LOCK_JOB,
      async () => {
        trace.mark("lock_acquired", {
          detail: { locked_by: `expire:${start.run_id}` },
        });
        return runExpireStalePayments({
          supabaseAdmin,
          stripe,
          dryRun,
          limit,
          startedMs: start.startedMs,
          budgetMs: CRON_JOB_BUDGET_MS,
          onPhase: (phase, detail) => {
            trace.mark(phase, {
              batch_size: limit,
              resource_ref:
                typeof detail?.resource_ref === "string"
                  ? detail.resource_ref
                  : maskResourceId(detail?.entity_id),
              detail,
            });
          },
          retrievePaymentIntent: async (id) => {
            if (!stripe) throw new Error("stripe_missing");
            return withTimeout(
              stripe.paymentIntents.retrieve(id),
              CRON_STRIPE_TIMEOUT_MS,
              "stripe_timeout"
            );
          },
        });
      },
      {
        lockedBy: `expire:${start.run_id}`,
        ttlSeconds: Math.ceil(CRON_JOB_BUDGET_MS / 1000) + 30,
      }
    );

    if (locked.ok === false) {
      const reason =
        locked.error === "lock_timeout" ? "lock_timeout" : "lock_busy";
      trace.mark(reason === "lock_timeout" ? "error" : "lock_busy", {
        detail: { error: locked.error },
      });
      trace.mark("response_sent");
      return json(
        finishCronRun(start, {
          ok: true,
          skipped: 1,
          reason,
          job_lock: PAYMENT_EXPIRATION_LOCK_JOB,
          lock_acquired: false,
          phases: trace.phases,
          vercel_max_duration_sec: CRON_VERCEL_MAX_DURATION_SEC,
          job_budget_ms: CRON_JOB_BUDGET_MS,
        })
      );
    }

    const result = locked.result;
    const criticalFail = result.errors > 0 && result.canceled_local === 0;
    trace.mark("response_sent");
    return json(
      finishCronRun(start, {
        ok: !criticalFail,
        dry_run: result.dry_run,
        scanned: result.scanned,
        canceled_local: result.canceled_local,
        stripe_pi_canceled: result.stripe_pi_canceled,
        stripe_pi_skipped: result.stripe_pi_skipped,
        stripe_pi_already_canceled: result.stripe_pi_already_canceled,
        error_count: result.errors,
        details: result.details,
        processed: result.canceled_local,
        eligible: result.scanned,
        skipped: result.stripe_pi_skipped,
        failed: result.errors,
        lock_acquired: true,
        job_lock: PAYMENT_EXPIRATION_LOCK_JOB,
        partial: result.partial === true,
        stopped_reason: result.stopped_reason ?? null,
        batch_limit: limit,
        phases: trace.phases,
        vercel_max_duration_sec: CRON_VERCEL_MAX_DURATION_SEC,
        job_budget_ms: CRON_JOB_BUDGET_MS,
      }),
      criticalFail ? 500 : 200
    );
  } catch (error) {
    const code =
      error instanceof CronTimeoutError
        ? error.code
        : error instanceof Error
          ? error.message
          : "Unknown error";
    trace.mark("error", { detail: { code } });
    trace.mark("response_sent");
    console.error("[expire-stale-payments] fatal", {
      code,
      run_id: start.run_id,
    });
    return json(
      finishCronRun(start, {
        ok: false,
        error: code,
        lock_acquired: false,
        phases: trace.phases,
        vercel_max_duration_sec: CRON_VERCEL_MAX_DURATION_SEC,
        job_budget_ms: CRON_JOB_BUDGET_MS,
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
