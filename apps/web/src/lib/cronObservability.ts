import { randomUUID } from "node:crypto";

export type CronRunMetricsBase = {
  ok: boolean;
  job: string;
  run_id: string;
  dry_run: boolean;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  scanned: number;
  eligible: number;
  processed: number;
  skipped: number;
  failed: number;
  lock_acquired: boolean;
  errors: Array<Record<string, unknown>>;
};

export function startCronRun(job: string, dryRun: boolean) {
  const runId = randomUUID();
  const startedAt = new Date();
  return {
    run_id: runId,
    job,
    dry_run: dryRun,
    started_at: startedAt.toISOString(),
    startedMs: startedAt.getTime(),
  };
}

export function finishCronRun<T extends Record<string, unknown>>(
  start: { run_id: string; job: string; dry_run: boolean; started_at: string; startedMs: number },
  body: T & {
    ok: boolean;
    scanned?: number;
    eligible?: number;
    processed?: number;
    skipped?: number;
    failed?: number;
    lock_acquired?: boolean;
    error_rows?: Array<Record<string, unknown>>;
  }
): T & CronRunMetricsBase {
  const finishedAt = new Date();
  const payload = {
    ...body,
    ok: body.ok,
    job: start.job,
    run_id: start.run_id,
    dry_run: start.dry_run,
    started_at: start.started_at,
    finished_at: finishedAt.toISOString(),
    duration_ms: Math.max(0, finishedAt.getTime() - start.startedMs),
    scanned: Number(body.scanned ?? 0),
    eligible: Number(body.eligible ?? 0),
    processed: Number(body.processed ?? 0),
    skipped: Number(body.skipped ?? 0),
    failed: Number(body.failed ?? 0),
    lock_acquired: body.lock_acquired === true,
    errors: Array.isArray(body.error_rows) ? body.error_rows.slice(0, 20) : [],
  };

  // Structured, secret-free cron log line for operators.
  console.log(
    JSON.stringify({
      event: "cron_run",
      job: payload.job,
      run_id: payload.run_id,
      ok: payload.ok,
      dry_run: payload.dry_run,
      duration_ms: payload.duration_ms,
      scanned: payload.scanned,
      eligible: payload.eligible,
      processed: payload.processed,
      skipped: payload.skipped,
      failed: payload.failed,
      lock_acquired: payload.lock_acquired,
    })
  );

  return payload;
}
