/**
 * Shared evaluator for cron HTTP responses.
 * Treats non-2xx, invalid JSON, and { ok:false } / { success:false } as failures.
 */

/**
 * @param {number} status
 * @param {string} bodyText
 * @returns {{ ok: true, body: unknown } | { ok: false, reason: string, body?: unknown }}
 */
export function evaluateCronHttpResult(status, bodyText) {
  const text = String(bodyText ?? "");
  let body = null;
  const trimmed = text.trim();

  if (trimmed) {
    try {
      body = JSON.parse(trimmed);
    } catch {
      if (status >= 200 && status < 300) {
        return {
          ok: false,
          reason: "invalid_json_body",
        };
      }
    }
  }

  if (!(status >= 200 && status < 300)) {
    return {
      ok: false,
      reason: `http_${status}`,
      body,
    };
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    if (Object.prototype.hasOwnProperty.call(body, "ok") && body.ok === false) {
      return { ok: false, reason: "ok_false", body };
    }
    if (
      Object.prototype.hasOwnProperty.call(body, "success") &&
      body.success === false
    ) {
      return { ok: false, reason: "success_false", body };
    }
  }

  return { ok: true, body };
}
