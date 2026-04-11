import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertAdminAccess } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DriverReviewStatus = "approved" | "rejected";

type DriverReviewBody = {
  userId?: unknown;
  status?: unknown;
  reviewNotes?: unknown;
};

type DriverDocumentUpdate = {
  status: DriverReviewStatus;
  reviewed_at: string;
  reviewed_by: string;
  review_notes: string | null;
};

function isDriverReviewStatus(value: unknown): value is DriverReviewStatus {
  return value === "approved" || value === "rejected";
}

async function parseBody(request: NextRequest): Promise<DriverReviewBody> {
  try {
    const body = (await request.json()) as DriverReviewBody | null;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Request body must be a valid JSON object.");
    }

    return body;
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

function normalizeUserId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeReviewNotes(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildDriverDocumentUpdate(params: {
  status: DriverReviewStatus;
  reviewedAt: string;
  reviewedBy: string;
  reviewNotes: string;
}): DriverDocumentUpdate {
  const { status, reviewedAt, reviewedBy, reviewNotes } = params;

  return {
    status,
    reviewed_at: reviewedAt,
    reviewed_by: reviewedBy,
    review_notes: reviewNotes.length > 0 ? reviewNotes : null,
  };
}

async function ensureDriverDocumentsExist(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  userId: string;
}): Promise<void> {
  const { supabase, userId } = params;

  const { data, error } = await supabase
    .from("driver_documents")
    .select("id")
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    throw new Error(`Failed to verify driver documents: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error("No driver documents found for this user.");
  }
}

async function updateDriverDocuments(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  userId: string;
  payload: DriverDocumentUpdate;
}): Promise<void> {
  const { supabase, userId, payload } = params;

  const { data, error } = await supabase
    .from("driver_documents")
    .update(payload)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    throw new Error(`Failed to update driver documents: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error("Driver review update did not affect any documents.");
  }
}

async function writeDriverAuditLog(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  adminUserId: string;
  targetUserId: string;
  status: DriverReviewStatus;
  reviewedAt: string;
  reviewNotes: string;
}): Promise<void> {
  const {
    supabase,
    adminUserId,
    targetUserId,
    status,
    reviewedAt,
    reviewNotes,
  } = params;

  const { error } = await supabase.from("admin_audit_logs").insert({
    admin_user_id: adminUserId,
    action: status === "approved" ? "driver_approved" : "driver_rejected",
    target_type: "driver",
    target_id: targetUserId,
    metadata: {
      status,
      reviewed_at: reviewedAt,
      review_notes: reviewNotes.length > 0 ? reviewNotes : null,
    },
    created_at: reviewedAt,
  });

  if (error) {
    throw new Error(`Failed to write driver audit log: ${error.message}`);
  }
}

function badRequest(message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    { status: 400 }
  );
}

function notFound(message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    { status: 404 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const admin = await assertAdminAccess();
    const actor = admin.userId;

    const body = await parseBody(request);

    const userId = normalizeUserId(body.userId);
    const status = body.status;
    const reviewNotes = normalizeReviewNotes(body.reviewNotes);

    if (!userId) {
      return badRequest("userId is required.");
    }

    if (!isDriverReviewStatus(status)) {
      return badRequest("status must be 'approved' or 'rejected'.");
    }

    const supabase = buildSupabaseAdminClient();
    const reviewedAt = new Date().toISOString();

    try {
      await ensureDriverDocumentsExist({
        supabase,
        userId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Driver documents not found";

      if (message === "No driver documents found for this user.") {
        return notFound(message);
      }

      throw error;
    }

    const updatePayload = buildDriverDocumentUpdate({
      status,
      reviewedAt,
      reviewedBy: actor,
      reviewNotes,
    });

    await updateDriverDocuments({
      supabase,
      userId,
      payload: updatePayload,
    });

    await writeDriverAuditLog({
      supabase,
      adminUserId: actor,
      targetUserId: userId,
      status,
      reviewedAt,
      reviewNotes,
    });

    return NextResponse.json(
      {
        ok: true,
        userId,
        status,
        reviewedAt,
        reviewNotes: reviewNotes.length > 0 ? reviewNotes : null,
        message:
          status === "approved"
            ? "Driver approved successfully."
            : "Driver rejected successfully.",
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown driver review error";

    const status = error instanceof AdminAccessError ? error.status : 500;

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status }
    );
  }
}
