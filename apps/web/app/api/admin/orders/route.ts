import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { countOrderItems, type AdminFoodOrderListItem } from "@/lib/adminFoodOrderDisplay";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { applyLiveTripFilters } from "@/lib/tripVisibility";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function uniqIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))];
}

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  personal_photo_url: string | null;
};

type RestaurantRow = {
  user_id: string;
  restaurant_name: string | null;
  logo_url: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
};

function partyFromProfile(row: ProfileRow | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    avatar_url: String(row.avatar_url ?? row.personal_photo_url ?? "").trim() || null,
  };
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("orders.read", request);
    const supabase = buildSupabaseAdminClient();
    const { searchParams } = request.nextUrl;

    const status = String(searchParams.get("status") ?? "").trim();
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 100), 1), 200);

    let query = supabase
      .from("orders")
      .select(
        "id, status, kind, payment_status, subtotal, total, total_cents, currency, restaurant_name, restaurant_id, restaurant_user_id, client_id, client_user_id, user_id, driver_id, created_at, paid_at, delivered_confirmed_at, items_json, distance_miles, eta_minutes, delivery_fee, pickup_address, dropoff_address, promo_code_applied"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);

    query = applyLiveTripFilters(query);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

    const clientIds = uniqIds(
      rows.flatMap((row) => [
        row.client_id as string | null,
        row.client_user_id as string | null,
        row.user_id as string | null,
      ])
    );
    const driverIds = uniqIds(rows.map((row) => row.driver_id as string | null));
    const restaurantIds = uniqIds(
      rows.flatMap((row) => [
        row.restaurant_user_id as string | null,
        row.restaurant_id as string | null,
      ])
    );
    const profileIds = uniqIds([...clientIds, ...driverIds]);

    const profilesById = new Map<string, ProfileRow>();
    const restaurantsByUserId = new Map<string, RestaurantRow>();

    const [profilesRes, restaurantsRes] = await Promise.all([
      profileIds.length
        ? supabase
            .from("profiles")
            .select("id, full_name, email, phone, avatar_url, personal_photo_url")
            .in("id", profileIds)
        : Promise.resolve({ data: [] as ProfileRow[], error: null }),
      restaurantIds.length
        ? supabase
            .from("restaurant_profiles")
            .select("user_id, restaurant_name, logo_url, avatar_url, cover_image_url")
            .in("user_id", restaurantIds)
        : Promise.resolve({ data: [] as RestaurantRow[], error: null }),
    ]);

    // Enrichment is best-effort: list still returns if party joins fail.
    if (!profilesRes.error && Array.isArray(profilesRes.data)) {
      for (const row of profilesRes.data as ProfileRow[]) {
        profilesById.set(String(row.id), row);
      }
    }
    if (!restaurantsRes.error && Array.isArray(restaurantsRes.data)) {
      for (const row of restaurantsRes.data as RestaurantRow[]) {
        restaurantsByUserId.set(String(row.user_id), row);
      }
    }

    const items: AdminFoodOrderListItem[] = rows.map((row) => {
      const clientKey =
        String(row.client_id ?? "").trim() ||
        String(row.client_user_id ?? "").trim() ||
        String(row.user_id ?? "").trim() ||
        "";
      const driverKey = String(row.driver_id ?? "").trim();
      const restaurantKey =
        String(row.restaurant_user_id ?? "").trim() ||
        String(row.restaurant_id ?? "").trim() ||
        "";
      const restaurant = restaurantKey ? restaurantsByUserId.get(restaurantKey) : undefined;
      const logo =
        String(restaurant?.logo_url ?? restaurant?.avatar_url ?? restaurant?.cover_image_url ?? "")
          .trim() || null;

      return {
        id: String(row.id),
        status: (row.status as string | null) ?? null,
        kind: (row.kind as string | null) ?? null,
        payment_status: (row.payment_status as string | null) ?? null,
        subtotal: (row.subtotal as number | null) ?? null,
        total: (row.total as number | null) ?? null,
        total_cents: (row.total_cents as number | null) ?? null,
        currency: (row.currency as string | null) ?? null,
        restaurant_name: (row.restaurant_name as string | null) ?? null,
        restaurant_id: (row.restaurant_id as string | null) ?? null,
        restaurant_user_id: (row.restaurant_user_id as string | null) ?? null,
        client_id: (row.client_id as string | null) ?? null,
        client_user_id: (row.client_user_id as string | null) ?? null,
        user_id: (row.user_id as string | null) ?? null,
        driver_id: (row.driver_id as string | null) ?? null,
        created_at: String(row.created_at ?? ""),
        paid_at: (row.paid_at as string | null) ?? null,
        delivered_confirmed_at: (row.delivered_confirmed_at as string | null) ?? null,
        items_json: row.items_json ?? null,
        distance_miles: (row.distance_miles as number | null) ?? null,
        eta_minutes: (row.eta_minutes as number | null) ?? null,
        delivery_fee: (row.delivery_fee as number | null) ?? null,
        pickup_address: (row.pickup_address as string | null) ?? null,
        dropoff_address: (row.dropoff_address as string | null) ?? null,
        promo_code_applied: (row.promo_code_applied as string | null) ?? null,
        item_count: countOrderItems(row.items_json),
        client: partyFromProfile(clientKey ? profilesById.get(clientKey) : undefined),
        driver: partyFromProfile(driverKey ? profilesById.get(driverKey) : undefined),
        restaurant: {
          id: restaurant?.user_id ?? (restaurantKey || null),
          name:
            restaurant?.restaurant_name ??
            ((row.restaurant_name as string | null) ?? null),
          logo_url: logo,
        },
      };
    });

    return json({
      ok: true,
      items,
      // Architecture hooks for future pagination / infinite scroll (not implemented).
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
