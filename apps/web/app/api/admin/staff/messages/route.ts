import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { isFounderOrSuperAdmin, sanitizeTaskText } from "@/lib/adminTasksAccess";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

async function assertMember(
  supabase: ReturnType<typeof buildSupabaseAdminClient>,
  session: { userId: string; isFounder: boolean; role: string | null },
  conversationId: string
) {
  if (isFounderOrSuperAdmin(session as never)) return true;
  const { data } = await supabase
    .from("staff_conversation_members")
    .select("admin_id")
    .eq("conversation_id", conversationId)
    .eq("admin_id", session.userId)
    .maybeSingle();
  return Boolean(data);
}

export async function GET(request: NextRequest) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const conversationId = String(
      request.nextUrl.searchParams.get("conversation_id") ?? ""
    ).trim();
    if (!conversationId) {
      return json({ ok: false, error: "conversation_id required" }, 400);
    }
    const supabase = buildSupabaseAdminClient();
    const allowed = await assertMember(supabase, session, conversationId);
    if (!allowed) return json({ ok: false, error: "Forbidden" }, 403);

    const limit = Math.min(
      Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 80), 1),
      200
    );
    const { data, error } = await supabase
      .from("staff_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) return json({ ok: false, error: error.message }, 500);

    await supabase
      .from("staff_conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("admin_id", session.userId);

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
    const session = await assertStaffPermission("hub.access", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as {
      conversation_id?: string;
      body?: string;
      message_type?: string;
      attachment_path?: string;
      attachment_mime?: string;
      attachment_bytes?: number;
      link_url?: string;
    };

    const conversationId = String(body.conversation_id ?? "").trim();
    if (!conversationId) {
      return json({ ok: false, error: "conversation_id required" }, 400);
    }
    const allowed = await assertMember(supabase, session, conversationId);
    if (!allowed) return json({ ok: false, error: "Forbidden" }, 403);

    const messageType = [
      "text",
      "file",
      "image",
      "video",
      "audio",
      "link",
    ].includes(String(body.message_type))
      ? String(body.message_type)
      : "text";

    const text = sanitizeTaskText(body.body, 8000);
    if (messageType === "text" && !text) {
      return json({ ok: false, error: "body required" }, 400);
    }
    if (messageType === "link" && !body.link_url) {
      return json({ ok: false, error: "link_url required" }, 400);
    }

    const { data: message, error } = await supabase
      .from("staff_messages")
      .insert({
        conversation_id: conversationId,
        sender_id: session.userId,
        body: text || null,
        message_type: messageType,
        attachment_path: body.attachment_path
          ? sanitizeTaskText(body.attachment_path, 500)
          : null,
        attachment_mime: body.attachment_mime
          ? sanitizeTaskText(body.attachment_mime, 120)
          : null,
        attachment_bytes:
          typeof body.attachment_bytes === "number"
            ? Math.min(Math.max(body.attachment_bytes, 0), 50_000_000)
            : null,
        link_url: body.link_url
          ? sanitizeTaskText(body.link_url, 1000)
          : null,
      })
      .select("*")
      .single();
    if (error) return json({ ok: false, error: error.message }, 500);

    await supabase
      .from("staff_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    const { data: members } = await supabase
      .from("staff_conversation_members")
      .select("admin_id")
      .eq("conversation_id", conversationId);
    const receipts = (members ?? [])
      .map((m) => String(m.admin_id))
      .filter((id) => id !== session.userId)
      .map((admin_id) => ({
        message_id: message.id,
        admin_id,
        delivered_at: new Date().toISOString(),
      }));
    if (receipts.length) {
      await supabase.from("staff_message_receipts").insert(receipts);
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "staff_message_sent",
      targetType: "staff_conversation",
      targetId: conversationId,
      metadata: { message_id: message.id, message_type: messageType },
      request,
    }).catch(() => undefined);

    return json({ ok: true, item: message });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as {
      conversation_id?: string;
      typing?: boolean;
      read_message_ids?: string[];
    };
    const conversationId = String(body.conversation_id ?? "").trim();
    if (!conversationId) {
      return json({ ok: false, error: "conversation_id required" }, 400);
    }
    const allowed = await assertMember(supabase, session, conversationId);
    if (!allowed) return json({ ok: false, error: "Forbidden" }, 403);

    if (body.typing != null) {
      await supabase
        .from("staff_conversation_members")
        .update({
          typing_at: body.typing ? new Date().toISOString() : null,
        })
        .eq("conversation_id", conversationId)
        .eq("admin_id", session.userId);
    }

    if (Array.isArray(body.read_message_ids) && body.read_message_ids.length) {
      const ids = body.read_message_ids.map(String).slice(0, 100);
      await supabase.from("staff_message_receipts").upsert(
        ids.map((message_id) => ({
          message_id,
          admin_id: session.userId,
          read_at: new Date().toISOString(),
          delivered_at: new Date().toISOString(),
        })),
        { onConflict: "message_id,admin_id" }
      );
      await supabase
        .from("staff_conversation_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("admin_id", session.userId);
    }

    return json({ ok: true });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
