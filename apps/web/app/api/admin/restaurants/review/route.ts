import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanReviewRestaurants } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";
import { resolveRestaurantPlatformCountry } from "@/lib/platformCountryResolver";
import { notifyRestaurantApprovedEmail } from "@/lib/transactionalEmails";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RestaurantReviewStatus =
  | "approved"
  | "rejected"
  | "suspended"
  | "disabled";

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

type RestaurantProfileStatusUpdate = {
  status: RestaurantReviewStatus;
  updated_at: string;
};

function isRestaurantReviewStatus(
  value: unknown
): value is RestaurantReviewStatus {
  return (
    value === "approved" ||
    value === "rejected" ||
    value === "suspended" ||
    value === "disabled"
  );
}

function isDocumentReviewStatus(
  status: RestaurantReviewStatus
): status is "approved" | "rejected" {
  return status === "approved" || status === "rejected";
}

function getAuditAction(status: RestaurantReviewStatus): string {
  if (status === "approved") return "restaurant_approved";
  if (status === "rejected") return "restaurant_rejected";
  if (status === "suspended") return "restaurant_suspended";
  return "restaurant_disabled";
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
  status: "approved" | "rejected";
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

function buildRestaurantProfileStatusUpdate(params: {
  status: RestaurantReviewStatus;
  reviewedAt: string;
}): RestaurantProfileStatusUpdate {
  const { status, reviewedAt } = params;

  return {
    status,
    updated_at: reviewedAt,
  };
}

async function updateRestaurantDocuments(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  userId: string;
  payload: RestaurantDocumentUpdate;
}): Promise<void> {
  const { supabase, userId, payload } = params;

  const { error } = await supabase
    .from("restaurant_documents")
    .update(payload)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update restaurant documents: ${error.message}`);
  }
}

async function updateRestaurantProfileStatus(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  userId: string;
  status: RestaurantReviewStatus;
  reviewedAt: string;
}): Promise<RestaurantProfileStatusUpdate> {
  const { supabase, userId, status, reviewedAt } = params;

  const payload = buildRestaurantProfileStatusUpdate({
    status,
    reviewedAt,
  });

  const { data, error } = await supabase
    .from("restaurant_profiles")
    .update(payload)
    .eq("user_id", userId)
    .select("user_id, status, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update restaurant profile: ${error.message}`);
  }

  if (!data) {
    throw new Error("Restaurant profile not found.");
  }

  return payload;
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

export async function POST(request: NextRequest) {
  try {
    const admin = await assertCanReviewRestaurants(request);
    const actor = admin.userId;

    const body = await parseBody(request);

    const userId = normalizeUserId(body.userId);
    const status = body.status;
    const reviewNotes = normalizeReviewNotes(body.reviewNotes);

    if (!userId) {
      return badRequest("userId is required.");
    }

    if (!isRestaurantReviewStatus(status)) {
      return badRequest(
        "status must be approved, rejected, suspended or disabled."
      );
    }

    const supabase = buildSupabaseAdminClient();
    const reviewedAt = new Date().toISOString();

    const { data: before, error: readErr } = await supabase
      .from("restaurant_profiles")
      .select("user_id, status, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (readErr || !before) {
      return badRequest("Restaurant profile not found.");
    }

    if (status === "approved") {
      const restaurantCountry = await resolveRestaurantPlatformCountry(
        supabase,
        userId
      );
      const platformCheck = await assertPlatformFeature(
        supabase,
        restaurantCountry,
        "restaurant",
        "active"
      );
      if (platformCheck.ok === false) {
        return NextResponse.json(
          {
            ok: false,
            error: platformCheck.error,
            message: platformCheck.message,
            country_code: platformCheck.country_code,
          },
          { status: 403 }
        );
      }
    }

    const profileUpdate = await updateRestaurantProfileStatus({
      supabase,
      userId,
      status,
      reviewedAt,
    });

    if (isDocumentReviewStatus(status)) {
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
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: actor,
      action: getAuditAction(status),
      targetType: "restaurant",
      targetId: userId,
      oldValues: before as Record<string, unknown>,
      newValues: profileUpdate as unknown as Record<string, unknown>,
      metadata: {
        reviewed_at: reviewedAt,
        review_notes: reviewNotes.length > 0 ? reviewNotes : null,
      },
      request,
    });

    if (status === "approved") {
      await notifyRestaurantApprovedEmail({
        supabaseAdmin: supabase,
        userId,
        restaurantName:
          String((before as { restaurant_name?: string | null })?.restaurant_name ?? "").trim() ||
          null,
      });
    }

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
            : status === "rejected"
              ? "Restaurant rejected successfully."
              : status === "suspended"
                ? "Restaurant suspended successfully."
                : "Restaurant disabled successfully.",
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
