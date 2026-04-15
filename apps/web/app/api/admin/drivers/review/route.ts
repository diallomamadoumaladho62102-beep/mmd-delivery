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

type DriverProfileRow = {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  emergency_phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  date_of_birth: string | null;
  transport_mode: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  plate_number: string | null;
  license_number: string | null;
  license_expiry: string | null;
  status: string | null;
  documents_required: boolean | null;
  is_online: boolean | null;
  missing_requirements: string | null;
};

type DriverDocumentRow = {
  user_id: string;
  doc_type: string;
  status: string | null;
};

type DriverProfileStatusUpdate = {
  status: DriverReviewStatus;
  documents_required: boolean;
  missing_requirements: string | null;
  is_online: boolean;
  updated_at: string;
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

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasDoc(
  docsByType: Map<string, DriverDocumentRow>,
  docType: string,
): boolean {
  const doc = docsByType.get(docType);
  return !!doc;
}

function computeMissingRequirements(params: {
  profile: DriverProfileRow;
  documents: DriverDocumentRow[];
}): string[] {
  const { profile, documents } = params;
  const missing: string[] = [];
  const docsByType = new Map<string, DriverDocumentRow>();

  for (const doc of documents) {
    docsByType.set(doc.doc_type, doc);
  }

  if (!hasText(profile.full_name)) missing.push("full name");
  if (!hasText(profile.phone)) missing.push("phone number");
  if (!hasText(profile.emergency_phone)) missing.push("emergency phone number");
  if (!hasText(profile.address)) missing.push("address");
  if (!hasText(profile.city)) missing.push("city");
  if (!hasText(profile.state)) missing.push("state");
  if (!hasText(profile.zip_code)) missing.push("zip code");
  if (!hasText(profile.date_of_birth)) missing.push("date of birth");
  if (!hasText(profile.transport_mode)) missing.push("transport mode");

  if (!hasDoc(docsByType, "profile_photo")) {
    missing.push("profile photo");
  }
  if (!hasDoc(docsByType, "id_card_front")) {
    missing.push("ID card front");
  }
  if (!hasDoc(docsByType, "id_card_back")) {
    missing.push("ID card back");
  }

  const isMotor =
    profile.transport_mode === "car" || profile.transport_mode === "moto";

  if (isMotor) {
    if (!hasText(profile.license_number)) missing.push("license number");
    if (!hasText(profile.license_expiry)) missing.push("license expiry");
    if (!hasText(profile.vehicle_brand)) missing.push("vehicle brand");
    if (!hasText(profile.vehicle_model)) missing.push("vehicle model");
    if (profile.vehicle_year == null) missing.push("vehicle year");
    if (!hasText(profile.vehicle_color)) missing.push("vehicle color");
    if (!hasText(profile.plate_number)) missing.push("plate number");

    if (!hasDoc(docsByType, "license_front")) {
      missing.push("license front");
    }
    if (!hasDoc(docsByType, "license_back")) {
      missing.push("license back");
    }
    if (!hasDoc(docsByType, "insurance")) {
      missing.push("insurance");
    }
    if (!hasDoc(docsByType, "registration")) {
      missing.push("registration");
    }
  }

  return missing;
}

function formatMissingRequirements(missing: string[]): string | null {
  if (missing.length === 0) return null;
  return `Missing: ${missing.join(", ")}`;
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

function buildDriverProfileStatusUpdate(params: {
  status: DriverReviewStatus;
  reviewedAt: string;
  missingRequirements: string[];
}): DriverProfileStatusUpdate {
  const { status, reviewedAt, missingRequirements } = params;

  const documentsRequired = missingRequirements.length > 0;
  const missingRequirementsText = formatMissingRequirements(missingRequirements);

  return {
    status,
    documents_required: documentsRequired,
    missing_requirements: missingRequirementsText,
    is_online: false,
    updated_at: reviewedAt,
  };
}

async function getDriverProfile(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  userId: string;
}): Promise<DriverProfileRow> {
  const { supabase, userId } = params;

  const { data, error } = await supabase
    .from("driver_profiles")
    .select(
      `
      user_id,
      full_name,
      phone,
      emergency_phone,
      address,
      city,
      state,
      zip_code,
      date_of_birth,
      transport_mode,
      vehicle_brand,
      vehicle_model,
      vehicle_year,
      vehicle_color,
      plate_number,
      license_number,
      license_expiry,
      status,
      documents_required,
      is_online,
      missing_requirements
    `,
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load driver profile: ${error.message}`);
  }

  if (!data) {
    throw new Error("Driver profile not found.");
  }

  return data as DriverProfileRow;
}

async function getDriverDocuments(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  userId: string;
}): Promise<DriverDocumentRow[]> {
  const { supabase, userId } = params;

  const { data, error } = await supabase
    .from("driver_documents")
    .select("user_id, doc_type, status")
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to load driver documents: ${error.message}`);
  }

  return (data ?? []) as DriverDocumentRow[];
}

