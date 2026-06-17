import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  assertPushTargetInContext,
  parseSecurePushSendBody,
  type SecurePushPayload,
} from "@/lib/securePushSend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function mapValidationStatus(message: string): number {
  if (
    message === "Invalid JSON body" ||
    message.startsWith("Invalid ") ||
    message.includes(" is required") ||
    message.includes(" too long") ||
    message === "data must be an object" ||
    message === "data too large"
  ) {
    return 400;
  }

  if (message === "Target user is not a participant of the provided context") {
    return 403;
  }

  if (message === "Context resource not found") {
    return 404;
  }

  if (message === "Context verification failed") {
    return 503;
  }

  return 500;
}

async function sendExpoPush(payload: SecurePushPayload, tokens: string[]) {
  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data,
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXPO_PUSH_TIMEOUT_MS);

  try {
    const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
      signal: controller.signal,
      cache: "no-store",
    });

    let expoJson: unknown = {};
    try {
      expoJson = await expoRes.json();
    } catch {
      return { ok: false as const, status: 502, error: "Invalid push provider response" };
    }

    const expoData = isRecord(expoJson) ? expoJson : {};
    const tickets = Array.isArray(expoData.data)
      ? (expoData.data as ExpoTicket[])
      : undefined;
    const summary = summarizeExpoTickets(tickets);

    if (!expoRes.ok) {
      return {
        ok: false as const,
        status: 502,
        error: "Push provider rejected request",
        summary,
        token_count: tokens.length,
      };
    }

    return {
      ok: true as const,
      summary,
      token_count: tokens.length,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Expo push request failed";
    console.error("[push/send] expo request failed", {
      user_id: payload.user_id,
      role: payload.role,
      message,
    });
    return { ok: false as const, status: 502, error: "Push provider request failed" };
  } finally {
    clearTimeout(timeout);
  }
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

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const payload = parseSecurePushSendBody(raw);
    const supabase = getSupabaseAdminClient();

    await assertPushTargetInContext(supabase, payload);

    const { data: rows, error } = await supabase
      .from("user_push_tokens")
      .select("expo_push_token")
      .eq("user_id", payload.user_id)
      .eq("role", payload.role)
      .limit(MAX_TOKENS_PER_REQUEST);

    if (error) {
      console.error("[push/send] token lookup failed", {
        user_id: payload.user_id,
        role: payload.role,
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

    const expoResult = await sendExpoPush(payload, tokens);
    if (!expoResult.ok) {
      return json(
        {
          ok: false,
          error: expoResult.error,
          sent: 0,
          token_count: expoResult.token_count ?? tokens.length,
        },
        expoResult.status,
      );
    }

    return json({
      ok: true,
      sent: tokens.length,
      token_count: expoResult.token_count,
      ...expoResult.summary,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown_error";
    const status = mapValidationStatus(message);

    if (status === 500) {
      console.error("[push/send] fatal error", { message });
    }

    return json(
      {
        ok: false,
        error: status >= 500 ? "Internal server error" : message,
      },
      status,
    );
  }
}
