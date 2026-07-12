import { NextResponse } from "next/server";

/**
 * Safely parse a JSON request body. Malformed / empty bodies return a clean
 * 400 instead of throwing (which would surface as a noisy 500 in Sentry).
 *
 * Usage:
 *   const parsed = await safeRequestJson(request);
 *   if (!parsed.ok) return parsed.response;
 *   const body = parsed.body;
 */
export async function safeRequestJson<T = Record<string, unknown>>(
  request: Request,
): Promise<
  | { ok: true; body: T; response?: undefined }
  | { ok: false; body?: undefined; response: NextResponse }
> {
  try {
    const body = (await request.json()) as T;
    if (body === null || typeof body !== "object") {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }),
      };
    }
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }),
    };
  }
}
