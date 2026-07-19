import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export async function writeCommissionAudit(params: {
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
  context?: Record<string, unknown>;
}) {
  const { error } = await params.supabase.from("commission_rule_audit").insert({
    admin_user_id: params.adminUserId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    partner_type: params.partnerType ?? null,
    partner_user_id: params.partnerUserId ?? null,
    old_value: params.oldValue ?? null,
    new_value: params.newValue ?? null,
    reason: params.reason ?? null,
    context: params.context ?? {},
  });

  if (error) {
    console.error("[commission-audit] insert failed", error.message);
  }

  // Also mirror into the global admin audit log when a request is available.
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
        ...(params.context ?? {}),
      },
      request: params.request,
    });
  }
}

export function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function parseRatePct(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 10000) / 10000;
}

export function parseFixedFee(value: unknown): number | null {
  if (value === undefined) return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export const PARTNER_TYPES = new Set(["restaurant", "seller"]);
export const SERVICES = new Set(["food", "marketplace"]);
export const OVERRIDE_STATUSES = new Set([
  "draft",
  "active",
  "suspended",
  "scheduled",
  "ended",
]);
export const CONTRACT_STATUSES = new Set(["draft", "active", "suspended", "expired"]);
export const CAMPAIGN_STATUSES = new Set(["draft", "active", "suspended", "ended"]);

export function validateDateRange(
  startsAt: unknown,
  endsAt: unknown
): { starts_at: string | null; ends_at: string | null } | { error: string } {
  const starts =
    startsAt === null || startsAt === undefined || startsAt === ""
      ? null
      : cleanText(startsAt, 40);
  const ends =
    endsAt === null || endsAt === undefined || endsAt === ""
      ? null
      : cleanText(endsAt, 40);
  if (starts && ends && new Date(starts).getTime() > new Date(ends).getTime()) {
    return { error: "starts_at must be before ends_at" };
  }
  return { starts_at: starts, ends_at: ends };
}
