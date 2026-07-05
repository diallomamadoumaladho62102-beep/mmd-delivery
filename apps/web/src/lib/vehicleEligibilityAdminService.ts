import type { SupabaseClient } from "@supabase/supabase-js";
import {
  notifyDriverDocumentStatusChange,
  notifyDriverEligibilityTransitions,
  notifyDriverVehicleEvent,
} from "@/lib/driverPushNotifications";

type EligibilityRow = {
  category: string;
  status: string;
  reason_message?: string | null;
};

export async function recalculateVehicleWithNotifications(
  supabaseAdmin: SupabaseClient,
  vehicleId: string,
  options?: {
    adminAction?: "approve_category" | "reject_category" | "suspend_category" | "unsuspend_category" | null;
    skipNotifications?: boolean;
  },
): Promise<{ driverUserId: string | null; notificationsSent: number }> {
  const { data, error } = await supabaseAdmin.rpc("recalculate_vehicle_category_eligibility", {
    p_vehicle_id: vehicleId,
  });

  if (error) {
    console.log("[vehicleEligibility] recalculate failed:", error.message);
    return { driverUserId: null, notificationsSent: 0 };
  }

  const payload = data as {
    ok?: boolean;
    driver_user_id?: string;
    before?: EligibilityRow[];
    after?: EligibilityRow[];
  };

  if (!payload?.ok || !payload.driver_user_id || options?.skipNotifications) {
    return { driverUserId: payload?.driver_user_id ?? null, notificationsSent: 0 };
  }

  const sent = await notifyDriverEligibilityTransitions({
    supabaseAdmin,
    driverUserId: payload.driver_user_id,
    before: payload.before ?? [],
    after: payload.after ?? [],
    adminAction: options?.adminAction ?? null,
  });

  return { driverUserId: payload.driver_user_id, notificationsSent: sent };
}

export async function notifyAdminCategoryAction(params: {
  supabaseAdmin: SupabaseClient;
  driverUserId: string;
  category: string;
  action: "approve_category" | "suspend_category" | "unsuspend_category" | "reject_vehicle";
  reason?: string | null;
}): Promise<number> {
  if (params.action === "approve_category") {
    return (
      await notifyDriverVehicleEvent({
        supabaseAdmin: params.supabaseAdmin,
        driverUserId: params.driverUserId,
        kind: "category_approved",
        category: params.category,
      })
    ).sent;
  }

  if (params.action === "suspend_category") {
    return (
      await notifyDriverVehicleEvent({
        supabaseAdmin: params.supabaseAdmin,
        driverUserId: params.driverUserId,
        kind: "category_suspended",
        category: params.category,
      })
    ).sent;
  }

  if (params.action === "unsuspend_category") {
    return (
      await notifyDriverVehicleEvent({
        supabaseAdmin: params.supabaseAdmin,
        driverUserId: params.driverUserId,
        kind: "category_reactivated",
        category: params.category,
      })
    ).sent;
  }

  return (
    await notifyDriverVehicleEvent({
      supabaseAdmin: params.supabaseAdmin,
      driverUserId: params.driverUserId,
      kind: "category_rejected",
      category: params.category,
      reason: params.reason ?? undefined,
    })
  ).sent;
}

export async function notifyAdminDocumentChanges(params: {
  supabaseAdmin: SupabaseClient;
  driverUserId: string;
  vehicleBefore: Record<string, unknown>;
  vehicleAfter: Record<string, unknown>;
}): Promise<number> {
  let sent = 0;
  const pairs: Array<["inspection" | "insurance" | "registration", string, string]> = [
    ["inspection", "inspection_status", String(params.vehicleBefore.inspection_status ?? "")],
    ["insurance", "insurance_status", String(params.vehicleBefore.insurance_status ?? "")],
    ["registration", "registration_status", String(params.vehicleBefore.registration_status ?? "")],
  ];

  for (const [docType, field, prev] of pairs) {
    const next = String(params.vehicleAfter[field] ?? "");
    if (prev === next) continue;
    sent += await notifyDriverDocumentStatusChange({
      supabaseAdmin: params.supabaseAdmin,
      driverUserId: params.driverUserId,
      documentType: docType,
      previousStatus: prev,
      nextStatus: next,
    });
  }

  return sent;
}
