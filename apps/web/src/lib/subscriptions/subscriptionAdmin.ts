import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export async function writeSubscriptionAudit(params: {
  supabase: SupabaseClient;
  adminUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  partnerType?: string | null;
  partnerUserId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  request?: NextRequest;
}) {
  await params.supabase.from("subscription_audit").insert({
    admin_user_id: params.adminUserId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    partner_type: params.partnerType ?? null,
    partner_user_id: params.partnerUserId ?? null,
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
      targetId: params.entityId ?? params.partnerUserId ?? "unknown",
      metadata: {
        partner_type: params.partnerType,
        partner_user_id: params.partnerUserId,
        old_value: params.oldValue,
        new_value: params.newValue,
        reason: params.reason,
      },
      request: params.request,
    });
  }
}

export function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}
