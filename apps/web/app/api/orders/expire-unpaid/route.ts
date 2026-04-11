import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExpirableOrderRow = {
  id: string;
  status: string | null;
  payment_status: string | null;
  expires_at: string | null;
  paid_at?: string | null;
  stripe_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
};

const EXPIRE_BATCH_LIMIT = 500;

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

function isTerminalStatus(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "delivered" || s === "ready" || s === "canceled";
}

function isExpiredIso(value: unknown, nowMs: number): boolean {
  const iso = String(value ?? "").trim();
  if (!iso) return false;

  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return false;

  return ms < nowMs;
}

function shouldCancelExpiredOrder(
  order: ExpirableOrderRow,
  nowMs: number
): boolean {
  if (!order?.id) return false;
  if (isTerminalStatus(order.status)) return false;

  const paymentStatus = String(order.payment_status ?? "").trim().toLowerCase();
  if (paymentStatus !== "unpaid" && paymentStatus !== "processing") {
    return false;
  }

  return isExpiredIso(order.expires_at, nowMs);
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

function isAuthorizedCronRequest(req: NextRequest): boolean {
  const provided = (req.headers.get("x-cron-secret") || "").trim();
  const expected = (process.env.CRON_SECRET || "").trim();

  if (!expected || !provided) return false;
  return provided === expected;
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(req)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const now = new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    const { data, error: selErr } = await supabaseAdmin
      .from("orders")
      .select(
        "id, status, payment_status, expires_at, paid_at, stripe_session_id, stripe_payment_intent_id"
      )
      .in("payment_status", ["unpaid", "processing"])
      .not("expires_at", "is", null)
      .lt("expires_at", nowIso)
      .limit(EXPIRE_BATCH_LIMIT);

    if (selErr) {
      console.error("[expire-unpaid] select failed", {
        message: selErr.message,
        code: selErr.code,
        details: selErr.details,
        hint: selErr.hint,
      });

      return json({ error: "Failed to query expired orders" }, 500);
    }

    const expired = Array.isArray(data)
      ? (data as ExpirableOrderRow[])
      : [];

    if (!expired.length) {
      return json({
        ok: true,
        expired: 0,
        canceled: 0,
      });
    }

    const ids = expired
      .filter((order) => shouldCancelExpiredOrder(order, nowMs))
      .map((order) => order.id);

    if (!ids.length) {
      return json({
        ok: true,
        expired: expired.length,
        canceled: 0,
        note: "No cancellable rows",
      });
    }

    const { error: updErr } = await supabaseAdmin
      .from("orders")
      .update({
        status: "canceled",
        payment_status: "unpaid",
        updated_at: nowIso,
      })
      .in("id", ids)
      .neq("payment_status", "paid");

    if (updErr) {
      console.error("[expire-unpaid] update failed", {
        message: updErr.message,
        code: updErr.code,
        details: updErr.details,
        hint: updErr.hint,
        ids_count: ids.length,
      });

      return json({ error: "Failed to cancel expired orders" }, 500);
    }

    return json({
      ok: true,
      expired: expired.length,
      canceled: ids.length,
      ids,
    });
  } catch (e: unknown) {
    const message = getErrorMessage(e);

    console.error("[expire-unpaid] fatal error", {
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
