import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminAuditAction =
  | "driver_approved"
  | "driver_rejected"
  | "driver_suspended"
  | "driver_disabled"
  | "restaurant_approved"
  | "restaurant_rejected"
  | "payout_retry"
  | "payout_resolved"
  | "payout_reviewed"
  | "pricing_updated"
  | "admin_role_changed"
  | "order_cancel_refund"
  | "dispatch_triggered"
  | "stripe_sync"
  | string;

export type WriteAdminAuditInput = {
  supabaseAdmin: SupabaseClient;
  adminUserId: string;
  action: AdminAuditAction;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  request?: NextRequest;
};

function getClientIp(request?: NextRequest): string | null {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() ?? null;
}

export async function writeAdminAuditServer(
  input: WriteAdminAuditInput
): Promise<void> {
  const {
    supabaseAdmin,
    adminUserId,
    action,
    targetType,
    targetId,
    metadata,
    oldValues,
    newValues,
    request,
  } = input;

  const row: Record<string, unknown> = {
    admin_user_id: adminUserId,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata: metadata ?? {},
    created_at: new Date().toISOString(),
  };

  const ip = getClientIp(request);
  if (ip) row.ip_address = ip;
  if (oldValues) row.old_values = oldValues;
  if (newValues) row.new_values = newValues;

  const { error } = await supabaseAdmin.from("admin_audit_logs").insert(row);

  if (error) {
    console.error("[adminAuditServer] insert failed", {
      action,
      targetType,
      targetId,
      message: error.message,
    });
  }
}
