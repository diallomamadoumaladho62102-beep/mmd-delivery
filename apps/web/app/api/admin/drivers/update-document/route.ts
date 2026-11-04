import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanReviewDrivers } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { notifyDriverComplementaryDocuments } from "@/lib/driverReviewNotifications";
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
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "pending" ||
    normalized === "approved" ||
    normalized === "rejected" ||
    normalized === "incomplete"
  );
}

function normalizeDocumentStatus(value: unknown): DocumentStatus | null {
  if (!isDocumentStatus(value)) return null;
  return value.trim().toLowerCase() as DocumentStatus;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function isComplementaryRequest(status: DocumentStatus): boolean {
  return status === "incomplete" || status === "rejected";
}

export async function POST(request: NextRequest) {
  try {
    const admin = await assertCanReviewDrivers(request);
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

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: admin.userId,
        action: "driver_document_deleted",
        targetType: "driver",
        targetId: userId,
        oldValues: existing as Record<string, unknown>,
        newValues: { deleted: true },
        metadata: { document_id: documentId, review_notes: reviewNotes },
        request,
      });

      return NextResponse.json({
        ok: true,
        userId,
        documentId,
        deleted: true,
        message: "Driver document deleted successfully.",
      });
    }

    const status = normalizeDocumentStatus(body?.status);
    if (!status) {
      return badRequest("status must be pending, approved, rejected or incomplete.");
    }

    if (isComplementaryRequest(status) && !reviewNotes) {
      return badRequest(
        "reviewNotes is required when requesting complementary or rejected documents.",
      );
    }

    const patch = {
      status,
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

    let profileMarkedIncomplete = false;
    if (isComplementaryRequest(status)) {
      const { data: driverRow } = await supabase
        .from("driver_profiles")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle();
      const currentStatus = String(
        (driverRow as { status?: string | null } | null)?.status ?? "",
      ).toLowerCase();
      if (currentStatus === "pending" || currentStatus === "incomplete") {
        const { error: profileError } = await supabase
          .from("driver_profiles")
          .update({
            status: "incomplete",
            documents_required: true,
            driver_decision_note: reviewNotes,
            updated_at: now,
          })
          .eq("user_id", userId)
          .in("status", ["pending", "incomplete"]);
        profileMarkedIncomplete = !profileError;
      }
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: admin.userId,
      action: isComplementaryRequest(status)
        ? "driver_documents_requested"
        : "driver_document_updated",
      targetType: "driver",
      targetId: userId,
      oldValues: existing as Record<string, unknown>,
      newValues: {
        ...(data as Record<string, unknown>),
        profile_marked_incomplete: profileMarkedIncomplete,
      },
      metadata: {
        document_id: documentId,
        doc_type: (data as { doc_type?: string }).doc_type ?? null,
        review_notes: reviewNotes,
      },
      request,
    });

    let notified = false;
    if (isComplementaryRequest(status)) {
      const notice = await notifyDriverComplementaryDocuments({
        supabaseAdmin: supabase,
        userId,
        documentType: String((data as { doc_type?: string }).doc_type ?? "document"),
        note: reviewNotes,
        documentId,
        reviewedAt: now,
      });
      notified = notice.notified;
    }

    return NextResponse.json({
      ok: true,
      userId,
      documentId,
      document: data,
      profileMarkedIncomplete,
      notified,
      message: isComplementaryRequest(status)
        ? "Complementary documents requested."
        : "Driver document updated successfully.",
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