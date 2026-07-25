import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { isFounderOrSuperAdmin } from "@/lib/adminTasksAccess";
import { sanitizeTaskText } from "@/lib/adminTasksAccess";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const supabase = buildSupabaseAdminClient();

    let memberQ = supabase
      .from("staff_conversation_members")
      .select("conversation_id, last_read_at, typing_at");
    if (!isFounderOrSuperAdmin(session)) {
      memberQ = memberQ.eq("admin_id", session.userId);
    }
    const { data: memberships, error: mErr } = await memberQ.limit(500);
    if (mErr) {
      return json(
        {
          ok: false,
          error: mErr.message,
          pending_migration: mErr.message.includes("staff_conversation"),
        },
        mErr.message.includes("staff_conversation") ? 503 : 500
      );
    }

    const ids = Array.from(
      new Set((memberships ?? []).map((m) => String(m.conversation_id)))
    );
    if (!ids.length) return json({ ok: true, items: [] });

    const { data: conversations, error } = await supabase
      .from("staff_conversations")
      .select("*")
      .in("id", ids)
      .order("updated_at", { ascending: false });
    if (error) return json({ ok: false, error: error.message }, 500);

    const { data: members } = await supabase
      .from("staff_conversation_members")
      .select("conversation_id, admin_id, role")
      .in("conversation_id", ids);

    const items = (conversations ?? []).map((c) => ({
      ...c,
      members: (members ?? []).filter((m) => m.conversation_id === c.id),
    }));

    return json({ ok: true, items });
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
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as {
      kind?: string;
      title?: string;
      member_ids?: string[];
    };

    const kind =
      body.kind === "group" || body.kind === "announcement"
        ? body.kind
        : "direct";
    const memberIds = Array.from(
      new Set(
        [session.userId, ...(Array.isArray(body.member_ids) ? body.member_ids : [])]
          .map(String)
          .filter(Boolean)
      )
    ).slice(0, 50);

    if (kind === "direct" && memberIds.length !== 2) {
      return json(
        { ok: false, error: "direct conversation requires exactly one other member" },
        400
      );
    }
    if (kind === "announcement" && !isFounderOrSuperAdmin(session)) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    const { data: conversation, error } = await supabase
      .from("staff_conversations")
      .insert({
        kind,
        title: sanitizeTaskText(body.title, 120) || null,
        created_by: session.userId,
      })
      .select("*")
      .single();
    if (error) {
      return json(
        {
          ok: false,
          error: error.message,
          pending_migration: error.message.includes("staff_conversation"),
        },
        error.message.includes("staff_conversation") ? 503 : 500
      );
    }

    const { error: memErr } = await supabase
      .from("staff_conversation_members")
      .insert(
        memberIds.map((admin_id) => ({
          conversation_id: conversation.id,
          admin_id,
          role: admin_id === session.userId ? "owner" : "member",
        }))
      );
    if (memErr) return json({ ok: false, error: memErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "staff_conversation_created",
      targetType: "staff_conversation",
      targetId: String(conversation.id),
      metadata: { kind, memberIds },
      request,
    }).catch(() => undefined);

    return json({ ok: true, item: { ...conversation, members: memberIds } });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
