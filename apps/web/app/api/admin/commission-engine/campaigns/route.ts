import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  CAMPAIGN_STATUSES,
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
    const status = String(params.get("status") ?? "").trim();
    const partnerType = String(params.get("partnerType") ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 100) || 100));

    let query = supabase
      .from("commercial_campaigns")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    if (partnerType) query = query.eq("partner_type", partnerType);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, campaigns: data ?? [] });
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

    const name = cleanText(body.name, 200);
    if (!name) return json({ ok: false, error: "Missing name" }, 400);
    const rate = parseRatePct(body.rate_pct);
    if (rate == null) return json({ ok: false, error: "Invalid rate_pct" }, 400);
    const fixed = body.fixed_fee_cents === undefined ? 0 : parseFixedFee(body.fixed_fee_cents);
    if (fixed == null) return json({ ok: false, error: "Invalid fixed_fee_cents" }, 400);

    let partnerType: string | null = null;
    if (body.partner_type != null && body.partner_type !== "") {
      partnerType = String(body.partner_type);
      if (!PARTNER_TYPES.has(partnerType)) return json({ ok: false, error: "Invalid partner_type" }, 400);
    }
    let service: string | null = null;
    if (body.service != null && body.service !== "") {
      service = String(body.service);
      if (!SERVICES.has(service)) return json({ ok: false, error: "Invalid service" }, 400);
    }

    const status = String(body.status ?? "draft");
    if (!CAMPAIGN_STATUSES.has(status)) return json({ ok: false, error: "Invalid status" }, 400);

    const dates = validateDateRange(body.starts_at, body.ends_at);
    if ("error" in dates) return json({ ok: false, error: dates.error }, 400);

    const row = {
      name,
      partner_type: partnerType,
      service,
      category: cleanText(body.category, 120),
      country_code: cleanText(body.country_code, 8)?.toUpperCase() ?? null,
      city: cleanText(body.city, 120),
      rate_pct: rate,
      fixed_fee_cents: fixed,
      starts_at: dates.starts_at,
      ends_at: dates.ends_at,
      status,
      reason: cleanText(body.reason, 500),
      created_by: session.userId,
    };

    const { data, error } = await supabase
      .from("commercial_campaigns")
      .insert(row)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeCommissionAudit({
      supabase,
      adminUserId: session.userId,
      action: "commercial_campaign_created",
      entityType: "commercial_campaign",
      entityId: data?.id,
      newValue: data,
      reason: row.reason,
      request,
    });

    return json({ ok: true, campaign: data });
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
      .from("commercial_campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return json({ ok: false, error: "Campaign not found" }, 404);

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = cleanText(body.name, 200);
      if (!name) return json({ ok: false, error: "Invalid name" }, 400);
      patch.name = name;
    }
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
      if (!CAMPAIGN_STATUSES.has(String(body.status))) {
        return json({ ok: false, error: "Invalid status" }, 400);
      }
      patch.status = String(body.status);
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
    for (const key of ["category", "city"] as const) {
      if (body[key] !== undefined) patch[key] = cleanText(body[key], 120);
    }
    if (body.country_code !== undefined) {
      patch.country_code = cleanText(body.country_code, 8)?.toUpperCase() ?? null;
    }

    if (Object.keys(patch).length === 0) {
      return json({ ok: false, error: "No valid fields to update" }, 400);
    }

    const { data, error } = await supabase
      .from("commercial_campaigns")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeCommissionAudit({
      supabase,
      adminUserId: session.userId,
      action: "commercial_campaign_updated",
      entityType: "commercial_campaign",
      entityId: id,
      oldValue: existing,
      newValue: data,
      reason,
      request,
    });

    return json({ ok: true, campaign: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
