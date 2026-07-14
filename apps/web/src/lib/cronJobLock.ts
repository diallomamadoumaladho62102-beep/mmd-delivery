import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import {
  CRON_LOCK_TIMEOUT_MS,
  CronTimeoutError,
} from "@/lib/cronTimeouts";

export type CronLockAcquisition =
  | { ok: true; lockedBy: string; lockedUntil: string | null }
  | { ok: false; error: string; lockedBy?: string | null; lockedUntil?: string | null };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Prefer a client whose fetch abort matches lock timeout.
 * Falls back to the caller client (unit tests / missing env).
 * Avoid Promise.race shorter than fetch abort: that orphans DB locks.
 */
function lockRpcClient(
  fallback: SupabaseClient,
  timeoutMs: number
): SupabaseClient {
  try {
    return buildCronSupabaseAdmin(timeoutMs);
  } catch {
    return fallback;
  }
}

function asTimeoutCode(error: unknown): CronTimeoutError["code"] | null {
  if (error instanceof CronTimeoutError) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch_aborted_after_/i.test(message) || /supabase_timeout/i.test(message)) {
    return "supabase_timeout";
  }
  if (/lock_timeout/i.test(message)) return "lock_timeout";
  return null;
}

export async function acquireCronJobLock(
  supabaseAdmin: SupabaseClient,
  jobName: string,
  opts?: { lockedBy?: string; ttlSeconds?: number; timeoutMs?: number }
): Promise<CronLockAcquisition> {
  const lockedBy = String(opts?.lockedBy ?? `cron:${randomUUID()}`).trim();
  const ttlSeconds = Math.max(30, Number(opts?.ttlSeconds ?? 300) || 300);
  const timeoutMs = Math.max(500, Number(opts?.timeoutMs ?? CRON_LOCK_TIMEOUT_MS) || CRON_LOCK_TIMEOUT_MS);
  const client = lockRpcClient(supabaseAdmin, timeoutMs);

  try {
    const { data, error } = await client.rpc("try_acquire_cron_job_lock", {
      p_job_name: jobName,
      p_locked_by: lockedBy,
      p_ttl_seconds: ttlSeconds,
    });

    if (error) {
      const timed = asTimeoutCode(error);
      if (timed) {
        await releaseCronJobLock(
          supabaseAdmin,
          jobName,
          lockedBy,
          "acquire_client_timeout_cleanup"
        );
        return { ok: false, error: timed };
      }
      return { ok: false, error: error.message };
    }

    const payload = asRecord(data);
    if (!payload || payload.ok !== true) {
      return {
        ok: false,
        error: String(payload?.error ?? "lock_busy"),
        lockedBy:
          typeof payload?.locked_by === "string" ? payload.locked_by : null,
        lockedUntil:
          typeof payload?.locked_until === "string" ? payload.locked_until : null,
      };
    }

    return {
      ok: true,
      lockedBy,
      lockedUntil:
        typeof payload.locked_until === "string" ? payload.locked_until : null,
    };
  } catch (error) {
    const timed = asTimeoutCode(error);
    if (timed) {
      // Best-effort: if the server committed after our abort, drop our lease.
      await releaseCronJobLock(
        supabaseAdmin,
        jobName,
        lockedBy,
        "acquire_client_timeout_cleanup"
      );
      return { ok: false, error: timed };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function releaseCronJobLock(
  supabaseAdmin: SupabaseClient,
  jobName: string,
  lockedBy: string,
  errorMessage?: string | null
): Promise<void> {
  try {
    const client = lockRpcClient(supabaseAdmin, CRON_LOCK_TIMEOUT_MS);
    const { error } = await client.rpc("release_cron_job_lock", {
      p_job_name: jobName,
      p_locked_by: lockedBy,
      p_error: errorMessage ?? null,
    });

    if (error) {
      console.error("[cronJobLock] release failed", {
        jobName,
        message: error.message,
      });
    }
  } catch (error) {
    console.error("[cronJobLock] release timed out or failed", {
      jobName,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function withCronJobLock<T>(
  supabaseAdmin: SupabaseClient,
  jobName: string,
  fn: () => Promise<T>,
  opts?: { lockedBy?: string; ttlSeconds?: number; timeoutMs?: number }
): Promise<
  | { ok: true; result: T; lockedBy: string }
  | { ok: false; error: "lock_busy" | "lock_timeout" | string; lockedBy?: string | null }
> {
  const acquired = await acquireCronJobLock(supabaseAdmin, jobName, opts);
  if (acquired.ok === false) {
    return {
      ok: false,
      error: acquired.error,
      lockedBy: acquired.lockedBy ?? null,
    };
  }

  try {
    const result = await fn();
    await releaseCronJobLock(supabaseAdmin, jobName, acquired.lockedBy, null);
    return { ok: true, result, lockedBy: acquired.lockedBy };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await releaseCronJobLock(supabaseAdmin, jobName, acquired.lockedBy, message);
    throw error;
  }
}

/** Best-effort clear of a hung lease (ops / recovery). */
export async function forceReleaseExpiredCronJobLock(
  supabaseAdmin: SupabaseClient,
  jobName: string
): Promise<void> {
  try {
    const client = lockRpcClient(supabaseAdmin, CRON_LOCK_TIMEOUT_MS);
    await client
      .from("cron_job_locks")
      .update({
        locked_by: null,
        locked_at: null,
        locked_until: null,
        last_error: "force_clear_expired_or_ops",
        updated_at: new Date().toISOString(),
      })
      .eq("job_name", jobName);
  } catch (error) {
    console.error("[cronJobLock] force release timed out or failed", {
      jobName,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
