import { supabase } from "@/lib/supabaseBrowser";

export type AdminAuditAction =
  | "driver_approved"
  | "driver_rejected"
  | "restaurant_approved"
  | "restaurant_rejected"
  | "payout_retry"
  | "payout_resolved"
  | "payout_reviewed";

export type AdminAuditLogInput = {
  adminUserId: string;
  action: AdminAuditAction;
  targetType: "driver" | "restaurant" | "payout" | "order";
  targetId: string;
  metadata?: Record<string, any>;
};

/**
 * 🧾 Écrit un log d’action admin dans la base
 * Version client-safe (compatible avec les pages "use client")
 */
export async function writeAdminAuditLog(
  input: AdminAuditLogInput
): Promise<void> {
  try {
    const { error } = await supabase.from("admin_audit_logs").insert({
      admin_user_id: input.adminUserId,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      metadata: input.metadata ?? {},
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("❌ admin audit log insert error:", error.message);
    }
  } catch (err) {
    console.error("❌ admin audit log unexpected error:", err);
  }
}