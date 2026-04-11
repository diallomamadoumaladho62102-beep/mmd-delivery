import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertAdminAccess } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RestaurantReviewStatus = "approved" | "rejected";

type RestaurantReviewBody = {
  userId?: unknown;
  status?: unknown;
  reviewNotes?: unknown;
};

type RestaurantDocumentUpdate = {
  status: RestaurantReviewStatus;
  reviewed_at: string;
  reviewed_by: string;
  review_notes: string | null;
};

function isRestaurantReviewStatus(
  value: unknown
): value is RestaurantReviewStatus {
  return value === "approved" || value === "rejected";
}

async function parseBody(
  request: NextRequest
): Promise<RestaurantReviewBody> {
  try {
    const body = (await request.json()) as RestaurantReviewBody | null;

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

function buildRestaurantDocumentUpdate(params: {
  status: RestaurantReviewStatus;
  reviewedAt: string;
  reviewedBy: string;
  reviewNotes: string;
}): RestaurantDocumentUpdate {
  const { status, reviewedAt, reviewedBy, reviewNotes } = params;

  return {
    status,
    reviewed_at: reviewedAt,
    reviewed_by: reviewedBy,
    review_notes: reviewNotes.length > 0 ? reviewNotes : null,
  };
}

async function ensureRestaurantDocumentsExist(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  userId: string;
}): Promise<void> {
  const { supabase, userId } = params;

  const { data, error } = await supabase
    .from("restaurant_documents")
    .select("id")
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    throw new Error(`Failed to verify restaurant documents: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error("No restaurant documents found for this user.");
  }
}

async function updateRestaurantDocuments(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  userId: string;
  payload: RestaurantDocumentUpdate;
}): Promise<void> {
  const { supabase, userId, payload } = params;

  const { data, error } = await supabase
    .from("restaurant_documents")
    .update(payload)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    throw new Error(`Failed to update restaurant documents: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error("Restaurant review update did not affect any documents.");
  }
}

async function writeRestaurantAuditLog(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  adminUserId: string;
  targetUserId: string;
  status: RestaurantReviewStatus;
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
    action:
      status === "approved"
        ? "restaurant_approved"
        : "restaurant_rejected",
    target_type: "restaurant",
    target_id: targetUserId,
    metadata: {
      status,
      reviewed_at: reviewedAt,
      review_notes: reviewNotes.length > 0 ? reviewNotes : null,
    },
    created_at: reviewedAt,
  });

  if (error) {
    throw new Error(`Failed to write restaurant audit log: ${error.message}`);
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

    if (!isRestaurantReviewStatus(status)) {
      return badRequest("status must be 'approved' or 'rejected'.");
    }

    const supabase = buildSupabaseAdminClient();
    const reviewedAt = new Date().toISOString();

    try {
      await ensureRestaurantDocumentsExist({
        supabase,
        userId,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Restaurant documents not found";

      if (message === "No restaurant documents found for this user.") {
        return notFound(message);
      }

      throw error;
    }

    const updatePayload = buildRestaurantDocumentUpdate({
      status,
      reviewedAt,
      reviewedBy: actor,
      reviewNotes,
    });

    await updateRestaurantDocuments({
      supabase,
      userId,
      payload: updatePayload,
    });

    await writeRestaurantAuditLog({
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
            ? "Restaurant approved successfully."
            : "Restaurant rejected successfully.",
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown restaurant review error";

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
