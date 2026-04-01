import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  to?: unknown;
  title?: unknown;
  body?: unknown;
  data?: unknown;
};

type ExpoTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: unknown;
};

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
} as const;

const TITLE_MAX_LENGTH = 120;
const BODY_MAX_LENGTH = 1000;
const MAX_DATA_JSON_LENGTH = 4000;
const EXPO_PUSH_TIMEOUT_MS = 15000;
const DEFAULT_TITLE = "Nouvelle commande";
const DEFAULT_BODY = "Une nouvelle commande est arrivée.";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: JSON_HEADERS,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);

  if (aBytes.length !== bBytes.length) return false;

  let result = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    result |= aBytes[i] ^ bBytes[i];
  }

  return result === 0;
}

function normalizeExpoPushToken(value: unknown): string {
  const s = String(value ?? "").trim();

  if (!s) {
    throw new Error("to is required");
  }

  const valid =
    /^ExponentPushToken\[[A-Za-z0-9+\-_=:/]+\]$/.test(s) ||
    /^ExpoPushToken\[[A-Za-z0-9+\-_=:/]+\]$/.test(s);

  if (!valid) {
    throw new Error("Invalid Expo push token");
  }

  return s;
}

function normalizeOptionalText(
  value: unknown,
  fallback: string,
  fieldName: string,
  maxLength: number
): string {
  const raw = value == null ? "" : String(value).trim();
  const finalValue = raw || fallback;

  if (!finalValue) {
    throw new Error(`${fieldName} is required`);
  }

  if (finalValue.length > maxLength) {
    throw new Error(`${fieldName} too long`);
  }

  return finalValue;
}

function normalizeData(value: unknown): Record<string, unknown> {
  if (value == null) return {};

  if (!isRecord(value)) {
    throw new Error("data must be an object");
  }

  const serialized = JSON.stringify(value);

  if (serialized.length > MAX_DATA_JSON_LENGTH) {
    throw new Error("data too large");
  }

  return value;
}

async function parseBody(req: Request): Promise<{
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}> {
  let raw: Body;

  try {
    raw = (await req.json()) as Body;
  } catch {
    throw new Error("Invalid JSON body");
  }

  return {
    to: normalizeExpoPushToken(raw.to),
    title: normalizeOptionalText(raw.title, DEFAULT_TITLE, "title", TITLE_MAX_LENGTH),
    body: normalizeOptionalText(raw.body, DEFAULT_BODY, "body", BODY_MAX_LENGTH),
    data: normalizeData(raw.data),
  };
}

function summarizeExpoResponse(value: unknown) {
  if (!isRecord(value)) {
    return {
      ok_count: 0,
      error_count: 0,
      ticket_count: 0,
    };
  }

  const arr = Array.isArray(value.data) ? (value.data as ExpoTicket[]) : [];
  let okCount = 0;
  let errorCount = 0;

  for (const item of arr) {
    if (item?.status === "ok") okCount += 1;
    else if (item?.status === "error") errorCount += 1;
  }

  return {
    ok_count: okCount,
    error_count: errorCount,
    ticket_count: arr.length,
  };
}

export async function POST(req: Request) {
  try {
    const expectedApiKey = String(process.env.PUSH_API_KEY ?? "").trim();
    const providedApiKey = String(req.headers.get("x-api-key") ?? "").trim();

    if (!expectedApiKey) {
      console.error("[push/order] missing PUSH_API_KEY");
      return json({ ok: false, error: "Server misconfigured" }, 500);
    }

    if (
      !providedApiKey ||
      !timingSafeEqualStrings(providedApiKey, expectedApiKey)
    ) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const payload = await parseBody(req);

    const expoMessage = {
      to: payload.to,
      title: payload.title,
      body: payload.body,
      sound: "default" as const,
      data: payload.data,
      channelId: "orders",
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXPO_PUSH_TIMEOUT_MS);

    let expoRes: Response;

    try {
      expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(expoMessage),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e: unknown) {
      clearTimeout(timeout);

      const message = e instanceof Error ? e.message : "Push provider request failed";

      console.error("[push/order] expo request failed", {
        message,
      });

      return json({ ok: false, error: "Push provider request failed" }, 502);
    } finally {
      clearTimeout(timeout);
    }

    let expoJson: unknown = {};
    try {
      expoJson = await expoRes.json();
    } catch {
      console.error("[push/order] expo returned non-json response", {
        status: expoRes.status,
      });

      return json({ ok: false, error: "Invalid push provider response" }, 502);
    }

    const summary = summarizeExpoResponse(expoJson);

    if (!expoRes.ok) {
      console.error("[push/order] expo provider error", {
        status: expoRes.status,
        summary,
      });

      return json(
        {
          ok: false,
          error: "Push provider rejected request",
        },
        502
      );
    }

    return json({
      ok: true,
      sent: 1,
      ...summary,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown_error";

    const status =
      message === "Invalid JSON body" ||
      message === "to is required" ||
      message === "Invalid Expo push token" ||
      message === "title too long" ||
      message === "body too long" ||
      message === "data must be an object" ||
      message === "data too large"
        ? 400
        : 500;

    if (status === 500) {
      console.error("[push/order] fatal error", { message });
    }

    return json(
      {
        ok: false,
        error: status === 400 ? message : "Internal server error",
      },
      status
    );
  }
}