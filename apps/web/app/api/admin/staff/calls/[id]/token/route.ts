import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { isFounderOrSuperAdmin } from "@/lib/adminTasksAccess";
import {
  buildStaffVideoIdentity,
  mintStaffVideoAccessToken,
} from "@/lib/staffTwilioAccessToken";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * Mint a short-lived Twilio Video Access Token for a participant.
 * Fail-closed when API keys are missing. Never returns API key secrets.
 */
export async function POST(request: NextRequest, ctx: RouteCtx) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const { id: callId } = await ctx.params;
    if (!callId) return json({ ok: false, error: "call id required" }, 400);

    const supabase = buildSupabaseAdminClient();
    const { data: call, error } = await supabase
      .from("staff_call_sessions")
      .select("*, staff_call_participants(admin_id, role, left_at)")
      .eq("id", callId)
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!call) return json({ ok: false, error: "Call not found" }, 404);

    const participants = (call.staff_call_participants ?? []) as {
      admin_id: string;
      role: string;
      left_at: string | null;
    }[];
    const isParticipant =
      call.created_by === session.userId ||
      participants.some((p) => p.admin_id === session.userId);
    if (!isParticipant && !isFounderOrSuperAdmin(session)) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    if (call.status === "ended" || call.status === "cancelled") {
      return json({ ok: false, error: "Call already ended" }, 409);
    }

    const roomName = String(call.provider_room_name ?? "").trim();
    if (!roomName || call.provider !== "twilio_video") {
      return json(
        { ok: false, error: "Call has no live Twilio Video room" },
        503
      );
    }

    const identity = buildStaffVideoIdentity(session.userId);
    const minted = mintStaffVideoAccessToken({ identity, roomName });
    if (minted.ok === false) {
      return json({ ok: false, error: minted.error }, minted.status);
    }

    await supabase.from("staff_call_participants").upsert(
      {
        call_id: callId,
        admin_id: session.userId,
        role:
          participants.find((p) => p.admin_id === session.userId)?.role ??
          (call.created_by === session.userId ? "host" : "participant"),
        joined_at: new Date().toISOString(),
        left_at: null,
      },
      { onConflict: "call_id,admin_id" }
    );

    if (call.status === "ringing" || call.status === "scheduled") {
      await supabase
        .from("staff_call_sessions")
        .update({
          status: "active",
          started_at: call.started_at ?? new Date().toISOString(),
        })
        .eq("id", callId);
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "staff_call_token_minted",
      targetType: "staff_call_session",
      targetId: callId,
      metadata: {
        roomName,
        ttlSeconds: minted.ttlSeconds,
        expiresAt: minted.expiresAt,
        // Never log token or secrets
      },
      request,
    }).catch(() => undefined);

    return json({
      ok: true,
      token: minted.token,
      identity: minted.identity,
      roomName: minted.roomName,
      ttlSeconds: minted.ttlSeconds,
      expiresAt: minted.expiresAt,
      refreshAfterSeconds: minted.refreshAfterSeconds,
      callId,
      kind: call.kind,
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
