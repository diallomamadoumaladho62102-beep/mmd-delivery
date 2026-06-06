import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanAccessCommunication,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { ORDER_MESSAGE_SELECT } from "@/lib/orderMessages";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const CHAT_ROLES = ["client", "driver", "restaurant", "admin"] as const;
type ChatRole = (typeof CHAT_ROLES)[number];

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function normalizeChatRole(value: unknown): ChatRole | null {
  const role = String(value ?? "").trim().toLowerCase();
  return (CHAT_ROLES as readonly string[]).includes(role)
    ? (role as ChatRole)
    : null;
}

export async function GET(request: NextRequest) {
  try {
    await assertCanAccessCommunication(request);
    const supabase = buildSupabaseAdminClient();
    const orderId = String(request.nextUrl.searchParams.get("orderId") ?? "").trim();
    const targetRole = normalizeChatRole(
      request.nextUrl.searchParams.get("targetRole")
    );

    if (!orderId) return json({ ok: false, error: "orderId required" }, 400);

    let query = supabase
      .from("order_messages")
      .select(ORDER_MESSAGE_SELECT)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (targetRole) {
      query = query.or(
        `target_role.eq.${targetRole},sender_role.eq.${targetRole},target_role.is.null`
      );
    }

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, items: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertCanAccessCommunication(request);
    const supabase = buildSupabaseAdminClient();

    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string;
      text?: string;
      targetRole?: string;
    };

    const orderId = String(body.orderId ?? "").trim();
    const text = String(body.text ?? "").trim();
    const targetRole = normalizeChatRole(body.targetRole);

    if (!orderId) return json({ ok: false, error: "orderId required" }, 400);
    if (!text) return json({ ok: false, error: "text required" }, 400);
    if (!targetRole || targetRole === "admin") {
      return json({ ok: false, error: "valid targetRole required" }, 400);
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr) return json({ ok: false, error: orderErr.message }, 500);
    if (!order) return json({ ok: false, error: "Order not found" }, 404);

    const insertPayload = {
      order_id: orderId,
      user_id: session.userId,
      text,
      sender_role: "admin" as const,
      target_role: targetRole,
    };

    const { data: created, error: insertErr } = await supabase
      .from("order_messages")
      .insert(insertPayload)
      .select(ORDER_MESSAGE_SELECT)
      .single();

    if (insertErr) return json({ ok: false, error: insertErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "admin_chat_message_sent",
      targetType: "order_message",
      targetId: String(created.id),
      newValues: created as Record<string, unknown>,
      metadata: {
        order_id: orderId,
        target_role: targetRole,
        text_preview: text.slice(0, 200),
      },
      request,
    });

    return json({ ok: true, item: created });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
