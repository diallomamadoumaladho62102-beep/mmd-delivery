/**
 * Normalize any thrown value into a real Error for Sentry.
 * Passing plain objects (PostgREST `{message,code,details,hint}` or RPC `{ok,error}`)
 * produces "Object captured as exception" noise instead of actionable stack traces.
 * Empty-message Errors become titled `<unknown>` in Sentry — rewrite those too.
 */
export function toCapturableError(error: unknown, fallbackMessage = "Unknown error"): Error {
  const fallback = String(fallbackMessage || "Unknown error").trim() || "Unknown error";

  if (error instanceof Error) {
    if (String(error.message ?? "").trim()) return error;
    const err = new Error(fallback);
    err.name = error.name?.trim() || "EmptyError";
    try {
      (err as Error & { cause?: unknown }).cause = error;
    } catch {
      // ignore
    }
    return err;
  }

  if (typeof error === "string" && error.trim()) {
    return new Error(error.trim());
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message =
      (typeof record.message === "string" && record.message.trim()) ||
      (typeof record.error === "string" && record.error.trim()) ||
      (typeof record.msg === "string" && record.msg.trim()) ||
      fallback;

    const err = new Error(message);
    err.name =
      (typeof record.name === "string" && record.name.trim()) ||
      (typeof record.code === "string" && record.code.trim()) ||
      "CapturedObjectError";

    try {
      (err as Error & { cause?: unknown }).cause = error;
    } catch {
      // ignore non-writable cause
    }

    return err;
  }

  return new Error(fallback);
}
