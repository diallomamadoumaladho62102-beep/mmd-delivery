import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { isFounderOrSuperAdmin, sanitizeTaskText } from "@/lib/adminTasksAccess";
import {
  STAFF_ATTACHMENTS_BUCKET,
  STAFF_SIGNED_URL_TTL_SECONDS,
  buildStaffAttachmentPath,
  messageTypeForKind,
  validateStaffAttachmentBuffer,
  validateStaffAttachmentMeta,
} from "@/lib/staffAttachmentSecurity";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

/** Upload attachment to private bucket + create message row. */
export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const form = await request.formData();
    const conversationId = String(form.get("conversation_id") ?? "").trim();
    const caption = sanitizeTaskText(String(form.get("caption") ?? ""), 2000);
    const file = form.get("file");

    if (!conversationId) {
      return json({ ok: false, error: "conversation_id required" }, 400);
    }
    if (!(file instanceof File)) {
      return json({ ok: false, error: "file required" }, 400);
    }

    const meta = validateStaffAttachmentMeta({
      mime: file.type,
      size: file.size,
      fileName: file.name,
    });
    if (meta.ok === false) return json({ ok: false, error: meta.error }, 400);

    const buffer = Buffer.from(await file.arrayBuffer());
    const content = await validateStaffAttachmentBuffer({
      buffer,
      mime: meta.mime,
      kind: meta.kind,
    });
    if (content.ok === false) {
      return json({ ok: false, error: content.error }, 400);
    }

    const supabase = buildSupabaseAdminClient();
    const allowed = await assertMember(supabase, session, conversationId);
    if (!allowed) return json({ ok: false, error: "Forbidden" }, 403);

    const storagePath = buildStaffAttachmentPath({
      conversationId,
      uploaderId: session.userId,
      safeName: meta.safeName,
    });

    const { error: upErr } = await supabase.storage
      .from(STAFF_ATTACHMENTS_BUCKET)
      .upload(storagePath, buffer, {
        contentType: content.mime,
        upsert: false,
        cacheControl: "private, max-age=0",
      });
    if (upErr) {
      return json(
        {
          ok: false,
          error: upErr.message.includes("Bucket")
            ? "staff-attachments bucket unavailable"
            : "Upload failed",
        },
        502
      );
    }

    const messageType = messageTypeForKind(meta.kind);
    const { data: message, error: msgErr } = await supabase
      .from("staff_messages")
      .insert({
        conversation_id: conversationId,
        sender_id: session.userId,
        body: caption || null,
        message_type: messageType,
        attachment_path: storagePath,
        attachment_mime: content.mime,
        attachment_bytes: buffer.length,
      })
      .select("*")
      .single();
    if (msgErr) {
      await supabase.storage
        .from(STAFF_ATTACHMENTS_BUCKET)
        .remove([storagePath])
        .catch(() => undefined);
      return json({ ok: false, error: msgErr.message }, 500);
    }

    await supabase
      .from("staff_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    const { data: signed } = await supabase.storage
      .from(STAFF_ATTACHMENTS_BUCKET)
      .createSignedUrl(storagePath, STAFF_SIGNED_URL_TTL_SECONDS);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "staff_attachment_uploaded",
      targetType: "staff_conversation",
      targetId: conversationId,
      metadata: {
        message_id: message.id,
        kind: meta.kind,
        bytes: buffer.length,
        mime: content.mime,
      },
      request,
    }).catch(() => undefined);

    return json({
      ok: true,
      item: message,
      signed_url: signed?.signedUrl ?? null,
      signed_url_ttl_seconds: STAFF_SIGNED_URL_TTL_SECONDS,
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

/** Mint a temporary signed URL for an existing attachment path. */
export async function GET(request: NextRequest) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const conversationId = String(
      request.nextUrl.searchParams.get("conversation_id") ?? ""
    ).trim();
    const path = String(request.nextUrl.searchParams.get("path") ?? "").trim();
    if (!conversationId || !path) {
      return json({ ok: false, error: "conversation_id and path required" }, 400);
    }
    if (path.includes("..") || path.startsWith("/") || path.includes("\\")) {
      return json({ ok: false, error: "Invalid path" }, 400);
    }
    if (!path.startsWith(`${conversationId}/`)) {
      return json({ ok: false, error: "Path does not match conversation" }, 403);
    }

    const supabase = buildSupabaseAdminClient();
    const allowed = await assertMember(supabase, session, conversationId);
    if (!allowed) return json({ ok: false, error: "Forbidden" }, 403);

    const { data: msg } = await supabase
      .from("staff_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("attachment_path", path)
      .is("deleted_at", null)
      .maybeSingle();
    if (!msg) return json({ ok: false, error: "Attachment not found" }, 404);

    const { data: signed, error } = await supabase.storage
      .from(STAFF_ATTACHMENTS_BUCKET)
      .createSignedUrl(path, STAFF_SIGNED_URL_TTL_SECONDS);
    if (error || !signed?.signedUrl) {
      return json({ ok: false, error: "Could not sign URL" }, 502);
    }

    return json({
      ok: true,
      signed_url: signed.signedUrl,
      ttl_seconds: STAFF_SIGNED_URL_TTL_SECONDS,
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
