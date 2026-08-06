import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import {
  completenessPercent,
  computeMissingRequirementsForRow,
  normalizeDriverStatus,
  normalizeVehicleType,
  type AdminDriverDocument,
  type AdminDriverListItem,
  type DriverDocType,
} from "@/lib/adminDriverDisplay";
import { resolvePublicAvatarUrl } from "@/lib/adminFoodOrderDisplay";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const DOC_BUCKETS = ["driver-docs", "driver-documents", "avatars"] as const;
const SIGNED_TTL = 60 * 60;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|gif|heic)$/i.test(path);
}

async function signPath(
  supabase: ReturnType<typeof buildSupabaseAdminClient>,
  filePath: string
): Promise<string | null> {
  const raw = String(filePath ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  for (const bucket of DOC_BUCKETS) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(raw, SIGNED_TTL);
    if (!error && data?.signedUrl) return data.signedUrl;
  }
  return resolvePublicAvatarUrl(raw);
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("users.drivers.read", request);
    const supabase = buildSupabaseAdminClient();
    const limit = Math.min(
      Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 200), 1),
      300
    );

    const { data: driverProfiles, error: dpError } = await supabase
      .from("driver_profiles")
      .select(
        [
          "user_id",
          "full_name",
          "phone",
          "emergency_phone",
          "date_of_birth",
          "address",
          "city",
          "state",
          "zip_code",
          "transport_mode",
          "vehicle_type",
          "vehicle_brand",
          "vehicle_model",
          "vehicle_year",
          "vehicle_color",
          "plate_number",
          "license_number",
          "license_expiry",
          "status",
          "documents_required",
          "missing_requirements",
          "is_online",
          "photo_url",
          "created_at",
          "rating",
          "rating_count",
          "total_deliveries",
          "acceptance_rate",
          "cancellation_rate",
        ].join(", ")
      )
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (dpError) return json({ ok: false, error: dpError.message }, 500);

    const rows = (driverProfiles ?? []) as unknown as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return json({ ok: true, items: [], page: { limit, returned: 0, hasMore: false } });
    }

    const userIds = rows.map((r) => String(r.user_id));

    const [profilesRes, docsRes, vehiclesRes, identityRes, taxiQualityRes] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, avatar_url, personal_photo_url")
          .in("id", userIds),
        supabase
          .from("driver_documents")
          .select(
            "id, user_id, doc_type, status, file_path, created_at, reviewed_at, review_notes"
          )
          .in("user_id", userIds),
        supabase
          .from("driver_vehicles")
          .select(
            "id, driver_user_id, photo_url, make, model, year, color, license_plate, vehicle_type, is_primary, updated_at"
          )
          .in("driver_user_id", userIds),
        supabase
          .from("identity_verifications")
          .select("subject_user_id, subject_type, verification_status, updated_at")
          .in("subject_user_id", userIds)
          .order("updated_at", { ascending: false }),
        supabase
          .from("taxi_driver_quality_scores")
          .select("driver_user_id, completed_rides, avg_rating")
          .in("driver_user_id", userIds),
      ]);

    const profileById = new Map<string, Record<string, unknown>>();
    for (const p of profilesRes.data ?? []) {
      profileById.set(String((p as { id: string }).id), p as Record<string, unknown>);
    }

    const docsByUser = new Map<string, AdminDriverDocument[]>();
    const rawDocs = (docsRes.data ?? []) as Array<Record<string, unknown>>;
    // Sign in parallel but capped by Promise.all on all docs (usually modest).
    const signedDocs = await Promise.all(
      rawDocs.map(async (doc) => {
        const filePath = String(doc.file_path ?? "");
        const signed = await signPath(supabase, filePath);
        const item: AdminDriverDocument = {
          id: String(doc.id),
          user_id: String(doc.user_id),
          doc_type: String(doc.doc_type) as DriverDocType,
          status: normalizeDriverStatus(String(doc.status ?? "pending")),
          file_path: filePath,
          created_at: String(doc.created_at ?? ""),
          reviewed_at: (doc.reviewed_at as string | null) ?? null,
          review_notes: (doc.review_notes as string | null) ?? null,
          signed_url: signed,
          is_image: isImagePath(filePath),
        };
        return item;
      })
    );
    for (const doc of signedDocs) {
      const list = docsByUser.get(doc.user_id) ?? [];
      list.push(doc);
      docsByUser.set(doc.user_id, list);
    }

    const vehicleByUser = new Map<string, Record<string, unknown>>();
    const vehicles = (vehiclesRes.error ? [] : vehiclesRes.data ?? []) as Array<
      Record<string, unknown>
    >;
    for (const v of vehicles) {
      const uid = String(v.driver_user_id ?? "");
      if (!uid) continue;
      const existing = vehicleByUser.get(uid);
      if (!existing || v.is_primary === true) {
        vehicleByUser.set(uid, v);
      }
    }

    const identityByUser = new Map<string, string>();
    if (!identityRes.error) {
      for (const row of identityRes.data ?? []) {
        const r = row as {
          subject_user_id?: string;
          subject_type?: string;
          verification_status?: string;
        };
        const uid = String(r.subject_user_id ?? "");
        if (!uid || identityByUser.has(uid)) continue;
        const st = String(r.subject_type ?? "").toLowerCase();
        if (st && st !== "driver" && st !== "drivers") continue;
        identityByUser.set(uid, String(r.verification_status ?? "not_started"));
      }
      // Fallback: accept any subject_type if none tagged driver
      for (const row of identityRes.data ?? []) {
        const r = row as {
          subject_user_id?: string;
          verification_status?: string;
        };
        const uid = String(r.subject_user_id ?? "");
        if (!uid || identityByUser.has(uid)) continue;
        identityByUser.set(uid, String(r.verification_status ?? "not_started"));
      }
    }

    const taxiByUser = new Map<string, { completed_rides: number | null; avg_rating: number | null }>();
    if (!taxiQualityRes.error) {
      for (const row of taxiQualityRes.data ?? []) {
        const r = row as {
          driver_user_id?: string;
          completed_rides?: number | null;
          avg_rating?: number | null;
        };
        taxiByUser.set(String(r.driver_user_id ?? ""), {
          completed_rides: r.completed_rides ?? null,
          avg_rating: r.avg_rating ?? null,
        });
      }
    }

    const items: AdminDriverListItem[] = await Promise.all(
      rows.map(async (d) => {
        const userId = String(d.user_id);
        const profile = profileById.get(userId) ?? {};
        const documents = (docsByUser.get(userId) ?? []).sort(
          (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
        );
        const transportMode = normalizeVehicleType(
          String(d.transport_mode ?? d.vehicle_type ?? "")
        );
        const fullName =
          String(d.full_name ?? "").trim() ||
          String(profile.full_name ?? "").trim() ||
          null;

        const missing = computeMissingRequirementsForRow({
          transport_mode: transportMode,
          full_name: fullName,
          phone: (d.phone as string | null) ?? null,
          emergency_phone: (d.emergency_phone as string | null) ?? null,
          address: (d.address as string | null) ?? null,
          city: (d.city as string | null) ?? null,
          state: (d.state as string | null) ?? null,
          zip_code: (d.zip_code as string | null) ?? null,
          date_of_birth: (d.date_of_birth as string | null) ?? null,
          vehicle_brand: (d.vehicle_brand as string | null) ?? null,
          vehicle_model: (d.vehicle_model as string | null) ?? null,
          vehicle_year: (d.vehicle_year as number | null) ?? null,
          vehicle_color: (d.vehicle_color as string | null) ?? null,
          plate_number: (d.plate_number as string | null) ?? null,
          license_number: (d.license_number as string | null) ?? null,
          license_expiry: (d.license_expiry as string | null) ?? null,
          documents,
        });

        const profilePhotoDoc = documents.find((doc) => doc.doc_type === "profile_photo");
        const photo =
          profilePhotoDoc?.signed_url ||
          (await signPath(supabase, String(d.photo_url ?? ""))) ||
          resolvePublicAvatarUrl(
            String(profile.avatar_url ?? profile.personal_photo_url ?? "")
          );

        const veh = vehicleByUser.get(userId);
        const vehiclePhoto = veh
          ? await signPath(supabase, String(veh.photo_url ?? ""))
          : null;
        const taxi = taxiByUser.get(userId);

        const status = normalizeDriverStatus(String(d.status ?? "pending"));

        return {
          user_id: userId,
          full_name: fullName,
          email: (profile.email as string | null) ?? null,
          phone: (d.phone as string | null) ?? null,
          emergency_phone: (d.emergency_phone as string | null) ?? null,
          date_of_birth: (d.date_of_birth as string | null) ?? null,
          address: (d.address as string | null) ?? null,
          city: (d.city as string | null) ?? null,
          state: (d.state as string | null) ?? null,
          zip_code: (d.zip_code as string | null) ?? null,
          transport_mode: transportMode,
          vehicle_brand: (d.vehicle_brand as string | null) ?? null,
          vehicle_model: (d.vehicle_model as string | null) ?? null,
          vehicle_year: (d.vehicle_year as number | null) ?? null,
          vehicle_color: (d.vehicle_color as string | null) ?? null,
          plate_number: (d.plate_number as string | null) ?? null,
          license_number: (d.license_number as string | null) ?? null,
          license_expiry: (d.license_expiry as string | null) ?? null,
          status,
          documents_required: missing.length > 0,
          missing_requirements:
            missing.length > 0
              ? missing.join(", ")
              : ((d.missing_requirements as string | null) ?? null),
          computed_missing_requirements: missing,
          completeness_percent: completenessPercent(missing.length, transportMode),
          is_online: Boolean(d.is_online),
          photo_url: photo,
          created_at: (d.created_at as string | null) ?? null,
          rating:
            d.rating != null
              ? Number(d.rating)
              : taxi?.avg_rating != null
                ? Number(taxi.avg_rating)
                : null,
          rating_count:
            d.rating_count != null ? Number(d.rating_count) : null,
          total_deliveries:
            d.total_deliveries != null ? Number(d.total_deliveries) : null,
          taxi_completed_rides: taxi?.completed_rides ?? null,
          acceptance_rate:
            d.acceptance_rate != null ? Number(d.acceptance_rate) : null,
          cancellation_rate:
            d.cancellation_rate != null ? Number(d.cancellation_rate) : null,
          stripe_identity_status: identityByUser.get(userId) ?? null,
          documents,
          vehicle: veh
            ? {
                id: String(veh.id ?? "") || null,
                photo_url: vehiclePhoto,
                vehicle_type: (veh.vehicle_type as string | null) ?? null,
                make: (veh.make as string | null) ?? (d.vehicle_brand as string | null),
                model: (veh.model as string | null) ?? (d.vehicle_model as string | null),
                year:
                  veh.year != null
                    ? Number(veh.year)
                    : ((d.vehicle_year as number | null) ?? null),
                color: (veh.color as string | null) ?? (d.vehicle_color as string | null),
                plate:
                  (veh.license_plate as string | null) ??
                  (d.plate_number as string | null),
              }
            : {
                id: null,
                photo_url: null,
                vehicle_type: transportMode,
                make: (d.vehicle_brand as string | null) ?? null,
                model: (d.vehicle_model as string | null) ?? null,
                year: (d.vehicle_year as number | null) ?? null,
                color: (d.vehicle_color as string | null) ?? null,
                plate: (d.plate_number as string | null) ?? null,
              },
        };
      })
    );

    return json({
      ok: true,
      items,
      page: {
        limit,
        returned: items.length,
        hasMore: items.length >= limit,
        nextCursor: null,
      },
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
