import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export async function writeAnalyticsAudit(params: {
  supabase: SupabaseClient;
  adminUserId: string;
  action: string;
  module?: string | null;
  format?: string | null;
  filters?: Record<string, unknown>;
  rowCount?: number | null;
  correlationId?: string | null;
  request?: NextRequest;
  metadata?: Record<string, unknown>;
}) {
  const ip =
    params.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    params.request?.headers.get("x-real-ip") ||
    null;
  const ua = params.request?.headers.get("user-agent") ?? null;

  await params.supabase.from("analytics_audit").insert({
    admin_user_id: params.adminUserId,
    action: params.action,
    module: params.module ?? null,
    format: params.format ?? null,
    filters: params.filters ?? {},
    row_count: params.rowCount ?? null,
    correlation_id: params.correlationId ?? null,
    ip_address: ip,
    user_agent: ua,
    metadata: params.metadata ?? {},
  });

  if (params.request) {
    await writeAdminAuditServer({
      supabaseAdmin: params.supabase,
      adminUserId: params.adminUserId,
      action: `analytics_${params.action}`,
      targetType: "analytics",
      targetId: params.module ?? "global",
      metadata: {
        format: params.format,
        filters: params.filters,
        row_count: params.rowCount,
        module: params.module,
      },
      request: params.request,
    });
  }
}
