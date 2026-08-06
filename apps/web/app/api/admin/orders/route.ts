import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import {
  buildAdminFoodOrderParty,
  countOrderItems,
  resolvePublicAvatarUrl,
  type AdminFoodOrderListItem,
  type PartyProfileSource,
  type PartyRoleProfileSource,
} from "@/lib/adminFoodOrderDisplay";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { applyLiveTripFilters } from "@/lib/tripVisibility";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function uniqIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))];
}

function resolveClientUserId(row: Record<string, unknown>): string {
  // Prefer auth user ids used elsewhere (client_user_id / user_id / created_by).
  // client_id is usually the same uuid, but can be stale on older rows.
  return (
    String(row.client_user_id ?? "").trim() ||
    String(row.client_id ?? "").trim() ||
    String(row.user_id ?? "").trim() ||
    String(row.created_by ?? "").trim() ||
    ""
  );
}

type RestaurantRow = {
  user_id: string;
  restaurant_name: string | null;
  logo_url: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
};

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("orders.read", request);
    const supabase = buildSupabaseAdminClient();
    const { searchParams } = request.nextUrl;

    const status = String(searchParams.get("status") ?? "").trim();
    const paymentStatus = String(searchParams.get("payment_status") ?? "").trim();
    const restaurantId = String(searchParams.get("restaurant_id") ?? "").trim();
    const driverId = String(searchParams.get("driver_id") ?? "").trim();
    const q = String(searchParams.get("q") ?? "").trim();
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 100), 1), 200);

    let query = supabase
      .from("orders")
      .select(
        "id, status, kind, payment_status, subtotal, total, total_cents, currency, restaurant_name, restaurant_id, restaurant_user_id, client_id, client_user_id, user_id, created_by, driver_id, created_at, paid_at, delivered_confirmed_at, items_json, distance_miles, eta_minutes, delivery_fee, pickup_address, dropoff_address, promo_code_applied"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    if (paymentStatus) query = query.eq("payment_status", paymentStatus);
    if (restaurantId) {
      query = query.or(
        `restaurant_id.eq.${restaurantId},restaurant_user_id.eq.${restaurantId}`
      );
    }
    if (driverId) query = query.eq("driver_id", driverId);
    if (q) {
      const escaped = q.replace(/[%_,]/g, "");
      const uuidLike =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          q
        );
      if (uuidLike) {
        query = query.eq("id", q);
      } else if (escaped) {
        query = query.ilike("restaurant_name", `%${escaped}%`);
      }
    }

    query = applyLiveTripFilters(query);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

    const clientIds = uniqIds(rows.map((row) => resolveClientUserId(row)));
    const driverIds = uniqIds(rows.map((row) => row.driver_id as string | null));
    const restaurantIds = uniqIds(
      rows.flatMap((row) => [
        row.restaurant_user_id as string | null,
        row.restaurant_id as string | null,
      ])
    );
    const profileIds = uniqIds([...clientIds, ...driverIds]);

    const profilesById = new Map<string, PartyProfileSource>();
    const clientProfilesById = new Map<string, PartyRoleProfileSource>();
    const driverProfilesById = new Map<string, PartyRoleProfileSource>();
    const restaurantsByUserId = new Map<string, RestaurantRow>();

    const [profilesRes, clientProfilesRes, driverProfilesRes, restaurantsRes] =
      await Promise.all([
        profileIds.length
          ? supabase
              .from("profiles")
              .select(
                "id, full_name, email, phone, phone_e164, avatar_url, personal_photo_url, account_kind"
              )
              .in("id", profileIds)
          : Promise.resolve({ data: [] as PartyProfileSource[], error: null }),
        clientIds.length
          ? supabase
              .from("client_profiles")
              .select("user_id, full_name, phone, avatar_url")
              .in("user_id", clientIds)
          : Promise.resolve({ data: [] as PartyRoleProfileSource[], error: null }),
        driverIds.length
          ? supabase
              .from("driver_profiles")
              .select("user_id, full_name, phone, photo_url")
              .in("user_id", driverIds)
          : Promise.resolve({
              data: [] as Array<PartyRoleProfileSource & { photo_url?: string | null }>,
              error: null,
            }),
        restaurantIds.length
          ? supabase
              .from("restaurant_profiles")
              .select("user_id, restaurant_name, logo_url, avatar_url, cover_image_url")
              .in("user_id", restaurantIds)
          : Promise.resolve({ data: [] as RestaurantRow[], error: null }),
      ]);

    // Enrichment is best-effort: list still returns if party joins fail.
    if (!profilesRes.error && Array.isArray(profilesRes.data)) {
      for (const row of profilesRes.data as PartyProfileSource[]) {
        profilesById.set(String(row.id), row);
      }
    }
    if (!clientProfilesRes.error && Array.isArray(clientProfilesRes.data)) {
      for (const row of clientProfilesRes.data as PartyRoleProfileSource[]) {
        clientProfilesById.set(String(row.user_id), row);
      }
    }
    if (!driverProfilesRes.error && Array.isArray(driverProfilesRes.data)) {
      for (const row of driverProfilesRes.data as Array<
        PartyRoleProfileSource & { photo_url?: string | null }
      >) {
        driverProfilesById.set(String(row.user_id), {
          user_id: String(row.user_id),
          full_name: row.full_name ?? null,
          phone: row.phone ?? null,
          avatar_url: row.photo_url ?? row.avatar_url ?? null,
        });
      }
    }
    if (!restaurantsRes.error && Array.isArray(restaurantsRes.data)) {
      for (const row of restaurantsRes.data as RestaurantRow[]) {
        restaurantsByUserId.set(String(row.user_id), row);
      }
    }

    // Fill missing emails from auth lookup (same pattern as Admin Clients).
    const missingEmailIds = [...profilesById.values()]
      .filter((row) => !String(row.email ?? "").trim())
      .map((row) => String(row.id));
    if (missingEmailIds.length > 0) {
      const { data: emailRows } = await supabase.rpc("admin_lookup_user_emails", {
        p_ids: missingEmailIds,
      });
      if (Array.isArray(emailRows)) {
        for (const row of emailRows as Array<{ id: string; email: string | null }>) {
          const existing = profilesById.get(String(row.id));
          if (existing && !existing.email) {
            existing.email = row.email ?? null;
          }
        }
      }
    }

    const items: AdminFoodOrderListItem[] = rows.map((row) => {
      const clientKey = resolveClientUserId(row);
      const driverKey = String(row.driver_id ?? "").trim();
      const restaurantKey =
        String(row.restaurant_user_id ?? "").trim() ||
        String(row.restaurant_id ?? "").trim() ||
        "";
      const restaurant = restaurantKey ? restaurantsByUserId.get(restaurantKey) : undefined;
      const logo =
        resolvePublicAvatarUrl(
          restaurant?.logo_url ?? restaurant?.avatar_url ?? restaurant?.cover_image_url
        ) || null;

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
        client: buildAdminFoodOrderParty({
          profile: clientKey ? profilesById.get(clientKey) : null,
          roleProfile: clientKey ? clientProfilesById.get(clientKey) : null,
          preferRoleAvatar: true,
        }),
        driver: buildAdminFoodOrderParty({
          profile: driverKey ? profilesById.get(driverKey) : null,
          roleProfile: driverKey ? driverProfilesById.get(driverKey) : null,
          preferRoleAvatar: true,
        }),
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
