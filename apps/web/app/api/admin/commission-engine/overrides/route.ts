import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  OVERRIDE_STATUSES,
  PARTNER_TYPES,
  SERVICES,
  cleanText,
  parseFixedFee,
  parseRatePct,
  validateDateRange,
  writeCommissionAudit,
} from "@/lib/commission/commissionAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("commissions.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const partnerType = String(params.get("partnerType") ?? "").trim();
    const partnerUserId = String(params.get("partnerUserId") ?? "").trim();
    const status = String(params.get("status") ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 100) || 100));

    let query = supabase
      .from("partner_commission_overrides")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (partnerType) query = query.eq("partner_type", partnerType);
    if (partnerUserId) query = query.eq("partner_user_id", partnerUserId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, overrides: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("commissions.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const partnerType = String(body.partner_type ?? "").trim();
    const partnerUserId = String(body.partner_user_id ?? "").trim();
    const reason = cleanText(body.reason, 500);
    if (!PARTNER_TYPES.has(partnerType)) return json({ ok: false, error: "Invalid partner_type" }, 400);
    if (!UUID_RE.test(partnerUserId)) return json({ ok: false, error: "Invalid partner_user_id" }, 400);
    if (!reason) return json({ ok: false, error: "Reason is required" }, 400);

    const rate = parseRatePct(body.rate_pct);
    if (rate == null) return json({ ok: false, error: "Invalid rate_pct (0-100)" }, 400);
    const fixed = body.fixed_fee_cents === undefined ? 0 : parseFixedFee(body.fixed_fee_cents);
    if (fixed == null) return json({ ok: false, error: "Invalid fixed_fee_cents" }, 400);

    let service: string | null = null;
    if (body.service != null && body.service !== "") {
      service = String(body.service);
      if (!SERVICES.has(service)) return json({ ok: false, error: "Invalid service" }, 400);
    }

    const status = String(body.status ?? "draft");
    if (!OVERRIDE_STATUSES.has(status)) return json({ ok: false, error: "Invalid status" }, 400);

    const dates = validateDateRange(body.starts_at, body.ends_at);
    if ("error" in dates) return json({ ok: false, error: dates.error }, 400);

    const row = {
      partner_type: partnerType,
      partner_user_id: partnerUserId,
      service,
      rate_pct: rate,
      fixed_fee_cents: fixed,
      status,
      reason,
      starts_at: dates.starts_at,
      ends_at: dates.ends_at,
      contract_id: body.contract_id ? String(body.contract_id) : null,
      campaign_id: body.campaign_id ? String(body.campaign_id) : null,
      created_by: session.userId,
    };

    const { data, error } = await supabase
      .from("partner_commission_overrides")
      .insert(row)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeCommissionAudit({
      supabase,
      adminUserId: session.userId,
      action: "partner_commission_override_created",
      entityType: "partner_commission_override",
      entityId: data?.id,
      partnerType,
      partnerUserId,
      newValue: data,
      reason,
      request,
    });

    return json({ ok: true, override: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("commissions.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const id = String(body.id ?? "").trim();
    if (!UUID_RE.test(id)) return json({ ok: false, error: "Invalid id" }, 400);
    const reason = cleanText(body.reason, 500);
    if (!reason) return json({ ok: false, error: "Reason is required" }, 400);

    const { data: existing } = await supabase
      .from("partner_commission_overrides")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return json({ ok: false, error: "Override not found" }, 404);

    const patch: Record<string, unknown> = {};
    if (body.rate_pct !== undefined) {
      const rate = parseRatePct(body.rate_pct);
      if (rate == null) return json({ ok: false, error: "Invalid rate_pct" }, 400);
      patch.rate_pct = rate;
    }
    if (body.fixed_fee_cents !== undefined) {
      const fixed = parseFixedFee(body.fixed_fee_cents);
      if (fixed == null) return json({ ok: false, error: "Invalid fixed_fee_cents" }, 400);
      patch.fixed_fee_cents = fixed;
    }
    if (body.status !== undefined) {
      const status = String(body.status);
      if (!OVERRIDE_STATUSES.has(status)) return json({ ok: false, error: "Invalid status" }, 400);
      patch.status = status;
    }
    if (body.service !== undefined) {
      if (body.service === null || body.service === "") patch.service = null;
      else if (!SERVICES.has(String(body.service))) return json({ ok: false, error: "Invalid service" }, 400);
      else patch.service = String(body.service);
    }
    if (body.starts_at !== undefined || body.ends_at !== undefined) {
      const dates = validateDateRange(
        body.starts_at !== undefined ? body.starts_at : existing.starts_at,
        body.ends_at !== undefined ? body.ends_at : existing.ends_at
      );
      if ("error" in dates) return json({ ok: false, error: dates.error }, 400);
      if (body.starts_at !== undefined) patch.starts_at = dates.starts_at;
      if (body.ends_at !== undefined) patch.ends_at = dates.ends_at;
    }
    if (body.reset_to_standard === true) {
      patch.status = "ended";
    }

    if (Object.keys(patch).length === 0) {
      return json({ ok: false, error: "No valid fields to update" }, 400);
    }

    const { data, error } = await supabase
      .from("partner_commission_overrides")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeCommissionAudit({
      supabase,
      adminUserId: session.userId,
      action: body.reset_to_standard
        ? "partner_commission_override_reset_to_standard"
        : "partner_commission_override_updated",
      entityType: "partner_commission_override",
      entityId: id,
      partnerType: existing.partner_type,
      partnerUserId: existing.partner_user_id,
      oldValue: existing,
      newValue: data,
      reason,
      request,
    });

    return json({ ok: true, override: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

/** Soft-delete: end the override (never hard-delete — history preserved). */
export async function DELETE(request: NextRequest) {
  try {
    const session = await assertStaffPermission("commissions.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    const reason = cleanText(body.reason, 500);
    if (!UUID_RE.test(id)) return json({ ok: false, error: "Invalid id" }, 400);
    if (!reason) return json({ ok: false, error: "Reason is required" }, 400);

    const { data: existing } = await supabase
      .from("partner_commission_overrides")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return json({ ok: false, error: "Override not found" }, 404);

    const { data, error } = await supabase
      .from("partner_commission_overrides")
      .update({ status: "ended" })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeCommissionAudit({
      supabase,
      adminUserId: session.userId,
      action: "partner_commission_override_ended",
      entityType: "partner_commission_override",
      entityId: id,
      partnerType: existing.partner_type,
      partnerUserId: existing.partner_user_id,
      oldValue: existing,
      newValue: data,
      reason,
      request,
    });

    return json({ ok: true, override: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
