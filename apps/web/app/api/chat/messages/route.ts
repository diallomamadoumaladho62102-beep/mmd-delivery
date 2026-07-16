import { NextRequest, NextResponse } from "next/server";

import { getRequestClientIp } from "@/lib/apiRateLimit";
import {
  afterOrderChatMessageSent,
  markOrderMessageDelivered,
  markOrderMessagesRead,
  sendOrderChatMessageViaRpc,
} from "@/lib/chatMessageService";
import { adjustUserPushBadge } from "@/lib/pushBadgeService";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim() || null;
}

function getUserSupabase(token: string) {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing Supabase public env");
  }

  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    const orderId = String(body?.orderId ?? body?.order_id ?? "").trim();
    const text = String(body?.text ?? "").trim();
    const imagePath = String(body?.imagePath ?? body?.image_path ?? "").trim();
    const senderRole = String(body?.senderRole ?? body?.sender_role ?? "").trim();
    const targetRole = String(body?.targetRole ?? body?.target_role ?? "").trim();
    const targetUserId = String(
      body?.targetUserId ?? body?.target_user_id ?? "",
    ).trim();

    if (!orderId) return json({ ok: false, error: "Missing orderId" }, 400);

    const admin = buildSupabaseAdminClient();
    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);

    if (userError || !user?.id) {
      return json({ ok: false, error: "Invalid user token" }, 401);
    }

    const userClient = getUserSupabase(token);
    const sendResult = await sendOrderChatMessageViaRpc(
      userClient,
      {
        orderId,
        text,
        imagePath: imagePath || null,
        senderRole: senderRole || null,
        targetRole: targetRole || null,
        targetUserId: targetUserId || null,
      },
      `${getRequestClientIp(req.headers)}:${user.id}`,
    );

    if (!sendResult.ok) {
      const status =
        sendResult.error === "rate_limited"
          ? 429
          : sendResult.error === "forbidden"
            ? 403
            : 400;
      return json({ ok: false, error: sendResult.error ?? "send_failed" }, status);
    }

    await afterOrderChatMessageSent({
      supabaseAdmin: admin,
      orderId,
      senderUserId: user.id,
      targetUserId: targetUserId || null,
      targetRole: targetRole || null,
      preview: text || (imagePath ? "Photo" : null),
    });

    return json({ ok: true, message: sendResult.message ?? null });
  } catch (error) {
    console.error("[chat/messages] POST failed", error);
    return json({ ok: false, error: "Internal server error" }, 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    const action = String(body?.action ?? "").trim().toLowerCase();
    const orderId = String(body?.orderId ?? body?.order_id ?? "").trim();
    const messageId = String(body?.messageId ?? body?.message_id ?? "").trim();
    const targetRole = String(body?.targetRole ?? body?.target_role ?? "").trim();

    const admin = buildSupabaseAdminClient();
    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);

    if (userError || !user?.id) {
      return json({ ok: false, error: "Invalid user token" }, 401);
    }

    const userClient = getUserSupabase(token);

    if (action === "delivered") {
      if (!messageId) return json({ ok: false, error: "Missing messageId" }, 400);
      const result = await markOrderMessageDelivered(userClient, messageId);
      return json({ ok: result.ok, error: result.error ?? null });
    }

    if (action === "read") {
      if (!orderId) return json({ ok: false, error: "Missing orderId" }, 400);
      const result = await markOrderMessagesRead(
        userClient,
        orderId,
        targetRole || null,
      );

      if (result.ok) {
        const marked = Number(result.marked ?? 0);
        if (marked > 0) {
          await adjustUserPushBadge(admin, user.id, -marked);
        }
      }

      const badgeCount = await admin.rpc("get_user_push_badge_count", {
        p_user_id: user.id,
      });

      return json({
        ok: result.ok,
        marked: result.marked ?? 0,
        badgeCount: Number(badgeCount.data ?? 0),
        error: result.error ?? null,
      });
    }

    return json({ ok: false, error: "Invalid action" }, 400);
  } catch (error) {
    console.error("[chat/messages] PATCH failed", error);
    return json({ ok: false, error: "Internal server error" }, 500);
  }
}
