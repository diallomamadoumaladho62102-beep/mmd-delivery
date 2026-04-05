import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  orderId?: string;
  order_id?: string;
};

type RpcResult = {
  ok?: boolean;
  error?: string;
};

const ORDER_ID_MAX_LENGTH = 128;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function methodNotAllowed() {
  return NextResponse.json(
    { error: "Method not allowed" },
    {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error && value.message) {
    return value.message;
  }

  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string"
  ) {
    return (value as { message: string }).message;
  }

  return "Unknown error";
}

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

function normalizeOrderId(value: unknown): string {
  const raw = String(value ?? "").trim();

  if (!raw) return "";

  if (raw.length > ORDER_ID_MAX_LENGTH) {
    throw new Error("Invalid order_id");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error("Invalid order_id");
  }

  return raw;
}

async function parseBody(req: NextRequest): Promise<Body> {
  const contentLengthHeader = req.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BODY_BYTES
  ) {
    throw new Error("Request body too large");
  }

  const raw = await req.text();

  if (raw.length > MAX_REQUEST_BODY_BYTES) {
    throw new Error("Request body too large");
  }

  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw) as Body;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function getSupabaseUserClient(token: string): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)"
    );
  }

  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

function mapRpcFailureToHttp(message: string) {
  const normalized = message.trim();

  if (normalized === "Order not found") {
    return { status: 404, error: normalized };
  }

  if (
    normalized === "Forbidden (not order owner)" ||
    normalized === "Forbidden"
  ) {
    return { status: 403, error: normalized };
  }

  if (
    normalized === "Commission row not found for order" ||
    normalized === "Invalid order status" ||
    normalized === "Order is not eligible for delivery confirmation" ||
    normalized === "Order not dispatched yet"
  ) {
    return { status: 400, error: normalized };
  }

  return { status: 409, error: normalized || "Delivery confirmation failed" };
}

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const supabaseUser = getSupabaseUserClient(token);
    const supabaseAdmin = getSupabaseAdminClient();

    const {
      data: userData,
      error: userErr,
    } = await supabaseUser.auth.getUser();

    const user = userData?.user;

    if (userErr || !user?.id) {
      return json({ error: "Invalid token" }, 401);
    }

    const body = await parseBody(req);

    let orderId = "";
    try {
      orderId = normalizeOrderId(body.order_id ?? body.orderId);
    } catch {
      return json({ error: "Invalid order_id" }, 400);
    }

    if (!orderId) {
      return json({ error: "Missing order_id" }, 400);
    }

    const { data, error } = await supabaseAdmin.rpc("confirm_order_delivery", {
      p_order_id: orderId,
      p_owner_user_id: user.id,
    });

    if (error) {
      console.error("[delivered-confirm] RPC failed", {
        order_id: orderId,
        user_id: user.id,
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });

      return json({ error: "Delivery confirmation failed" }, 500);
    }

    const result = (data ?? null) as RpcResult | null;

    if (!result?.ok) {
      const mapped = mapRpcFailureToHttp(result?.error || "");
      return json({ error: mapped.error }, mapped.status);
    }

    return json({
      ok: true,
      order_id: orderId,
      result,
    });
  } catch (e: unknown) {
    const message = getErrorMessage(e);

    if (message === "Invalid JSON body") {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (message === "Request body too large") {
      return json({ error: "Request body too large" }, 413);
    }

    console.error("[delivered-confirm] fatal error", {
      message,
    });

    return json({ error: "Internal server error" }, 500);
  }
}

export async function GET() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}