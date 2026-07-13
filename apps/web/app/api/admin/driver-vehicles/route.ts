import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiDrivers,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { type TaxiCategory } from "@/lib/driverServicePreferencesTypes";
import {
  notifyAdminCategoryAction,
  notifyAdminDocumentChanges,
  recalculateVehicleWithNotifications,
} from "@/lib/vehicleEligibilityAdminService";
import { safeRequestJson } from "@/lib/safeRequestJson";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_drivers.read", request);
    const supabase = buildSupabaseAdminClient();
    const q = request.nextUrl.searchParams.get("q")?.trim();

    const { data: vehicles, error } = await supabase
      .from("driver_vehicles")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) return json({ ok: false, error: error.message }, 500);

    const driverIds = Array.from(
      new Set((vehicles ?? []).map((v) => String(v.driver_user_id)).filter(Boolean)),
    );

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, phone")
      .in("id", driverIds);

    const { data: eligibility } = await supabase
      .from("vehicle_category_eligibility")
      .select("*")
      .in("driver_user_id", driverIds);

    const { data: rules } = await supabase
      .from("vehicle_category_rules")
      .select("*")
      .eq("is_active", true)
      .order("category");

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    const eligibilityByVehicle = new Map<string, NonNullable<typeof eligibility>>();

    for (const row of eligibility ?? []) {
      const key = String(row.vehicle_id);
      const list = eligibilityByVehicle.get(key) ?? [];
      list.push(row);
      eligibilityByVehicle.set(key, list);
    }

    let items = (vehicles ?? []).map((vehicle) => ({
      ...vehicle,
      profile: profileMap.get(vehicle.driver_user_id) ?? null,
      categories: eligibilityByVehicle.get(String(vehicle.id)) ?? [],
    }));

    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((item) => {
        const name = String(item.profile?.full_name ?? "").toLowerCase();
        const plate = String(item.license_plate ?? "").toLowerCase();
        return name.includes(needle) || plate.includes(needle);
      });
    }

    return json({ ok: true, items, rules: rules ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status,
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertCanManageTaxiDrivers(request);
    const supabase = buildSupabaseAdminClient();
    const parsed = await safeRequestJson<Record<string, any>>(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const vehicleId = String(body.vehicle_id ?? body.vehicleId ?? "").trim();
    const category = String(body.category ?? "").trim() as TaxiCategory;
    const action = String(body.action ?? "").trim();

    if (!vehicleId) return json({ ok: false, error: "vehicle_id_required" }, 400);

    const { data: vehicle, error: vehicleError } = await supabase
      .from("driver_vehicles")
      .select("*")
      .eq("id", vehicleId)
      .maybeSingle();

    if (vehicleError) return json({ ok: false, error: vehicleError.message }, 500);
    if (!vehicle) return json({ ok: false, error: "vehicle_not_found" }, 404);

    let notificationsSent = 0;
    const vehicleBefore = { ...vehicle };

    if (action === "approve_vehicle") {
      const vehicleAfter = {
        admin_review_status: "approved",
        // Approving a vehicle must also make it operationally selectable. The driver
        // "set active vehicle" RPC (set_driver_active_vehicle) requires
        // vehicle_status = 'active'; without flipping it here an approved vehicle
        // stays 'pending_review' forever and can never be selected as active.
        vehicle_status: "active",
        inspection_status: body.inspection_status ?? "approved",
        insurance_status: body.insurance_status ?? "approved",
        registration_status: body.registration_status ?? "approved",
        wheelchair_equipment_verified:
          body.wheelchair_equipment_verified ?? vehicle.wheelchair_equipment_verified,
        updated_at: new Date().toISOString(),
      };

      await supabase.from("driver_vehicles").update(vehicleAfter).eq("id", vehicleId);

      notificationsSent += await notifyAdminDocumentChanges({
        supabaseAdmin: supabase,
        driverUserId: String(vehicle.driver_user_id),
        vehicleBefore,
        vehicleAfter: { ...vehicleBefore, ...vehicleAfter },
      });

      const recalc = await recalculateVehicleWithNotifications(supabase, vehicleId);
      notificationsSent += recalc.notificationsSent;
    }

    if (action === "reject_vehicle") {
      await supabase
        .from("driver_vehicles")
        .update({
          admin_review_status: "rejected",
          vehicle_status: "rejected",
          admin_review_notes: String(body.notes ?? ""),
          updated_at: new Date().toISOString(),
        })
        .eq("id", vehicleId);

      notificationsSent += await notifyAdminCategoryAction({
        supabaseAdmin: supabase,
        driverUserId: String(vehicle.driver_user_id),
        category: category || "standard",
        action: "reject_vehicle",
        reason: String(body.notes ?? "Véhicule non conforme"),
      });
    }

    if (action === "suspend_vehicle") {
      await supabase
        .from("driver_vehicles")
        .update({
          vehicle_status: "suspended",
          vehicle_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", vehicleId);

      await supabase.rpc("log_driver_vehicle_history", {
        p_driver_user_id: vehicle.driver_user_id,
        p_vehicle_id: vehicleId,
        p_action: "vehicle_suspended",
        p_actor_user_id: session.userId,
        p_metadata: { notes: body.notes ?? null },
      });

      notificationsSent += await notifyAdminCategoryAction({
        supabaseAdmin: supabase,
        driverUserId: String(vehicle.driver_user_id),
        category: category || "standard",
        action: "suspend_category",
        reason: String(body.notes ?? "Véhicule suspendu"),
      });
    }

    if (action === "reactivate_vehicle") {
      await supabase
        .from("driver_vehicles")
        .update({
          vehicle_status: "active",
          vehicle_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", vehicleId);

      await supabase.rpc("log_driver_vehicle_history", {
        p_driver_user_id: vehicle.driver_user_id,
        p_vehicle_id: vehicleId,
        p_action: "vehicle_reactivated",
        p_actor_user_id: session.userId,
        p_metadata: {},
      });

      const recalc = await recalculateVehicleWithNotifications(supabase, vehicleId, {
        adminAction: "unsuspend_category",
      });
      notificationsSent += recalc.notificationsSent;
    }

    if (category && ["approve_category", "suspend_category", "unsuspend_category"].includes(action)) {
      const patch: Record<string, unknown> = { computed_at: new Date().toISOString() };

      if (action === "approve_category") {
        patch.admin_approved = true;
        patch.admin_suspended = false;
        patch.status = "eligible";
        patch.reason_code = null;
        patch.reason_message = null;
      } else if (action === "suspend_category") {
        patch.admin_suspended = true;
        patch.status = "suspended";
        patch.reason_code = "admin_suspended";
        patch.reason_message = "Category suspended by admin";
      } else if (action === "unsuspend_category") {
        patch.admin_suspended = false;
      }

      await supabase
        .from("vehicle_category_eligibility")
        .update(patch)
        .eq("vehicle_id", vehicleId)
        .eq("category", category);

      if (action === "unsuspend_category") {
        const recalc = await recalculateVehicleWithNotifications(supabase, vehicleId, {
          adminAction: "unsuspend_category",
        });
        notificationsSent += recalc.notificationsSent;
      } else {
        notificationsSent += await notifyAdminCategoryAction({
          supabaseAdmin: supabase,
          driverUserId: String(vehicle.driver_user_id),
          category,
          action: action as "approve_category" | "suspend_category" | "unsuspend_category",
        });
      }
    }

    if (body.rule_patch && body.rule_id) {
      await supabase
        .from("vehicle_category_rules")
        .update({ ...body.rule_patch, updated_at: new Date().toISOString() })
        .eq("id", body.rule_id);

      const { data: allVehicles } = await supabase
        .from("driver_vehicles")
        .select("id")
        .eq("vehicle_active", true);

      for (const row of allVehicles ?? []) {
        const recalc = await recalculateVehicleWithNotifications(supabase, String(row.id));
        notificationsSent += recalc.notificationsSent;
      }
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: `driver_vehicle_${action}`,
      targetType: "driver_vehicle",
      targetId: vehicleId,
      metadata: { category, driver_user_id: vehicle.driver_user_id, notifications_sent: notificationsSent },
      request,
    });

    return json({ ok: true, notifications_sent: notificationsSent });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status,
    );
  }
}
