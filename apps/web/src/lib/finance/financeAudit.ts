import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export async function writeFinanceAudit(params: {
  supabase: SupabaseClient;
  adminUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  reason?: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  request?: NextRequest;
  metadata?: Record<string, unknown>;
}) {
  const ip =
    params.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    params.request?.headers.get("x-real-ip") ||
    null;

  await params.supabase.from("finance_audit").insert({
    admin_user_id: params.adminUserId ?? null,
    action: params.action,
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
    reason: params.reason ?? null,
    correlation_id: params.correlationId ?? null,
    idempotency_key: params.idempotencyKey ?? null,
    old_value: params.oldValue ?? null,
    new_value: params.newValue ?? null,
    ip_address: ip,
    user_agent: params.request?.headers.get("user-agent") ?? null,
    metadata: params.metadata ?? {},
  });

  if (params.request && params.adminUserId) {
    await writeAdminAuditServer({
      supabaseAdmin: params.supabase,
      adminUserId: params.adminUserId,
      action: `finance_${params.action}`,
      targetType: params.entityType ?? "finance",
      targetId: params.entityId ?? "n/a",
      metadata: params.metadata ?? {},
      request: params.request,
    });
  }
}
