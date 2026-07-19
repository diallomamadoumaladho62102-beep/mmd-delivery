import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export async function writeMarketingAudit(params: {
  supabase: SupabaseClient;
  adminUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  campaignId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  correlationId?: string | null;
  request?: NextRequest;
}) {
  const ip =
    params.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    params.request?.headers.get("x-real-ip") ||
    null;

  await params.supabase.from("marketing_audit").insert({
    admin_user_id: params.adminUserId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    campaign_id: params.campaignId ?? null,
    old_value: params.oldValue ?? null,
    new_value: params.newValue ?? null,
    reason: params.reason ?? null,
    ip_address: ip,
    correlation_id: params.correlationId ?? null,
    source: "admin",
    context: {},
  });

  if (params.request) {
    await writeAdminAuditServer({
      supabaseAdmin: params.supabase,
      adminUserId: params.adminUserId,
      action: params.action,
      targetType: params.entityType,
      targetId: params.entityId ?? params.campaignId ?? "unknown",
      metadata: {
        campaign_id: params.campaignId,
        old_value: params.oldValue,
        new_value: params.newValue,
        reason: params.reason,
        module: "marketing",
      },
      request: params.request,
    });
  }
}

export function normalizePromoCodeInput(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Reject trivially guessable private codes. */
export function isGuessablePromoCode(code: string): boolean {
  const c = normalizePromoCodeInput(code);
  if (c.length < 8) return true;
  if (/^(TEST|PROMO|CODE|MMD|FREE|SALE)\d*$/i.test(c)) return true;
  if (/^[A-Z]{1,3}\d{1,3}$/.test(c)) return true;
  if (/^(.)\1+$/.test(c)) return true;
  return false;
}

export function generateSecurePromoCode(prefix = "MMD"): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let body = "";
  for (let i = 0; i < 10; i += 1) {
    body += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}${body}`;
}
