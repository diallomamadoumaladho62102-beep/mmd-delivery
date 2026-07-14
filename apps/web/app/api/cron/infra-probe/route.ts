import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronJobLock } from "@/lib/cronJobLock";
import { finishCronRun, startCronRun } from "@/lib/cronObservability";
import { createCronPhaseTracer } from "@/lib/cronPhaseTrace";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import {
  CRON_JOB_BUDGET_MS,
  CRON_STRIPE_TIMEOUT_MS,
  CRON_SUPABASE_TIMEOUT_MS,
  CRON_VERCEL_MAX_DURATION_SEC,
  CronTimeoutError,
  withTimeout,
} from "@/lib/cronTimeouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Confirmed project ceiling via sibling route /api/ai/chat (maxDuration=60). */
export const maxDuration = CRON_VERCEL_MAX_DURATION_SEC;

const JOB = "infra-probe";
const LOCK = "infra-probe";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Lightweight authenticated probe isolating infrastructure from business work:
 * auth → lock acquire/release → simple Supabase select → optional Stripe retrieve.
 */
async function handle(req: NextRequest) {
  const dryRun = true;
  const start = startCronRun(JOB, dryRun);
  const trace = createCronPhaseTracer(JOB, start.run_id);
  trace.mark("request_received");

  try {
    if (!isAuthorizedCronRequest(req)) {
      trace.mark("response_sent", { detail: { auth: false } });
      return json(
        finishCronRun(start, {
          ok: false,
          error: "Unauthorized",
          lock_acquired: false,
          phases: trace.phases,
          vercel_max_duration_sec: CRON_VERCEL_MAX_DURATION_SEC,
          job_budget_ms: CRON_JOB_BUDGET_MS,
        }),
        401
      );
    }
    trace.mark("auth_validated");

    const supabase = buildCronSupabaseAdmin(CRON_SUPABASE_TIMEOUT_MS);
    const wantStripe =
      req.nextUrl.searchParams.get("stripe") === "1" ||
      req.nextUrl.searchParams.get("stripe") === "true";

    trace.mark("lock_attempt_started");
    const locked = await withCronJobLock(
      supabase,
      LOCK,
      async () => {
        trace.mark("lock_acquired");

        trace.mark("supabase_query_started", {
          detail: { query: "cron_job_locks_select_1" },
        });
        const { data, error } = await supabase
          .from("cron_job_locks")
          .select("job_name")
          .limit(1);
        if (error) {
          throw new Error(`supabase_probe_failed: ${error.message}`);
        }
        trace.mark("supabase_query_finished", {
          detail: { rows: Array.isArray(data) ? data.length : 0 },
        });

        let stripeProbe: Record<string, unknown> | null = null;
        if (wantStripe) {
          const key = String(process.env.STRIPE_SECRET_KEY ?? "").trim();
          if (!key) {
            stripeProbe = { ok: false, error: "stripe_key_missing" };
          } else {
            const stripe = new Stripe(key, { apiVersion: "2023-10-16" });
            const piId = String(
              req.nextUrl.searchParams.get("payment_intent_id") ?? ""
            ).trim();
            trace.mark("stripe_retrieve_started", {
              detail: { mode: piId ? "payment_intent" : "balance" },
            });
            try {
              if (piId.startsWith("pi_")) {
                const pi = await withTimeout(
                  stripe.paymentIntents.retrieve(piId),
                  CRON_STRIPE_TIMEOUT_MS,
                  "stripe_timeout"
                );
                stripeProbe = {
                  ok: true,
                  kind: "payment_intent",
                  status: pi.status,
                };
              } else {
                const balance = await withTimeout(
                  stripe.balance.retrieve(),
                  CRON_STRIPE_TIMEOUT_MS,
                  "stripe_timeout"
                );
                stripeProbe = {
                  ok: true,
                  kind: "balance",
                  available_currencies: (balance.available ?? []).map(
                    (row) => row.currency
                  ),
                };
              }
            } catch (error) {
              stripeProbe = {
                ok: false,
                error:
                  error instanceof CronTimeoutError
                    ? error.code
                    : error instanceof Error
                      ? error.message
                      : String(error),
              };
            }
            trace.mark("stripe_retrieve_finished", {
              detail: { ok: stripeProbe.ok === true },
            });
          }
        }

        return {
          supabase_ok: true,
          stripe_probe: stripeProbe,
        };
      },
      { lockedBy: `probe:${start.run_id}`, ttlSeconds: 60 }
    );

    if (locked.ok === false) {
      trace.mark("lock_busy", { detail: { error: locked.error } });
      trace.mark("response_sent");
      return json(
        finishCronRun(start, {
          ok: locked.error === "lock_busy" || locked.error === "lock_timeout",
          reason: locked.error,
          lock_acquired: false,
          phases: trace.phases,
          vercel_max_duration_sec: CRON_VERCEL_MAX_DURATION_SEC,
          job_budget_ms: CRON_JOB_BUDGET_MS,
          supabase_timeout_ms: CRON_SUPABASE_TIMEOUT_MS,
        })
      );
    }

    trace.mark("processing_finished");
    trace.mark("response_sent");
    return json(
      finishCronRun(start, {
        ok: true,
        lock_acquired: true,
        probe: locked.result,
        phases: trace.phases,
        vercel_max_duration_sec: CRON_VERCEL_MAX_DURATION_SEC,
        job_budget_ms: CRON_JOB_BUDGET_MS,
        supabase_timeout_ms: CRON_SUPABASE_TIMEOUT_MS,
        stripe_timeout_ms: CRON_STRIPE_TIMEOUT_MS,
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
