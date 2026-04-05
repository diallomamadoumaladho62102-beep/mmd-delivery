import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PushRole = "client" | "driver" | "restaurant";

type Body = {
  user_id?: unknown;
  title?: unknown;
  body?: unknown;
  data?: unknown;
  role?: unknown;
};

type PushTokenRow = {
  expo_push_token: string | null;
};

type ExpoTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: unknown;
};

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

const USER_ID_MAX_LENGTH = 128;
const TITLE_MAX_LENGTH = 120;
const BODY_MAX_LENGTH = 1000;
const MAX_DATA_JSON_LENGTH = 4000;
const MAX_TOKENS_PER_REQUEST = 50;
const EXPO_PUSH_TIMEOUT_MS = 15000;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: JSON_HEADERS,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(
  value: unknown,
  fieldName: string,
  maxLength: number
): string {
  const s = String(value ?? "").trim();

  if (!s) {
    throw new Error(`${fieldName} is required`);
  }

  if (s.length > maxLength) {
    throw new Error(`${fieldName} too long`);
  }

  return s;
}

function normalizeOptionalRole(value: unknown): PushRole | undefined {
  const v = String(value ?? "").trim().toLowerCase();

  if (!v) return undefined;
  if (v === "client" || v === "driver" || v === "restaurant") return v;

  throw new Error("Invalid role");
}

function normalizeUserId(value: unknown): string {
  const userId = normalizeString(value, "user_id", USER_ID_MAX_LENGTH);

  if (!/^[A-Za-z0-9._:-]+$/.test(userId)) {
    throw new Error("Invalid user_id");
  }

  return userId;
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

function isExpoPushToken(token: unknown): token is string {
  const s = String(token ?? "").trim();

  return (
    /^ExponentPushToken\[[A-Za-z0-9+\-_=:/]+\]$/.test(s) ||
    /^ExpoPushToken\[[A-Za-z0-9+\-_=:/]+\]$/.test(s)
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
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

function getSupabaseAdminClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing Supabase env vars (SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)"
    );
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

async function parseBody(req: Request): Promise<{
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  role?: PushRole;
}> {
  let raw: Body;

  try {
    raw = (await req.json()) as Body;
  } catch {
    throw new Error("Invalid JSON body");
  }

  return {
    user_id: normalizeUserId(raw.user_id),
    title: normalizeString(raw.title, "title", TITLE_MAX_LENGTH),
    body: normalizeString(raw.body, "body", BODY_MAX_LENGTH),
    data: normalizeData(raw.data),
    role: normalizeOptionalRole(raw.role),
  };
}

function summarizeExpoTickets(tickets: ExpoTicket[] | undefined) {
  const arr = Array.isArray(tickets) ? tickets : [];

  let ok = 0;
  let error = 0;

  for (const t of arr) {
    if (t?.status === "ok") ok += 1;
    else if (t?.status === "error") error += 1;
  }

  return {
    ticket_count: arr.length,
    ok_count: ok,
    error_count: error,
  };
}

export async function POST(req: Request) {
  try {
    const expectedApiKey = String(process.env.PUSH_API_KEY ?? "").trim();
    const providedApiKey = String(req.headers.get("x-api-key") ?? "").trim();

    if (!expectedApiKey) {
      console.error("[push/send] missing PUSH_API_KEY");
      return json({ ok: false, error: "Server misconfigured" }, 500);
    }

    if (
      !providedApiKey ||
      !timingSafeEqualStrings(providedApiKey, expectedApiKey)
    ) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const payload = await parseBody(req);
    const supabase = getSupabaseAdminClient();

    let query = supabase
      .from("user_push_tokens")
      .select("expo_push_token")
      .eq("user_id", payload.user_id);

    if (payload.role) {
      query = query.eq("role", payload.role);
    }

    const { data: rows, error } = await query.limit(MAX_TOKENS_PER_REQUEST);

    if (error) {
      console.error("[push/send] token lookup failed", {
        user_id: payload.user_id,
        role: payload.role ?? null,
        message: error.message,
        code: error.code,
      });

      return json({ ok: false, error: "Token lookup failed" }, 500);
    }

    const tokens = uniqueStrings(
      ((rows ?? []) as PushTokenRow[])
        .map((r) => String(r.expo_push_token ?? "").trim())
        .filter(isExpoPushToken)
    );

    if (tokens.length === 0) {
      return json({
        ok: true,
        sent: 0,
        reason: "no_tokens",
      });
    }

    const messages = tokens.map((to) => ({
      to,
      sound: "default",
      title: payload.title,
      body: payload.body,
      data: payload.data,
    }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXPO_PUSH_TIMEOUT_MS);

    let expoRes: Response;
    try {
      expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(messages),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e: unknown) {
      clearTimeout(timeout);

      const message =
        e instanceof Error ? e.message : "Expo push request failed";

      console.error("[push/send] expo request failed", {
        user_id: payload.user_id,
        role: payload.role ?? null,
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
      console.error("[push/send] expo returned non-json response", {
        user_id: payload.user_id,
        role: payload.role ?? null,
        status: expoRes.status,
      });

      return json({ ok: false, error: "Invalid push provider response" }, 502);
    }

    const expoData = isRecord(expoJson) ? expoJson : {};
    const tickets = Array.isArray(expoData.data)
      ? (expoData.data as ExpoTicket[])
      : undefined;

    const summary = summarizeExpoTickets(tickets);

    if (!expoRes.ok) {
      console.error("[push/send] expo provider error", {
        user_id: payload.user_id,
        role: payload.role ?? null,
        status: expoRes.status,
        summary,
      });

      return json(
        {
          ok: false,
          error: "Push provider rejected request",
          sent: 0,
          token_count: tokens.length,
        },
        502
      );
    }

    return json({
      ok: true,
      sent: tokens.length,
      token_count: tokens.length,
      ...summary,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown_error";

    const status =
      message === "Invalid JSON body" ||
      message === "Invalid role" ||
      message === "Invalid user_id" ||
      message === "data must be an object" ||
      message === "data too large" ||
      message === "title is required" ||
      message === "body is required" ||
      message === "user_id is required" ||
      message === "title too long" ||
      message === "body too long" ||
      message === "user_id too long"
        ? 400
        : 500;

    if (status === 500) {
      console.error("[push/send] fatal error", { message });
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