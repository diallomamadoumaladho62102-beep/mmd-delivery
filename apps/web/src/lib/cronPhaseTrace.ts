import { randomUUID } from "node:crypto";

export type CronPhaseName =
  | "request_received"
  | "auth_validated"
  | "lock_attempt_started"
  | "lock_acquired"
  | "lock_busy"
  | "supabase_query_started"
  | "supabase_query_finished"
  | "stripe_retrieve_started"
  | "stripe_retrieve_finished"
  | "processing_started"
  | "processing_finished"
  | "response_sent"
  | "job_deadline_reached"
  | "vercel_deadline_approaching"
  | "error";

export type CronPhaseEvent = {
  event: "cron_phase";
  phase: CronPhaseName;
  job: string;
  run_id: string;
  at: string;
  elapsed_ms: number;
  phase_ms: number;
  batch_size?: number;
  resource_ref?: string | null;
  detail?: Record<string, unknown>;
};

export type CronPhaseTracer = {
  run_id: string;
  job: string;
  startedMs: number;
  mark: (
    phase: CronPhaseName,
    opts?: {
      batch_size?: number;
      resource_ref?: string | null;
      detail?: Record<string, unknown>;
    }
  ) => CronPhaseEvent;
  phases: CronPhaseEvent[];
  elapsedMs: () => number;
};

/** Mask IDs in logs: keep prefix + truncated remainder. */
export function maskResourceId(id: unknown): string | null {
  const raw = String(id ?? "").trim();
  if (!raw) return null;
  if (raw.length <= 8) return `${raw.slice(0, 2)}…`;
  return `${raw.slice(0, 8)}…`;
}

export function createCronPhaseTracer(job: string, runId?: string): CronPhaseTracer {
  const run_id = runId ?? randomUUID();
  const startedMs = Date.now();
  let lastMs = startedMs;
  const phases: CronPhaseEvent[] = [];

  const mark: CronPhaseTracer["mark"] = (phase, opts) => {
    const now = Date.now();
    const event: CronPhaseEvent = {
      event: "cron_phase",
      phase,
      job,
      run_id,
      at: new Date(now).toISOString(),
      elapsed_ms: Math.max(0, now - startedMs),
      phase_ms: Math.max(0, now - lastMs),
      batch_size: opts?.batch_size,
      resource_ref: opts?.resource_ref ?? null,
      detail: opts?.detail,
    };
    lastMs = now;
    phases.push(event);
    console.log(JSON.stringify(event));
    return event;
  };

  return {
    run_id,
    job,
    startedMs,
    mark,
    phases,
    elapsedMs: () => Math.max(0, Date.now() - startedMs),
  };
}
