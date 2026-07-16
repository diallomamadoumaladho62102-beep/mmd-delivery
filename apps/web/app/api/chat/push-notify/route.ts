import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, getRequestClientIp } from "@/lib/apiRateLimit";
import { notifyOrderChatMessage, type ChatPushRole } from "@/lib/chatPushNotifications";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_PUSH_ROLES: ChatPushRole[] = [
  "client",
  "driver",
  "restaurant",
  "seller",
];

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

function isChatPushRole(value: unknown): value is ChatPushRole {
  return (
    typeof value === "string" &&
    CHAT_PUSH_ROLES.includes(value as ChatPushRole)
  );
}

export async function POST(req: NextRequest) {
  try {
    const ip = getRequestClientIp(req.headers);
    const rate = checkRateLimit({
      namespace: "chat-push-notify",
      key: ip,
      limit: 30,
      windowMs: 60_000,
    });

    if (rate.limited) {
      return NextResponse.json(
        { ok: false, error: "Too many requests" },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfterSec) },
        },
      );
    }

    const token = getBearerToken(req);
    if (!token) return jsonError("Unauthorized", 401);

    const admin = buildSupabaseAdminClient();
    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);

    if (userError || !user?.id) return jsonError("Invalid user token", 401);

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    const orderId = String(body?.orderId ?? body?.order_id ?? "").trim();
    const targetUserId = String(
      body?.targetUserId ?? body?.target_user_id ?? "",
    ).trim();
    const targetRole = body?.targetRole ?? body?.target_role;
    const preview = String(body?.preview ?? body?.message ?? "").trim();

    if (!orderId || !targetUserId || !isChatPushRole(targetRole)) {
      return jsonError("Missing or invalid fields", 400);
    }

    const { data: allowed, error: participantError } = await admin.rpc(
      "is_order_message_participant",
      { p_resource_id: orderId, p_user_id: user.id },
    );

    if (participantError) {
      console.error("[chat/push-notify] participant check failed", participantError);
      return jsonError("Access check failed", 503);
    }

    if (!allowed) return jsonError("Forbidden", 403);

    const result = await notifyOrderChatMessage({
      supabaseAdmin: admin,
      orderId,
      senderUserId: user.id,
      targetUserId,
      targetRole,
      preview,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[chat/push-notify] unhandled", error);
    return jsonError("Internal server error", 500);
  }
}
