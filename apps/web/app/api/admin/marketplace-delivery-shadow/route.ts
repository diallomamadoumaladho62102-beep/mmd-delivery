import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

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
      .from("seller_orders")
      .select(
        "id,seller_id,client_user_id,status,currency,subtotal_cents,total_cents,pickup_location_id,dropoff_location_id,seller_pickup_address,delivery_status_shadow,delivery_quote_shadow,estimated_distance_miles,estimated_minutes,driver_earning_shadow_cents,platform_margin_shadow_cents,dispatch_shadow,created_at,updated_at,sellers(business_name,country_code,city),pickup:pickup_location_id(id,pin_lat,pin_lng,formatted_address),dropoff:dropoff_location_id(id,pin_lat,pin_lng,formatted_address)"
      )
      .neq("delivery_status_shadow", "not_started")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) return json({ ok: false, error: error.message }, 500);

    const items = (data ?? []).map((row) => {
      const quote = (row.delivery_quote_shadow ?? {}) as Record<string, unknown>;
      const dispatch = (row.dispatch_shadow ?? {}) as Record<string, unknown>;
      return {
        seller_order_id: row.id,
        seller: row.sellers,
        status: row.status,
        pickup_location_id: row.pickup_location_id,
        dropoff_location_id: row.dropoff_location_id,
        seller_pickup_address: row.seller_pickup_address,
        pickup: row.pickup,
        dropoff: row.dropoff,
        estimated_distance_miles: row.estimated_distance_miles,
        estimated_minutes: row.estimated_minutes,
        customer_delivery_total_shadow_cents:
          quote.customer_delivery_total_cents ?? null,
        driver_earning_shadow_cents: row.driver_earning_shadow_cents,
        platform_margin_shadow_cents: row.platform_margin_shadow_cents,
        delivery_status_shadow: row.delivery_status_shadow,
        dispatch_readiness: dispatch.dispatch_readiness ?? null,
        live_dispatch_enabled: dispatch.live_dispatch_enabled === true,
        drivers_notified: dispatch.drivers_notified === true,
        dispatch_shadow: row.dispatch_shadow,
        delivery_quote_shadow: row.delivery_quote_shadow,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    return json({ ok: true, items });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
