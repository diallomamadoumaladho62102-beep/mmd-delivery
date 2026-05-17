import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertAdminAccess } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  userId?: unknown;
  profile?: Record<string, unknown>;
};

const ALLOWED_FIELDS = [
  "full_name",
  "phone",
  "emergency_phone",
  "address",
  "city",
  "state",
  "zip_code",
  "date_of_birth",
  "transport_mode",
  "vehicle_brand",
  "vehicle_model",
  "vehicle_year",
  "vehicle_color",
  "plate_number",
  "license_number",
  "license_expiry",
] as const;

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function normalizeString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeYear(value: unknown): number | null {
  if (value == null || value === "") return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1980 || year > 2035) return null;
  return year;
}

function normalizeTransport(value: unknown): "bike" | "moto" | "car" | null {
  if (value === "bike" || value === "moto" || value === "car") return value;
  return null;
}

function buildPatch(profile: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};

  for (const field of ALLOWED_FIELDS) {
    if (!(field in profile)) continue;

    if (field === "vehicle_year") {
      patch[field] = normalizeYear(profile[field]);
      continue;
    }

    if (field === "transport_mode") {
      const transport = normalizeTransport(profile[field]);
      if (!transport) throw new Error("Invalid transport_mode.");
      patch[field] = transport;
      patch.vehicle_type = transport;
      continue;
    }

    if (field === "state" || field === "plate_number" || field === "license_number") {
      patch[field] = normalizeString(profile[field])?.toUpperCase() ?? null;
      continue;
    }

    patch[field] = normalizeString(profile[field]);
  }

  patch.updated_at = new Date().toISOString();
  return patch;
}

export async function POST(request: NextRequest) {
  try {
    const admin = await assertAdminAccess(request);
    const body = (await request.json().catch(() => null)) as Body | null;

    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    const profile =
      body?.profile && typeof body.profile === "object" && !Array.isArray(body.profile)
        ? body.profile
        : null;

    if (!userId) return badRequest("userId is required.");
    if (!profile) return badRequest("profile object is required.");

    const patch = buildPatch(profile);

    if (Object.keys(patch).length <= 1) {
      return badRequest("No valid profile fields to update.");
    }

    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("driver_profiles")
      .update(patch)
      .eq("user_id", userId)
      .select("user_id")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return badRequest("Driver profile not found.");

    const now = new Date().toISOString();

    await supabase.from("admin_audit_logs").insert({
      admin_user_id: admin.userId,
      action: "driver_profile_updated",
      target_type: "driver",
      target_id: userId,
      metadata: { updated_fields: Object.keys(patch), patch },
      created_at: now,
    });

    return NextResponse.json({
      ok: true,
      userId,
      updatedFields: Object.keys(patch),
      message: "Driver profile updated successfully.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown driver profile update error";

    return NextResponse.json(
      { ok: false, error: message },
      { status: error instanceof AdminAccessError ? error.status : 500 },
    );
  }
}