import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export type CronLockAcquisition =
  | { ok: true; lockedBy: string; lockedUntil: string | null }
  | { ok: false; error: string; lockedBy?: string | null; lockedUntil?: string | null };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function acquireCronJobLock(
  supabaseAdmin: SupabaseClient,
  jobName: string,
  opts?: { lockedBy?: string; ttlSeconds?: number }
): Promise<CronLockAcquisition> {
  const lockedBy = String(opts?.lockedBy ?? `cron:${randomUUID()}`).trim();
  const ttlSeconds = Math.max(30, Number(opts?.ttlSeconds ?? 300) || 300);

  const { data, error } = await supabaseAdmin.rpc("try_acquire_cron_job_lock", {
    p_job_name: jobName,
    p_locked_by: lockedBy,
    p_ttl_seconds: ttlSeconds,
  });

  if (error) {
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
}

export async function releaseCronJobLock(
  supabaseAdmin: SupabaseClient,
  jobName: string,
  lockedBy: string,
  errorMessage?: string | null
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("release_cron_job_lock", {
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
}

export async function withCronJobLock<T>(
  supabaseAdmin: SupabaseClient,
  jobName: string,
  fn: () => Promise<T>,
  opts?: { lockedBy?: string; ttlSeconds?: number }
): Promise<
  | { ok: true; result: T; lockedBy: string }
  | { ok: false; error: "lock_busy" | string; lockedBy?: string | null }
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
