/**
 * Normalize any thrown value into a real Error for Sentry.
 * Passing plain objects (PostgREST `{message,code,details,hint}` or RPC `{ok,error}`)
 * produces "Object captured as exception" noise instead of actionable stack traces.
 */
export function toCapturableError(error: unknown, fallbackMessage = "Unknown error"): Error {
  if (error instanceof Error) return error;

  if (typeof error === "string" && error.trim()) {
    return new Error(error.trim());
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message =
      (typeof record.message === "string" && record.message.trim()) ||
      (typeof record.error === "string" && record.error.trim()) ||
      (typeof record.msg === "string" && record.msg.trim()) ||
      fallbackMessage;

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

  return new Error(fallbackMessage);
}
