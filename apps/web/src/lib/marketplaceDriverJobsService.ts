import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketplaceDeliveryJobStatus } from "@/lib/marketplaceDispatch";
import {
  resolveDriverPlatformScope,
  resolvePlatformScopeFeatures,
} from "@/lib/platformScopeResolver";

export type DriverMarketplaceJobRow = {
  id: string;
  seller_order_id: string;
  seller_id: string;
  status: MarketplaceDeliveryJobStatus;
  pickup_address: string | null;
  dropoff_address: string | null;
  estimated_distance_miles: number | null;
  estimated_minutes: number | null;
  driver_earning_cents: number;
  assigned_driver_id: string | null;
  live_dispatch_enabled: boolean;
  created_at: string;
  updated_at: string;
  seller_business_name: string | null;
  seller_country_code: string | null;
};

const JOB_SELECT =
  "id,seller_order_id,seller_id,status,pickup_address,dropoff_address,estimated_distance_miles,estimated_minutes,driver_earning_cents,assigned_driver_id,live_dispatch_enabled,created_at,updated_at,sellers(business_name,country_code)";

function mapJobRow(row: Record<string, unknown>): DriverMarketplaceJobRow {
  const sellers = row.sellers as
    | { business_name?: string | null; country_code?: string | null }
    | { business_name?: string | null; country_code?: string | null }[]
    | null;

  const seller = Array.isArray(sellers) ? sellers[0] : sellers;

  return {
    id: String(row.id),
    seller_order_id: String(row.seller_order_id),
    seller_id: String(row.seller_id),
    status: String(row.status) as MarketplaceDeliveryJobStatus,
    pickup_address: (row.pickup_address as string | null) ?? null,
    dropoff_address: (row.dropoff_address as string | null) ?? null,
    estimated_distance_miles:
      row.estimated_distance_miles == null ? null : Number(row.estimated_distance_miles),
    estimated_minutes:
      row.estimated_minutes == null ? null : Number(row.estimated_minutes),
    driver_earning_cents: Number(row.driver_earning_cents ?? 0),
    assigned_driver_id: (row.assigned_driver_id as string | null) ?? null,
    live_dispatch_enabled: Boolean(row.live_dispatch_enabled),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    seller_business_name: seller?.business_name ?? null,
    seller_country_code: seller?.country_code ?? null,
  };
}