async function updateDriverDocuments(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  userId: string;
  payload: DriverDocumentUpdate;
}): Promise<void> {
  const { supabase, userId, payload } = params;

  const { error } = await supabase
    .from("driver_documents")
    .update(payload)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update driver documents: ${error.message}`);
  }
}

async function updateDriverProfileStatus(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  userId: string;
  status: DriverReviewStatus;
  reviewedAt: string;
  missingRequirements: string[];
}): Promise<DriverProfileStatusUpdate> {
  const { supabase, userId, status, reviewedAt, missingRequirements } = params;

  const payload = buildDriverProfileStatusUpdate({
    status,
    reviewedAt,
    missingRequirements,
  });

  const { data, error } = await supabase
    .from("driver_profiles")
    .update(payload)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update driver profile: ${error.message}`);
  }

  if (!data) {
    throw new Error("Driver profile not found.");
  }

  return payload;
}

async function writeDriverAuditLog(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  adminUserId: string;
  targetUserId: string;
  status: DriverReviewStatus;
  reviewedAt: string;
  reviewNotes: string;
  missingRequirements: string[];
  profileUpdate: DriverProfileStatusUpdate;
}): Promise<void> {
  const {
    supabase,
    adminUserId,
    targetUserId,
    status,
    reviewedAt,
    reviewNotes,
    missingRequirements,
    profileUpdate,
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
      documents_required: profileUpdate.documents_required,
      missing_requirements: missingRequirements,
      missing_requirements_text: profileUpdate.missing_requirements,
      is_online: profileUpdate.is_online,
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
    { status: 400 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const admin = await assertAdminAccess(request);
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

    const [driverProfile, driverDocuments] = await Promise.all([
      getDriverProfile({
        supabase,
        userId,
      }),
      getDriverDocuments({
        supabase,
        userId,
      }),
    ]);

    const missingRequirements = computeMissingRequirements({
      profile: driverProfile,
      documents: driverDocuments,
    });

    const updatePayload = buildDriverDocumentUpdate({
      status,
      reviewedAt,
      reviewedBy: actor,
      reviewNotes,
    });

    const profileUpdate = await updateDriverProfileStatus({
      supabase,
      userId,
      status,
      reviewedAt,
      missingRequirements: status === "rejected" ? missingRequirements : missingRequirements,
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
      missingRequirements,
      profileUpdate,
    });

    return NextResponse.json(
      {
        ok: true,
        userId,
        status,
        reviewedAt,
        reviewNotes: reviewNotes.length > 0 ? reviewNotes : null,
        documentsRequired: profileUpdate.documents_required,
        missingRequirements,
        missingRequirementsText: profileUpdate.missing_requirements,
        isOnline: profileUpdate.is_online,
        message:
          status === "approved"
            ? profileUpdate.documents_required
              ? "Driver approved with missing requirements recorded."
              : "Driver approved successfully."
            : "Driver rejected successfully.",
      },
      { status: 200 },
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
      { status },
    );
  }
}