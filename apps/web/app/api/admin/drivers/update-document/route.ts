import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertAdminAccess } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DocumentStatus = "pending" | "approved" | "rejected" | "incomplete";

type Body = {
  documentId?: unknown;
  userId?: unknown;
  status?: unknown;
  reviewNotes?: unknown;
  deleteDocument?: unknown;
};

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function isDocumentStatus(value: unknown): value is DocumentStatus {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "incomplete"
  );
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

export async function POST(request: NextRequest) {
  try {
    const admin = await assertAdminAccess(request);
    const body = (await request.json().catch(() => null)) as Body | null;

    const documentId =
      typeof body?.documentId === "string" ? body.documentId.trim() : "";
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    const deleteDocument = body?.deleteDocument === true;
    const reviewNotes = normalizeText(body?.reviewNotes);

    if (!documentId) return badRequest("documentId is required.");
    if (!userId) return badRequest("userId is required.");

    const supabase = buildSupabaseAdminClient();
    const now = new Date().toISOString();

    const { data: existing, error: existingError } = await supabase
      .from("driver_documents")
      .select("id, user_id, doc_type, file_path, status")
      .eq("id", documentId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (!existing) return badRequest("Driver document not found.");

    if (deleteDocument) {
      const { error: deleteError } = await supabase
        .from("driver_documents")
        .delete()
        .eq("id", documentId)
        .eq("user_id", userId);

      if (deleteError) throw new Error(deleteError.message);

      await supabase.from("admin_audit_logs").insert({
        admin_user_id: admin.userId,
        action: "driver_document_deleted",
        target_type: "driver",
        target_id: userId,
        metadata: {
          document_id: documentId,
          document: existing,
          review_notes: reviewNotes,
        },
        created_at: now,
      });

      return NextResponse.json({
        ok: true,
        userId,
        documentId,
        deleted: true,
        message: "Driver document deleted successfully.",
      });
    }

    if (!isDocumentStatus(body?.status)) {
      return badRequest("status must be pending, approved, rejected or incomplete.");
    }

    const patch = {
      status: body.status,
      reviewed_at: now,
      reviewed_by: admin.userId,
      review_notes: reviewNotes,
    };

    const { data, error } = await supabase
      .from("driver_documents")
      .update(patch)
      .eq("id", documentId)
      .eq("user_id", userId)
      .select("id, user_id, doc_type, status, reviewed_at, reviewed_by, review_notes")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return badRequest("Driver document not found after update.");

    await supabase.from("admin_audit_logs").insert({
      admin_user_id: admin.userId,
      action: "driver_document_updated",
      target_type: "driver",
      target_id: userId,
      metadata: {
        document_id: documentId,
        before: existing,
        after: data,
      },
      created_at: now,
    });

    return NextResponse.json({
      ok: true,
      userId,
      documentId,
      document: data,
      message: "Driver document updated successfully.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown driver document update error";

    return NextResponse.json(
      { ok: false, error: message },
      { status: error instanceof AdminAccessError ? error.status : 500 },
    );
  }
}