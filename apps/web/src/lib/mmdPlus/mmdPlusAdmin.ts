import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export async function writeMmdPlusAudit(params: {
  supabase: SupabaseClient;
  adminUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  userId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  request?: NextRequest;
}) {
  await params.supabase.from("mmd_plus_audit").insert({
    admin_user_id: params.adminUserId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    user_id: params.userId ?? null,
    old_value: params.oldValue ?? null,
    new_value: params.newValue ?? null,
    reason: params.reason ?? null,
    context: {},
  });

  if (params.request) {
    await writeAdminAuditServer({
      supabaseAdmin: params.supabase,
      adminUserId: params.adminUserId,
      action: params.action,
      targetType: params.entityType,
      targetId: params.entityId ?? params.userId ?? "unknown",
      metadata: {
        user_id: params.userId,
        old_value: params.oldValue,
        new_value: params.newValue,
        reason: params.reason,
        module: "mmd_plus",
      },
      request: params.request,
    });
  }
}
