import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { isFounderOrSuperAdmin, sanitizeTaskText } from "@/lib/adminTasksAccess";
import {
  createTwilioVideoRoom,
  getStaffCallProviderPlan,
} from "@/lib/staffCallsProvider";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const plan = getStaffCallProviderPlan();
    const supabase = buildSupabaseAdminClient();

    let q = supabase
      .from("staff_call_sessions")
      .select("*, staff_call_participants(admin_id, role, joined_at, left_at)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (!isFounderOrSuperAdmin(session)) {
      // Non-founder: only calls they created or joined — filter in JS after join
    }
    const { data, error } = await q;
    if (error) {
      return json(
        {
          ok: false,
          error: error.message,
          pending_migration: error.message.includes("staff_call"),
          capability: plan.capability,
          mode: plan.mode,
        },
        error.message.includes("staff_call") ? 503 : 500
      );
    }

    const items = (data ?? []).filter((call) => {
      if (isFounderOrSuperAdmin(session)) return true;
      if (call.created_by === session.userId) return true;
      const parts = (call.staff_call_participants ?? []) as { admin_id: string }[];
      return parts.some((p) => p.admin_id === session.userId);
    });

    return json({
      ok: true,
      items,
      capability: plan.capability,
      mode: plan.mode,
      canCreateLiveRoom: plan.canCreateLiveRoom,
    });
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
    const session = await assertStaffPermission("hub.access", request);
    const plan = getStaffCallProviderPlan();
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as {
      kind?: string;
      title?: string;
      participant_ids?: string[];
      scheduled_at?: string | null;
      start_now?: boolean;
    };

    const kind = ["audio", "video", "screen", "meeting"].includes(
      String(body.kind)
    )
      ? String(body.kind)
      : "audio";
    const startNow = body.start_now === true;
    const participantIds = Array.from(
      new Set(
        [session.userId, ...(Array.isArray(body.participant_ids) ? body.participant_ids : [])]
          .map(String)
          .filter(Boolean)
      )
    ).slice(0, 25);

    if (plan.mode === "disabled") {
      return json(
        {
          ok: false,
          error: plan.capability.reason ?? "Call provider disabled",
          capability: plan.capability,
          mode: plan.mode,
        },
        503
      );
    }

    if (startNow && !plan.canCreateLiveRoom) {
      return json(
        {
          ok: false,
          error:
            "Live rooms require TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET. Schedule a meeting instead.",
          capability: plan.capability,
          mode: plan.mode,
        },
        503
      );
    }

    let provider = "none";
    let providerRoomSid: string | null = null;
    let providerRoomName: string | null = null;
    let status = body.scheduled_at && !startNow ? "scheduled" : "ringing";

    if (startNow) {
      providerRoomName = `mmd-staff-${session.userId.slice(0, 8)}-${Date.now()}`;
      const room = await createTwilioVideoRoom(providerRoomName);
      if (!room.ok) {
        return json(
          {
            ok: false,
            error: room.error ?? "Failed to create Twilio room",
            capability: plan.capability,
            mode: plan.mode,
          },
          502
        );
      }
      provider = "twilio_video";
      providerRoomSid = room.sid ?? null;
      status = "active";
    }

    const { data: call, error } = await supabase
      .from("staff_call_sessions")
      .insert({
        kind,
        status,
        provider,
        provider_room_sid: providerRoomSid,
        provider_room_name: providerRoomName,
        title: sanitizeTaskText(body.title, 160) || `${kind} call`,
        scheduled_at: body.scheduled_at || null,
        started_at: startNow ? new Date().toISOString() : null,
        created_by: session.userId,
        metadata: { mode: plan.mode },
      })
      .select("*")
      .single();
    if (error) {
      return json(
        {
          ok: false,
          error: error.message,
          pending_migration: error.message.includes("staff_call"),
        },
        error.message.includes("staff_call") ? 503 : 500
      );
    }

    const { error: pErr } = await supabase.from("staff_call_participants").insert(
      participantIds.map((admin_id) => ({
        call_id: call.id,
        admin_id,
        role: admin_id === session.userId ? "host" : "participant",
        joined_at: startNow && admin_id === session.userId
          ? new Date().toISOString()
          : null,
      }))
    );
    if (pErr) return json({ ok: false, error: pErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "staff_call_created",
      targetType: "staff_call_session",
      targetId: String(call.id),
      metadata: { kind, status, provider, startNow },
      request,
    }).catch(() => undefined);

    return json({
      ok: true,
      item: call,
      capability: plan.capability,
      mode: plan.mode,
      live: startNow,
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
