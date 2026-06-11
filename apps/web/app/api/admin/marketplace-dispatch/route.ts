import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isMarketplaceDispatchLiveEnabled } from "@/lib/marketplaceDispatch";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("users.sellers.read", request);
    const supabase = buildSupabaseAdminClient();
    const limit = Math.min(
      Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 100), 1),
      200
    );

    const { data, error } = await supabase
      .from("marketplace_delivery_jobs")
      .select(
        "id,seller_order_id,seller_id,client_id,pickup_location_id,dropoff_location_id,pickup_address,dropoff_address,status,assigned_driver_id,estimated_distance_miles,estimated_minutes,driver_earning_cents,platform_margin_cents,live_dispatch_enabled,drivers_notified,created_at,updated_at,sellers(business_name,country_code,city),pickup:pickup_location_id(id,formatted_address),dropoff:dropoff_location_id(id,formatted_address)"
      )
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) return json({ ok: false, error: error.message }, 500);

    const items = (data ?? []).map((row) => {
      const pickup = Array.isArray(row.pickup) ? row.pickup[0] : row.pickup;
      const dropoff = Array.isArray(row.dropoff) ? row.dropoff[0] : row.dropoff;
      return {
        id: row.id,
        seller_order_id: row.seller_order_id,
        seller: row.sellers,
        client_id: row.client_id,
        pickup_location_id: row.pickup_location_id,
        dropoff_location_id: row.dropoff_location_id,
        pickup_address: row.pickup_address ?? pickup?.formatted_address ?? null,
        dropoff_address: row.dropoff_address ?? dropoff?.formatted_address ?? null,
        status: row.status,
        assigned_driver_id: row.assigned_driver_id,
        estimated_distance_miles: row.estimated_distance_miles,
        estimated_minutes: row.estimated_minutes,
        driver_earning_cents: row.driver_earning_cents,
        platform_margin_cents: row.platform_margin_cents,
        live_dispatch_enabled: row.live_dispatch_enabled === true,
        drivers_notified: row.drivers_notified === true,
        platform_dispatch_live_flag: isMarketplaceDispatchLiveEnabled(),
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    return json({
      ok: true,
      items,
      live_dispatch_enabled: isMarketplaceDispatchLiveEnabled(),
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
