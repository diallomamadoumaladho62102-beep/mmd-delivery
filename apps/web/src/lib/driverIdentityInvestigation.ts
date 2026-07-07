import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDriverIdentityAiInsight } from "@/lib/driverIdentityAiInsight";
import { computeGlobalTrustScore } from "@/lib/driverIdentityTrustScore";
import { identityTriggerLabel } from "@/lib/driverIdentityDisplay";

export type InvestigationSection =
  | "driver-history"
  | "security-history"
  | "geography"
  | "trust-score"
  | "ai-insight"
  | "view-audit";

export type SecurityChangeEntry = {
  type: string;
  label: string;
  value: string;
  at: string;
  source: string;
};

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

function toRate(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num > 1 ? num / 100 : num;
}

async function loadDriverProfile(admin: SupabaseClient, driverId: string) {
  const { data } = await admin
    .from("driver_profiles")
    .select(
      "user_id, full_name, phone, city, state, created_at, updated_at, status, total_deliveries, acceptance_rate, cancellation_rate, rating, rating_count, license_number, license_expiry, stripe_account_id, vehicle_brand, vehicle_model, plate_number",
    )
    .eq("user_id", driverId)
    .maybeSingle();
  return data;
}

async function countSuspensions(admin: SupabaseClient, driverId: string) {
  const [{ count: auditCount }, { count: identityCount }] = await Promise.all([
    admin
      .from("admin_audit_logs")
      .select("*", { count: "exact", head: true })
      .eq("target_type", "driver")
      .eq("target_id", driverId)
      .in("action", ["driver_suspended", "driver_disabled"]),
    admin
      .from("driver_identity_events")
      .select("*", { count: "exact", head: true })
      .eq("driver_id", driverId)
      .eq("event_type", "driver_suspended"),
  ]);
  return (auditCount ?? 0) + (identityCount ?? 0);
}

async function loadBaseCounts(admin: SupabaseClient, driverId: string) {
  const [
    { count: verificationCount },
    { count: incidentCount },
    { count: openIncidents },
  ] = await Promise.all([
    admin
      .from("driver_identity_checks")
      .select("*", { count: "exact", head: true })
      .eq("driver_id", driverId),
    admin
      .from("driver_identity_reports")
      .select("*", { count: "exact", head: true })
      .eq("driver_id", driverId),
    admin
      .from("driver_identity_reports")
      .select("*", { count: "exact", head: true })
      .eq("driver_id", driverId)
      .eq("status", "open"),
  ]);

  return {
    verificationCount: verificationCount ?? 0,
    incidentCount: incidentCount ?? 0,
    openIncidents: openIncidents ?? 0,
  };
}

export async function loadDriverHistorySection(
  admin: SupabaseClient,
  driverId: string,
) {
  const [profile, counts, suspensionCount, qualityResult] = await Promise.all([
    loadDriverProfile(admin, driverId),
    loadBaseCounts(admin, driverId),
    countSuspensions(admin, driverId),
    admin
      .from("taxi_driver_quality_scores")
      .select("completed_rides, canceled_rides, cancel_rate, avg_rating, quality_score")
      .eq("user_id", driverId)
      .maybeSingle(),
  ]);
  const quality = qualityResult.data;

  const totalTrips =
    Number(profile?.total_deliveries ?? 0) + Number(quality?.completed_rides ?? 0);

  return {
    total_trips: totalTrips,
    acceptance_rate: toRate(profile?.acceptance_rate),
    cancellation_rate: toRate(profile?.cancellation_rate ?? quality?.cancel_rate),
    average_rating:
      profile?.rating != null
        ? Number(profile.rating)
        : quality?.avg_rating != null
          ? Number(quality.avg_rating)
          : null,
    rating_count: Number(profile?.rating_count ?? 0),
    seniority_days: daysSince(profile?.created_at),
    seniority_label: `${daysSince(profile?.created_at)} jours`,
    suspension_count: suspensionCount,
    previous_verifications: Math.max(0, counts.verificationCount - 1),
    total_verifications: counts.verificationCount,
    reported_incidents: counts.incidentCount,
    open_incidents: counts.openIncidents,
    profile_status: profile?.status ?? null,
  };
}

