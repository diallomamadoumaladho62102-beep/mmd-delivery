import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { isFounderOrSuperAdmin } from "@/lib/adminTasksAccess";
import { completeTwilioVideoRoom } from "@/lib/staffCallsProvider";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

type RouteCtx = { params: Promise<{ id: string }> };

/** Leave / end call + reconnect / permission audit. Completes Twilio room on end. */
export async function POST(request: NextRequest, ctx: RouteCtx) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const { id: callId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?:
        | "leave"
        | "end"
        | "reconnect_failed"
        | "permission_denied"
        | "token_refreshed";
      detail?: string;
    };
    const action = body.action ?? "leave";
    const supabase = buildSupabaseAdminClient();

    const { data: call } = await supabase
      .from("staff_call_sessions")
      .select(
        "id, created_by, status, provider_room_sid, staff_call_participants(admin_id)"
      )
      .eq("id", callId)
      .maybeSingle();
    if (!call) return json({ ok: false, error: "Call not found" }, 404);

    const parts = (call.staff_call_participants ?? []) as { admin_id: string }[];
    const allowed =
      isFounderOrSuperAdmin(session) ||
      call.created_by === session.userId ||
      parts.some((p) => p.admin_id === session.userId);
    if (!allowed) return json({ ok: false, error: "Forbidden" }, 403);

    if (
      action === "leave" ||
      action === "reconnect_failed" ||
      action === "permission_denied"
    ) {
      await supabase
        .from("staff_call_participants")
        .update({ left_at: new Date().toISOString() })
        .eq("call_id", callId)
        .eq("admin_id", session.userId);
    }

    let roomCompleted: boolean | null = null;
    if (
      action === "end" &&
      (call.created_by === session.userId || isFounderOrSuperAdmin(session))
    ) {
      await supabase
        .from("staff_call_sessions")
        .update({
          status: "ended",
          ended_at: new Date().toISOString(),
        })
        .eq("id", callId);

      const roomSid = String(call.provider_room_sid ?? "").trim();
      if (roomSid) {
        const done = await completeTwilioVideoRoom(roomSid);
        roomCompleted = done.ok;
        if (!done.ok) {
          // Fail-closed for Twilio complete: still end DB session, surface warning via audit
          await writeAdminAuditServer({
            supabaseAdmin: supabase,
            adminUserId: session.userId,
            action: "staff_call_room_complete_failed",
            targetType: "staff_call_session",
            targetId: callId,
            metadata: { error: done.error?.slice(0, 200) },
            request,
          }).catch(() => undefined);
        }
      }
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: `staff_call_${action}`,
      targetType: "staff_call_session",
      targetId: callId,
      metadata: {
        detail: String(body.detail ?? "").slice(0, 200) || undefined,
        roomCompleted,
      },
      request,
    }).catch(() => undefined);

    return json({ ok: true, action, roomCompleted });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
