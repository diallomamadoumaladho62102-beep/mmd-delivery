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

const REACTION_ALLOWLIST = ["👍", "❤️", "😂", "👀", "✅", "🔥"] as const;

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
      .select(
        "*, staff_message_reactions(emoji, admin_id, created_at), staff_message_receipts(admin_id, delivered_at, read_at)"
      )
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) {
      // Fallback if reactions migration not applied yet
      const fallback = await supabase
        .from("staff_messages")
        .select("*, staff_message_receipts(admin_id, delivered_at, read_at)")
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (fallback.error) {
        return json({ ok: false, error: fallback.error.message }, 500);
      }
      await supabase
        .from("staff_conversation_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("admin_id", session.userId);
      return json({
        ok: true,
        items: fallback.data ?? [],
        reactions_pending_migration: true,
      });
    }

    const ids = (data ?? []).map((m) => String(m.id));
    if (ids.length) {
      await supabase.from("staff_message_receipts").upsert(
        ids.map((message_id) => ({
          message_id,
          admin_id: session.userId,
          read_at: new Date().toISOString(),
          delivered_at: new Date().toISOString(),
        })),
        { onConflict: "message_id,admin_id" }
      );
    }

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
      reply_to_message_id?: string;
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

    let replyTo: string | null = null;
    if (body.reply_to_message_id) {
      const replyId = String(body.reply_to_message_id).trim();
      const { data: parent } = await supabase
        .from("staff_messages")
        .select("id")
        .eq("id", replyId)
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!parent) {
        return json({ ok: false, error: "reply target not found" }, 400);
      }
      replyTo = replyId;
    }

    const insertRow: Record<string, unknown> = {
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
    };
    if (replyTo) insertRow.reply_to_message_id = replyTo;

    const { data: message, error } = await supabase
      .from("staff_messages")
      .insert(insertRow)
      .select("*")
      .single();
    if (error) {
      if (replyTo && error.message.includes("reply_to_message_id")) {
        delete insertRow.reply_to_message_id;
        const retry = await supabase
          .from("staff_messages")
          .insert(insertRow)
          .select("*")
          .single();
        if (retry.error) return json({ ok: false, error: retry.error.message }, 500);
        return json({
          ok: true,
          item: retry.data,
          reply_pending_migration: true,
        });
      }
      return json({ ok: false, error: error.message }, 500);
    }

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
      metadata: {
        message_id: message.id,
        message_type: messageType,
        reply_to: replyTo,
      },
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
      message_id?: string;
      body?: string;
      soft_delete?: boolean;
      reaction?: { emoji?: string; op?: "add" | "remove" };
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

    const messageId = String(body.message_id ?? "").trim();
    if (messageId && body.soft_delete === true) {
      const { data: msg } = await supabase
        .from("staff_messages")
        .select("id, sender_id")
        .eq("id", messageId)
        .eq("conversation_id", conversationId)
        .maybeSingle();
      if (!msg) return json({ ok: false, error: "Message not found" }, 404);
      if (
        msg.sender_id !== session.userId &&
        !isFounderOrSuperAdmin(session)
      ) {
        return json({ ok: false, error: "Forbidden" }, 403);
      }
      const { error } = await supabase
        .from("staff_messages")
        .update({
          deleted_at: new Date().toISOString(),
          body: null,
        })
        .eq("id", messageId);
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "staff_message_deleted",
        targetType: "staff_message",
        targetId: messageId,
        metadata: { conversation_id: conversationId },
        request,
      }).catch(() => undefined);
      return json({ ok: true, deleted: true });
    }

    if (messageId && typeof body.body === "string" && !body.reaction) {
      const text = sanitizeTaskText(body.body, 8000);
      if (!text) return json({ ok: false, error: "body required" }, 400);
      const { data: msg } = await supabase
        .from("staff_messages")
        .select("id, sender_id, message_type")
        .eq("id", messageId)
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!msg) return json({ ok: false, error: "Message not found" }, 404);
      if (msg.sender_id !== session.userId) {
        return json({ ok: false, error: "Only sender can edit" }, 403);
      }
      if (msg.message_type !== "text") {
        return json({ ok: false, error: "Only text messages can be edited" }, 400);
      }
      const { data: updated, error } = await supabase
        .from("staff_messages")
        .update({ body: text, edited_at: new Date().toISOString() })
        .eq("id", messageId)
        .select("*")
        .single();
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "staff_message_edited",
        targetType: "staff_message",
        targetId: messageId,
        metadata: { conversation_id: conversationId },
        request,
      }).catch(() => undefined);
      return json({ ok: true, item: updated });
    }

    if (messageId && body.reaction?.emoji) {
      const emoji = String(body.reaction.emoji).trim().slice(0, 16);
      if (
        !REACTION_ALLOWLIST.includes(
          emoji as (typeof REACTION_ALLOWLIST)[number]
        )
      ) {
        return json({ ok: false, error: "Unsupported reaction" }, 400);
      }
      const { data: msg } = await supabase
        .from("staff_messages")
        .select("id")
        .eq("id", messageId)
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!msg) return json({ ok: false, error: "Message not found" }, 404);

      const op = body.reaction.op === "remove" ? "remove" : "add";
      if (op === "remove") {
        const { error } = await supabase
          .from("staff_message_reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("admin_id", session.userId)
          .eq("emoji", emoji);
        if (error) {
          return json(
            {
              ok: false,
              error: error.message,
              pending_migration: error.message.includes("staff_message_reactions"),
            },
            error.message.includes("staff_message_reactions") ? 503 : 500
          );
        }
      } else {
        const { error } = await supabase.from("staff_message_reactions").upsert(
          {
            message_id: messageId,
            admin_id: session.userId,
            emoji,
          },
          { onConflict: "message_id,admin_id,emoji" }
        );
        if (error) {
          return json(
            {
              ok: false,
              error: error.message,
              pending_migration: error.message.includes("staff_message_reactions"),
            },
            error.message.includes("staff_message_reactions") ? 503 : 500
          );
        }
      }
      return json({ ok: true, reaction: { emoji, op } });
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