export async function loadSecurityHistorySection(
  admin: SupabaseClient,
  driverId: string,
) {
  const [
    checksResult,
    devicesResult,
    vehicleHistoryResult,
    profileAuditsResult,
    documentsResult,
  ] = await Promise.all([
    admin
      .from("driver_identity_checks")
      .select("trigger_type, reason, device_id_hash, ip_hash, city, country, created_at")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("driver_identity_devices")
      .select("device_id_hash, first_seen_at, last_seen_at, last_city, last_country")
      .eq("driver_id", driverId)
      .order("last_seen_at", { ascending: false })
      .limit(20),
    admin
      .from("driver_vehicle_history")
      .select("action, metadata, created_at")
      .eq("driver_user_id", driverId)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("admin_audit_logs")
      .select("action, old_values, new_values, created_at")
      .eq("target_type", "driver")
      .eq("target_id", driverId)
      .eq("action", "driver_profile_updated")
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("driver_documents")
      .select("doc_type, updated_at, created_at")
      .eq("user_id", driverId)
      .in("doc_type", ["license_front", "license_back", "profile_photo"])
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);

  const checks = checksResult.data;
  const devices = devicesResult.data;
  const vehicleHistory = vehicleHistoryResult.data;
  const profileAudits = profileAuditsResult.data;
  const documents = documentsResult.data;

  const entries: SecurityChangeEntry[] = [];

  for (const check of checks ?? []) {
    entries.push({
      type: "trigger",
      label: identityTriggerLabel(String(check.trigger_type ?? "")),
      value: check.reason ?? check.trigger_type ?? "—",
      at: check.created_at,
      source: "identity_check",
    });
    if (check.device_id_hash) {
      entries.push({
        type: "device",
        label: "Changement d'appareil",
        value: check.device_id_hash,
        at: check.created_at,
        source: "identity_check",
      });
    }
    if (check.ip_hash) {
      entries.push({
        type: "ip",
        label: "Changement d'adresse IP",
        value: check.ip_hash,
        at: check.created_at,
        source: "identity_check",
      });
    }
    if (check.city) {
      entries.push({
        type: "city",
        label: "Changement de ville",
        value: check.city,
        at: check.created_at,
        source: "identity_check",
      });
    }
    if (check.country) {
      entries.push({
        type: "country",
        label: "Changement de pays",
        value: check.country,
        at: check.created_at,
        source: "identity_check",
      });
    }
  }

  for (const device of devices ?? []) {
    entries.push({
      type: "device",
      label: "Appareil connu",
      value: device.device_id_hash,
      at: device.last_seen_at ?? device.first_seen_at,
      source: "identity_device",
    });
  }

  for (const row of profileAudits ?? []) {
    const oldValues = (row.old_values ?? {}) as Record<string, unknown>;
    const newValues = (row.new_values ?? {}) as Record<string, unknown>;
    const pairs: Array<[string, string]> = [
      ["phone", "Changement de téléphone"],
      ["stripe_account_id", "Changement de compte bancaire"],
      ["license_number", "Changement de permis"],
      ["vehicle_brand", "Changement de véhicule"],
      ["vehicle_model", "Changement de véhicule"],
      ["plate_number", "Changement de véhicule"],
    ];
    for (const [field, label] of pairs) {
      const oldValue = oldValues[field];
      const newValue = newValues[field];
      if (oldValue !== undefined && newValue !== undefined && oldValue !== newValue) {
        entries.push({
          type: field,
          label,
          value: `${String(oldValue)} → ${String(newValue)}`,
          at: row.created_at,
          source: "admin_audit",
        });
      }
    }
  }

  for (const vehicle of vehicleHistory ?? []) {
    entries.push({
      type: "vehicle",
      label: "Historique véhicule",
      value: String(vehicle.action ?? "update"),
      at: vehicle.created_at,
      source: "vehicle_history",
    });
  }

  for (const doc of documents ?? []) {
    entries.push({
      type: String(doc.doc_type),
      label:
        doc.doc_type === "license_front" || doc.doc_type === "license_back"
          ? "Mise à jour permis"
          : "Mise à jour document",
      value: String(doc.doc_type),
      at: doc.updated_at ?? doc.created_at,
      source: "driver_document",
    });
  }

  entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return {
    changes: entries.slice(0, 40),
    total_changes: entries.length,
  };
}

export async function loadGeographySection(admin: SupabaseClient, driverId: string) {
  const [locationResult, profile, stateResult, recentChecksResult] = await Promise.all([
    admin
      .from("driver_locations")
      .select("lat, lng, updated_at")
      .eq("driver_id", driverId)
      .maybeSingle(),
    loadDriverProfile(admin, driverId),
    admin
      .from("driver_identity_state")
      .select("last_city, last_country")
      .eq("driver_id", driverId)
      .maybeSingle(),
    admin
      .from("driver_identity_checks")
      .select("city, country, created_at")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const location = locationResult.data;
  const state = stateResult.data;
  const recentChecks = recentChecksResult.data;

  const city = profile?.city ?? state?.last_city ?? recentChecks?.[0]?.city ?? null;
  const country =
    profile?.state ?? state?.last_country ?? recentChecks?.[0]?.country ?? null;

  return {
    last_position: location
      ? {
          lat: Number(location.lat),
          lng: Number(location.lng),
          updated_at: location.updated_at,
          maps_url: `https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=14/${location.lat}/${location.lng}`,
        }
      : null,
    city,
    country,
    zone: [city, country].filter(Boolean).join(", ") || null,
    recent_checks: recentChecks ?? [],
  };
}

export async function loadTrustScoreSection(
  admin: SupabaseClient,
  driverId: string,
  currentRiskScore: number,
) {
  const [history, suspensionCount, counts] = await Promise.all([
    loadDriverHistorySection(admin, driverId),
    countSuspensions(admin, driverId),
    loadBaseCounts(admin, driverId),
  ]);

  return computeGlobalTrustScore({
    seniorityDays: history.seniority_days,
    totalTrips: history.total_trips,
    acceptanceRate: history.acceptance_rate,
    cancellationRate: history.cancellation_rate,
    averageRating: history.average_rating,
    suspensionCount,
    previousVerificationCount: history.previous_verifications,
    incidentCount: counts.incidentCount,
    currentRiskScore,
  });
}

export async function loadAiInsightSection(
  admin: SupabaseClient,
  driverId: string,
  check: { trigger_type?: string | null; reason?: string | null; risk_score?: number; requires_manual_review?: boolean },
) {
  const [history, security, trustScore, suspensionCount, counts] = await Promise.all([
    loadDriverHistorySection(admin, driverId),
    loadSecurityHistorySection(admin, driverId),
    loadTrustScoreSection(admin, driverId, Number(check.risk_score ?? 0)),
    countSuspensions(admin, driverId),
    loadBaseCounts(admin, driverId),
  ]);

  return buildDriverIdentityAiInsight({
    triggerType: check.trigger_type ?? null,
    triggerReason: check.reason ?? null,
    riskScore: Number(check.risk_score ?? 0),
    requiresManualReview: Boolean(check.requires_manual_review),
    trustScore,
    incidentCount: counts.incidentCount,
    suspensionCount,
    securityChangeCount: security.total_changes,
    acceptanceRate: history.acceptance_rate,
    cancellationRate: history.cancellation_rate,
  });
}

export async function loadViewAuditSection(
  admin: SupabaseClient,
  checkId: string,
  limit = 30,
) {
  const { data } = await admin
    .from("driver_identity_view_audit")
    .select("id, staff_user_id, action, section, ip_address, created_at")
    .eq("check_id", checkId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return { entries: data ?? [] };
}

export async function logIdentityViewAudit(
  admin: SupabaseClient,
  input: {
    checkId: string;
    driverId: string;
    staffUserId: string;
    action: string;
    section?: string | null;
    request?: NextRequest;
    metadata?: Record<string, unknown>;
  },
) {
  const forwarded = input.request?.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ??
    input.request?.headers.get("x-real-ip")?.trim() ??
    null;

  await admin.from("driver_identity_view_audit").insert({
    check_id: input.checkId,
    driver_id: input.driverId,
    staff_user_id: input.staffUserId,
    action: input.action,
    section: input.section ?? null,
    ip_address: ip,
    metadata: input.metadata ?? {},
  });
}

export async function loadInvestigationSection(
  admin: SupabaseClient,
  driverId: string,
  checkId: string,
  section: InvestigationSection,
  check: Record<string, unknown>,
) {
  switch (section) {
    case "driver-history":
      return loadDriverHistorySection(admin, driverId);
    case "security-history":
      return loadSecurityHistorySection(admin, driverId);
    case "geography":
      return loadGeographySection(admin, driverId);
    case "trust-score":
      return loadTrustScoreSection(admin, driverId, Number(check.risk_score ?? 0));
    case "ai-insight":
      return loadAiInsightSection(admin, driverId, check);
    case "view-audit":
      return loadViewAuditSection(admin, checkId);
    default:
      throw new Error("invalid_section");
  }
}

export async function loadFullInvestigationExport(
  admin: SupabaseClient,
  driverId: string,
  checkId: string,
  check: Record<string, unknown>,
) {
  const [
    driverHistory,
    securityHistory,
    geography,
    trustScore,
    aiInsight,
    viewAudit,
  ] = await Promise.all([
    loadDriverHistorySection(admin, driverId),
    loadSecurityHistorySection(admin, driverId),
    loadGeographySection(admin, driverId),
    loadTrustScoreSection(admin, driverId, Number(check.risk_score ?? 0)),
    loadAiInsightSection(admin, driverId, check),
    loadViewAuditSection(admin, checkId, 100),
  ]);

  return {
    exported_at: new Date().toISOString(),
    check_id: checkId,
    driver_id: driverId,
    check,
    driver_history: driverHistory,
    security_history: securityHistory,
    geography,
    trust_score: trustScore,
    ai_insight: aiInsight,
    view_audit: viewAudit,
  };
}
