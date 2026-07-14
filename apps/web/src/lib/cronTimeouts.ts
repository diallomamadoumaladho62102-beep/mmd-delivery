/**
 * Explicit timeouts and Vercel budget for production crons.
 *
 * Confirmed on this project: `apps/web/app/api/ai/chat/route.ts` sets
 * `export const maxDuration = 60`, so serverless functions are allowed ≥60s.
 * Cron routes now set the same `maxDuration = 60`.
 *
 * Internal job budget is intentionally below that ceiling so we can release
 * locks and return a structured partial response before Vercel kills us.
 */

export const CRON_VERCEL_MAX_DURATION_SEC = 60;
export const CRON_JOB_BUDGET_MS = 45_000;
export const CRON_LOCK_TIMEOUT_MS = 3_000;
export const CRON_SUPABASE_TIMEOUT_MS = 8_000;
export const CRON_STRIPE_TIMEOUT_MS = 10_000;
export const CRON_DEFAULT_BATCH_LIMIT = 1;

export class CronTimeoutError extends Error {
  readonly code:
    | "supabase_timeout"
    | "stripe_timeout"
    | "lock_timeout"
    | "job_deadline_reached"
    | "vercel_deadline_approaching";

  constructor(
    code: CronTimeoutError["code"],
    message?: string
  ) {
    super(message ?? code);
    this.name = "CronTimeoutError";
    this.code = code;
  }
}

export function readCronBatchLimit(
  searchParams: URLSearchParams | null | undefined,
  fallback = CRON_DEFAULT_BATCH_LIMIT
): number {
  const raw = searchParams?.get("limit");
  if (raw != null && String(raw).trim() !== "") {
    const fromQuery = Number(raw);
    if (Number.isFinite(fromQuery) && fromQuery >= 0) {
      return Math.min(100, Math.max(0, Math.floor(fromQuery)));
    }
  }
  const fromEnv = Number(process.env.CRON_BATCH_LIMIT ?? fallback);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) {
    return Math.min(100, Math.max(0, Math.floor(fromEnv)));
  }
  return fallback;
}

export function remainingBudgetMs(startedMs: number, budgetMs = CRON_JOB_BUDGET_MS): number {
  return Math.max(0, budgetMs - (Date.now() - startedMs));
}

export function isDeadlineApproaching(
  startedMs: number,
  budgetMs = CRON_JOB_BUDGET_MS,
  reserveMs = 3_000
): boolean {
  return remainingBudgetMs(startedMs, budgetMs) <= reserveMs;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: CronTimeoutError["code"]
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new CronTimeoutError(code, `${code} after ${timeoutMs}ms`));
        }, Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Fetch wrapper that aborts after timeoutMs. */
export function createTimedFetch(
  timeoutMs: number,
  code: CronTimeoutError["code"] = "supabase_timeout"
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const parent = init?.signal;
      if (parent) {
        if (parent.aborted) controller.abort();
        else {
          parent.addEventListener("abort", () => controller.abort(), {
            once: true,
          });
        }
      }
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || /aborted/i.test(error.message))
      ) {
        throw new CronTimeoutError(code, `fetch_aborted_after_${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
