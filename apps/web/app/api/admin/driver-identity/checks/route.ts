import { NextRequest } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import {
  adminRequestIdentityCheck,
  createSignedSelfieUrl,
} from "@/lib/driverIdentityService";
import { loadStaffNameMap } from "@/lib/driverIdentityOps";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  let staff;
  try {
    staff = await assertStaffPermission("drivers.identity.read", req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  const admin = buildSupabaseAdminClient();
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const queueFilter = url.searchParams.get("queue");
  const assignedFilter = url.searchParams.get("assigned");
  const country = url.searchParams.get("country");
  const city = url.searchParams.get("city");
  const search = url.searchParams.get("q");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  let query = admin
    .from("driver_identity_checks")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (statusFilter) query = query.eq("status", statusFilter);
  if (assignedFilter === "me") query = query.eq("assigned_to", staff.userId);
  if (country) query = query.ilike("country", country);
  if (city) query = query.ilike("city", `%${city}%`);

  const { data, error, count } = await query;
  if (error) return adminJson({ ok: false, error: error.message }, 500);

  let rows = data ?? [];
  const driverIds = [...new Set(rows.map((row: { driver_id: string }) => row.driver_id))];
  const profilesById = new Map<string, Record<string, unknown>>();

  if (driverIds.length > 0) {
    const { data: profiles } = await admin
      .from("driver_profiles")
      .select("user_id, full_name, phone, city, status, is_online")
      .in("user_id", driverIds);

    for (const profile of profiles ?? []) {
      profilesById.set(profile.user_id, profile);
    }
  }

  const enriched: Record<string, unknown>[] = rows.map((row: Record<string, unknown>) => ({
    ...row,
    driver_profile: profilesById.get(String(row.driver_id)) ?? null,
  }));

  let filtered: Record<string, unknown>[] = enriched;

  if (queueFilter === "high_risk") {
    filtered = filtered.filter((row) => Number(row.risk_score ?? 0) >= 61);
  } else if (queueFilter === "waiting") {
    filtered = filtered.filter((row) =>
      ["required", "pending", "submitted", "manual_review"].includes(String(row.status)),
    );
  } else if (queueFilter === "expired") {
    filtered = filtered.filter((row) => String(row.status) === "expired");
  } else if (queueFilter === "manual_review") {
    filtered = filtered.filter(
      (row) =>
        Boolean(row.requires_manual_review) || String(row.status) === "manual_review",
    );
  }

  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter((row: Record<string, unknown>) => {
      const profile = row.driver_profile as Record<string, unknown> | null;
      const name = String(profile?.full_name ?? "").toLowerCase();
      const phone = String(profile?.phone ?? "").toLowerCase();
      const driverId = String(row.driver_id ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q) || driverId.includes(q);
    });
  }

  const withThumbs: Record<string, unknown>[] = await Promise.all(
    filtered.map(async (row: Record<string, unknown>) => {
      const selfiePath = row.selfie_path ? String(row.selfie_path) : "";
      if (!selfiePath) {
        return { ...row, selfie_thumb_signed_url: null };
      }

      try {
        const selfie_thumb_signed_url = await createSignedSelfieUrl(
          admin,
          selfiePath,
          600,
        );
        return { ...row, selfie_thumb_signed_url };
      } catch {
        return { ...row, selfie_thumb_signed_url: null };
      }
    }),
  );

  const staffIds = withThumbs.flatMap((row) => [
    String(row.assigned_to ?? ""),
    String(row.locked_by ?? ""),
  ]);
  const staffNames = await loadStaffNameMap(admin, staffIds);

  const checks = withThumbs.map((row) => ({
    ...row,
    assigned_to_name: row.assigned_to
      ? staffNames.get(String(row.assigned_to)) ?? null
      : null,
    locked_by_name: row.locked_by
      ? staffNames.get(String(row.locked_by)) ?? null
      : null,
  }));

  return adminJson({ ok: true, checks, total: count ?? checks.length });
}

export async function POST(req: NextRequest) {
  let staff;
  try {
    staff = await assertStaffPermission("drivers.identity.manage", req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const driverId = String(body.driver_id ?? "").trim();
  const reason = String(body.reason ?? "").trim();

  if (!driverId) return adminJson({ ok: false, error: "driver_id_required" }, 400);

  const admin = buildSupabaseAdminClient();

  try {
    const check = await adminRequestIdentityCheck(admin, {
      driverId,
      adminUserId: staff.userId,
      reason,
    });

    await writeAdminAuditServer({
      supabaseAdmin: admin,
      adminUserId: staff.userId,
      action: "driver_identity.request_check",
      targetType: "driver_identity_check",
      targetId: check.id,
      metadata: { driver_id: driverId, reason },
      request: req,
    });

    return adminJson({ ok: true, check });
  } catch (error) {
    console.error("admin request identity check:", error);
    return adminJson({ ok: false, error: "request_check_failed" }, 500);
  }
}