async function assertApprovedDriver(
  supabaseAdmin: SupabaseClient,
  driverUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("driver_profiles")
    .select("status")
    .eq("user_id", driverUserId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (String(data?.status ?? "") !== "approved") {
    return { ok: false, error: "driver_not_approved" };
  }
  return { ok: true };
}

async function assertDriverMarketplaceEnabled(
  supabaseAdmin: SupabaseClient,
  driverUserId: string
): Promise<{ ok: true; countryCode: string | null } | { ok: false; error: string }> {
  const scope = await resolveDriverPlatformScope(supabaseAdmin, driverUserId, {});
  const features = await resolvePlatformScopeFeatures(supabaseAdmin, scope);

  if (!features.marketplace_available) {
    return { ok: false, error: "marketplace_unavailable" };
  }

  return { ok: true, countryCode: scope.country_code ?? null };
}

export async function listMarketplaceJobsForDriver(
  supabaseAdmin: SupabaseClient,
  driverUserId: string
): Promise<
  | {
      ok: true;
      available: DriverMarketplaceJobRow[];
      mine: DriverMarketplaceJobRow[];
    }
  | { ok: false; error: string }
> {
  const driverCheck = await assertApprovedDriver(supabaseAdmin, driverUserId);
  if (driverCheck.ok === false) {
    return { ok: false as const, error: driverCheck.error };
  }

  const scopeCheck = await assertDriverMarketplaceEnabled(supabaseAdmin, driverUserId);
  if (scopeCheck.ok === false) {
    return { ok: false as const, error: scopeCheck.error };
  }

  const countryCode = scopeCheck.countryCode?.trim().toUpperCase() ?? null;

  const { data: availableRows, error: availableError } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .select(JOB_SELECT)
    .eq("status", "dispatch_ready")
    .eq("live_dispatch_enabled", true)
    .is("assigned_driver_id", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (availableError) return { ok: false, error: availableError.message };

  const { data: mineRows, error: mineError } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .select(JOB_SELECT)
    .eq("assigned_driver_id", driverUserId)
    .in("status", ["dispatch_assigned", "picked_up"])
    .order("updated_at", { ascending: false })
    .limit(50);

  if (mineError) return { ok: false, error: mineError.message };

  const filterCountry = (rows: Record<string, unknown>[]) =>
    rows
      .map(mapJobRow)
      .filter((job) => {
        if (!countryCode) return true;
        return String(job.seller_country_code ?? "").trim().toUpperCase() === countryCode;
      });

  return {
    ok: true,
    available: filterCountry((availableRows ?? []) as Record<string, unknown>[]),
    mine: filterCountry((mineRows ?? []) as Record<string, unknown>[]),
  };
}

export async function getMarketplaceJobForDriver(
  supabaseAdmin: SupabaseClient,
  params: { driverUserId: string; jobId: string }
): Promise<{ ok: true; job: DriverMarketplaceJobRow } | { ok: false; error: string }> {
  const driverCheck = await assertApprovedDriver(supabaseAdmin, params.driverUserId);
  if (driverCheck.ok === false) {
    return { ok: false as const, error: driverCheck.error };
  }

  const { data, error } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .select(JOB_SELECT)
    .eq("id", params.jobId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "job_not_found" };

  const job = mapJobRow(data as Record<string, unknown>);
  const isAssigned = job.assigned_driver_id === params.driverUserId;
  const isAvailable =
    job.status === "dispatch_ready" && job.assigned_driver_id == null;

  if (!isAssigned && !isAvailable) {
    return { ok: false, error: "job_not_accessible" };
  }

  return { ok: true, job };
}

export async function acceptMarketplaceJobForDriver(
  supabaseAdmin: SupabaseClient,
  params: { driverUserId: string; jobId: string }
): Promise<{ ok: true; job: DriverMarketplaceJobRow } | { ok: false; error: string }> {
  const driverCheck = await assertApprovedDriver(supabaseAdmin, params.driverUserId);
  if (driverCheck.ok === false) {
    return { ok: false as const, error: driverCheck.error };
  }

  const scopeCheck = await assertDriverMarketplaceEnabled(supabaseAdmin, params.driverUserId);
  if (scopeCheck.ok === false) {
    return { ok: false as const, error: scopeCheck.error };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .update({
      status: "dispatch_assigned",
      assigned_driver_id: params.driverUserId,
      updated_at: now,
    })
    .eq("id", params.jobId)
    .eq("status", "dispatch_ready")
    .eq("live_dispatch_enabled", true)
    .is("assigned_driver_id", null)
    .select(JOB_SELECT)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) {
    const { data: existing } = await supabaseAdmin
      .from("marketplace_delivery_jobs")
      .select("id,live_dispatch_enabled,status,assigned_driver_id")
      .eq("id", params.jobId)
      .maybeSingle();

    if (existing && existing.live_dispatch_enabled !== true) {
      return { ok: false, error: "live_dispatch_disabled" };
    }
    return { ok: false, error: "job_not_available" };
  }

  return { ok: true, job: mapJobRow(data as Record<string, unknown>) };
}

export async function updateMarketplaceJobStatusForDriver(
  supabaseAdmin: SupabaseClient,
  params: {
    driverUserId: string;
    jobId: string;
    nextStatus: "picked_up" | "delivered";
  }
): Promise<{ ok: true; job: DriverMarketplaceJobRow } | { ok: false; error: string }> {
  const driverCheck = await assertApprovedDriver(supabaseAdmin, params.driverUserId);
  if (driverCheck.ok === false) {
    return { ok: false as const, error: driverCheck.error };
  }

  const allowedFrom: Record<"picked_up" | "delivered", MarketplaceDeliveryJobStatus[]> = {
    picked_up: ["dispatch_assigned"],
    delivered: ["picked_up"],
  };

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("marketplace_delivery_jobs")
    .update({
      status: params.nextStatus,
      updated_at: now,
    })
    .eq("id", params.jobId)
    .eq("assigned_driver_id", params.driverUserId)
    .in("status", allowedFrom[params.nextStatus])
    .select(JOB_SELECT)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "invalid_status_transition" };

  return { ok: true, job: mapJobRow(data as Record<string, unknown>) };
}
