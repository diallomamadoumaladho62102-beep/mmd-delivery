import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import {
  buildAdminFoodOrderParty,
  resolvePublicAvatarUrl,
  type AdminFoodOrderParty,
  type PartyProfileSource,
  type PartyRoleProfileSource,
} from "@/lib/adminFoodOrderDisplay";
import type {
  AdminTaxiRideListItem,
  AdminTaxiRideVehicle,
} from "@/lib/adminTaxiRideDisplay";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { applyLiveTripFilters } from "@/lib/tripVisibility";

export const dynamic = "force-dynamic";

const VEHICLE_BUCKETS = ["driver-docs", "driver-documents", "avatars"] as const;
const SIGNED_TTL = 60 * 60;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function uniqIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))];
}

async function signPath(
  supabase: ReturnType<typeof buildSupabaseAdminClient>,
  filePath: string
): Promise<string | null> {
  const raw = String(filePath ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  for (const bucket of VEHICLE_BUCKETS) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(raw, SIGNED_TTL);
    if (!error && data?.signedUrl) return data.signedUrl;
  }
  return resolvePublicAvatarUrl(raw);
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_rides.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 100), 1), 200);
    const status = params.get("status")?.trim();
    const vehicleClass = params.get("vehicle_class")?.trim();
    const paymentStatus = params.get("payment_status")?.trim();
    const q = params.get("q")?.trim();

    let query = supabase
      .from("taxi_rides")
      .select(
        [
          "id",
          "status",
          "vehicle_class",
          "payment_status",
          "refund_status",
          "total_cents",
          "currency",
          "client_user_id",
          "driver_id",
          "pickup_address",
          "dropoff_address",
          "pickup_city",
          "distance_miles",
          "duration_minutes",
          "next_ride_eta_minutes",
          "created_at",
          "completed_at",
          "accepted_at",
          "driver_arrived_at",
          "started_at",
          "updated_at",
        ].join(", ")
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status && status !== "searching") query = query.eq("status", status);
    if (status === "searching") {
      query = query.in("status", [
        "dispatching",
        "paid",
        "pending_payment",
        "quoted",
        "draft",
        "scheduled",
        "queued",
      ]);
    }
    if (vehicleClass) query = query.eq("vehicle_class", vehicleClass);
    if (paymentStatus) query = query.eq("payment_status", paymentStatus);
    if (q) {
      const safeQ = q.replace(/[%_,]/g, "");
      if (/^[0-9a-f-]{8,}$/i.test(safeQ)) {
        query = query.or(
          `id.eq.${safeQ},pickup_address.ilike.%${safeQ}%,dropoff_address.ilike.%${safeQ}%`
        );
      } else if (safeQ) {
        query = query.or(
          `pickup_address.ilike.%${safeQ}%,dropoff_address.ilike.%${safeQ}%,pickup_city.ilike.%${safeQ}%`
        );
      }
    }

    const { data, error } = await applyLiveTripFilters(query);
    if (error) return json({ ok: false, error: error.message }, 500);

    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return json({
        ok: true,
        items: [],
        page: { limit, returned: 0, hasMore: false, nextCursor: null },
      });
    }

    const clientIds = uniqIds(rows.map((r) => r.client_user_id as string | null));
    const driverIds = uniqIds(rows.map((r) => r.driver_id as string | null));
    const profileIds = uniqIds([...clientIds, ...driverIds]);

    const profilesById = new Map<string, PartyProfileSource>();
    const clientProfilesById = new Map<string, PartyRoleProfileSource>();
    const driverProfilesById = new Map<
      string,
      PartyRoleProfileSource & { is_online?: boolean | null; transport_mode?: string | null }
    >();
    const vehicleByDriver = new Map<string, Record<string, unknown>>();

    const [profilesRes, clientProfilesRes, driverProfilesRes, vehiclesRes] =
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
              .select("user_id, full_name, phone, photo_url, is_online, transport_mode")
              .in("user_id", driverIds)
          : Promise.resolve({
              data: [] as Array<
                PartyRoleProfileSource & {
                  photo_url?: string | null;
                  is_online?: boolean | null;
                  transport_mode?: string | null;
                }
              >,
              error: null,
            }),
        driverIds.length
          ? supabase
              .from("driver_vehicles")
              .select(
                "id, driver_user_id, photo_url, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, vehicle_type, is_primary, updated_at"
              )
              .in("driver_user_id", driverIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

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
        PartyRoleProfileSource & {
          photo_url?: string | null;
          is_online?: boolean | null;
          transport_mode?: string | null;
        }
      >) {
        driverProfilesById.set(String(row.user_id), {
          user_id: String(row.user_id),
          full_name: row.full_name ?? null,
          phone: row.phone ?? null,
          avatar_url: row.photo_url ?? row.avatar_url ?? null,
          is_online: row.is_online ?? null,
          transport_mode: row.transport_mode ?? null,
        });
      }
    }
    if (!vehiclesRes.error && Array.isArray(vehiclesRes.data)) {
      for (const v of vehiclesRes.data as Array<Record<string, unknown>>) {
        const uid = String(v.driver_user_id ?? "");
        if (!uid) continue;
        const existing = vehicleByDriver.get(uid);
        if (!existing || v.is_primary === true) {
          vehicleByDriver.set(uid, v);
        }
      }
    }

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
          if (existing && row.email) {
            profilesById.set(String(row.id), { ...existing, email: row.email });
          }
        }
      }
    }

    const items: AdminTaxiRideListItem[] = await Promise.all(
      rows.map(async (r) => {
        const clientId = String(r.client_user_id ?? "").trim();
        const driverId = String(r.driver_id ?? "").trim();
        const client: AdminFoodOrderParty | null = clientId
          ? buildAdminFoodOrderParty({
              profile: profilesById.get(clientId) ?? null,
              roleProfile: clientProfilesById.get(clientId) ?? null,
              preferRoleAvatar: true,
            })
          : null;
        const driverRole = driverId ? driverProfilesById.get(driverId) ?? null : null;
        const driver: AdminFoodOrderParty | null = driverId
          ? buildAdminFoodOrderParty({
              profile: profilesById.get(driverId) ?? null,
              roleProfile: driverRole,
              preferRoleAvatar: true,
            })
          : null;

        const vehRaw = driverId ? vehicleByDriver.get(driverId) : undefined;
        let vehicle: AdminTaxiRideVehicle | null = null;
        if (vehRaw) {
          const photo = await signPath(supabase, String(vehRaw.photo_url ?? ""));
          vehicle = {
            id: String(vehRaw.id ?? "") || null,
            photo_url: photo,
            vehicle_type:
              (vehRaw.vehicle_type as string | null) ??
              (driverRole?.transport_mode as string | null) ??
              null,
            make: (vehRaw.vehicle_make as string | null) ?? null,
            model: (vehRaw.vehicle_model as string | null) ?? null,
            year:
              vehRaw.vehicle_year != null ? Number(vehRaw.vehicle_year) : null,
            color: (vehRaw.vehicle_color as string | null) ?? null,
            plate: (vehRaw.license_plate as string | null) ?? null,
          };
        }

        return {
          id: String(r.id),
          status: (r.status as string | null) ?? null,
          vehicle_class: (r.vehicle_class as string | null) ?? null,
          payment_status: (r.payment_status as string | null) ?? null,
          refund_status: (r.refund_status as string | null) ?? null,
          total_cents: r.total_cents != null ? Number(r.total_cents) : null,
          currency: (r.currency as string | null) ?? null,
          client_user_id: clientId || null,
          driver_id: driverId || null,
          pickup_address: (r.pickup_address as string | null) ?? null,
          dropoff_address: (r.dropoff_address as string | null) ?? null,
          pickup_city: (r.pickup_city as string | null) ?? null,
          distance_miles:
            r.distance_miles != null ? Number(r.distance_miles) : null,
          duration_minutes:
            r.duration_minutes != null ? Number(r.duration_minutes) : null,
          next_ride_eta_minutes:
            r.next_ride_eta_minutes != null
              ? Number(r.next_ride_eta_minutes)
              : null,
          created_at: String(r.created_at ?? ""),
          completed_at: (r.completed_at as string | null) ?? null,
          accepted_at: (r.accepted_at as string | null) ?? null,
          driver_arrived_at: (r.driver_arrived_at as string | null) ?? null,
          started_at: (r.started_at as string | null) ?? null,
          updated_at: (r.updated_at as string | null) ?? null,
          driver_is_online:
            driverRole?.is_online == null ? null : Boolean(driverRole.is_online),
          client,
          driver,
          vehicle,
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
