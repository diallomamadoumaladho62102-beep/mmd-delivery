/**
 * Shared helpers for consolidated Vercel cron orchestrators.
 * Sibling routes keep their own locks / auth; fan-out just sequences them.
 */

export type CronFanoutResult = {
  path: string;
  ok: boolean;
  status: number;
  skipped?: boolean;
  error?: string;
  body?: unknown;
  durationMs: number;
};

export function resolveCronBaseUrl(reqUrl?: string | null): string {
  const fromEnv = String(
    process.env.CRON_BASE_URL ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      ""
  ).trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const vercel = String(process.env.VERCEL_URL ?? "").trim();
  if (vercel) {
    return vercel.startsWith("http") ? vercel.replace(/\/$/, "") : `https://${vercel}`;
  }

  if (reqUrl) {
    try {
      const u = new URL(reqUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* ignore */
    }
  }

  return "http://127.0.0.1:3000";
}

export function buildCronAuthHeaders(): Record<string, string> {
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
    headers["x-cron-secret"] = secret;
  }
  return headers;
}

/** Hobby-safe daily schedules only (no minute/hour wildcards in day slot). */
export function isHobbySafeDailyCron(expression: string): boolean {
  const parts = String(expression ?? "")
    .trim()
    .split(/\s+/);
  if (parts.length < 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  // Reject any field that implies multiple runs per day (lists/steps/ranges in minute/hour,
  // or wildcards that expand to more than one fire daily for minute/hour).
  if (minute.includes("*") || minute.includes("/") || minute.includes(",")) return false;
  if (hour.includes("*") || hour.includes("/") || hour.includes(",")) return false;
  // day/month/dow may be * (once per matching calendar day) — still ≤1/day.
  void dayOfMonth;
  void month;
  void dayOfWeek;
  return /^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour);
}

export async function invokeCronPath(
  path: string,
  opts?: { baseUrl?: string; timeoutMs?: number; method?: "GET" | "POST" }
): Promise<CronFanoutResult> {
  const started = Date.now();
  const baseUrl = (opts?.baseUrl ?? resolveCronBaseUrl()).replace(/\/$/, "");
  const timeoutMs = Math.max(3_000, Number(opts?.timeoutMs ?? 18_000) || 18_000);
  const method = opts?.method ?? "POST";
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: buildCronAuthHeaders(),
      signal: controller.signal,
      cache: "no-store",
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const skipped =
      Boolean(body && typeof body === "object" && (body as { skipped?: unknown }).skipped) ||
      res.status === 409;
    return {
      path,
      ok: res.ok,
      status: res.status,
      skipped,
      body,
      durationMs: Date.now() - started,
      error: res.ok
        ? undefined
        : typeof body === "object" && body && "error" in body
          ? String((body as { error: unknown }).error)
          : `http_${res.status}`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      path,
      ok: false,
      status: 0,
      error: /abort/i.test(message) ? `timeout_after_${timeoutMs}ms` : message,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runCronFanout(
  paths: string[],
  opts?: { baseUrl?: string; timeoutMs?: number; stopOnFatal?: boolean }
): Promise<{ results: CronFanoutResult[]; ok: boolean; failed: number }> {
  const results: CronFanoutResult[] = [];
  for (const path of paths) {
    const result = await invokeCronPath(path, {
      baseUrl: opts?.baseUrl,
      timeoutMs: opts?.timeoutMs,
    });
    results.push(result);
    if (!result.ok && opts?.stopOnFatal) break;
  }
  const failed = results.filter((r) => !r.ok && !r.skipped).length;
  return { results, ok: failed === 0, failed };
}
