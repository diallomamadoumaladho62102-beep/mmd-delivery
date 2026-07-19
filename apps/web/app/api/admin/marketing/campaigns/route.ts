import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeMarketingAudit } from "@/lib/marketing/marketingAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const status = String(params.get("status") ?? "").trim();
    const service = String(params.get("service") ?? "").trim();
    const type = String(params.get("type") ?? "").trim();
    const q = String(params.get("q") ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 100) || 100));

    let query = supabase
      .from("marketing_campaigns")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    if (type) query = query.eq("campaign_type", type);
    if (service) query = query.contains("services", [service]);
    if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const { data: types } = await supabase
      .from("marketing_campaign_types")
      .select("*")
      .order("sort_order");

    return json({ ok: true, campaigns: data ?? [], types: types ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("marketing.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "upsert").trim();
    const reason = cleanText(body.reason, 500) ?? "admin_action";

    if (action === "set_status") {
      const campaignId = String(body.campaign_id ?? "").trim();
      const status = String(body.status ?? "").trim();
      if (!campaignId || !status) return json({ ok: false, error: "Missing campaign/status" }, 400);
      const { data: old } = await supabase
        .from("marketing_campaigns")
        .select("*")
        .eq("id", campaignId)
        .maybeSingle();
      const { data, error } = await supabase
        .from("marketing_campaigns")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", campaignId)
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeMarketingAudit({
        supabase,
        adminUserId: session.userId,
        action: `campaign_${status}`,
        entityType: "marketing_campaign",
        entityId: campaignId,
        campaignId,
        oldValue: old,
        newValue: data,
        reason,
        request,
      });
      return json({ ok: true, campaign: data });
    }

    if (action === "duplicate") {
      const campaignId = String(body.campaign_id ?? "").trim();
      const { data: src } = await supabase
        .from("marketing_campaigns")
        .select("*")
        .eq("id", campaignId)
        .maybeSingle();
      if (!src) return json({ ok: false, error: "not_found" }, 404);
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = src as Record<string, unknown>;
      const { data, error } = await supabase
        .from("marketing_campaigns")
        .insert({
          ...rest,
          code: `${String(src.code)}_copy_${Date.now().toString(36)}`,
          name: `${src.name} (copie)`,
          status: "draft",
          created_by: session.userId,
        })
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeMarketingAudit({
        supabase,
        adminUserId: session.userId,
        action: "campaign_duplicate",
        entityType: "marketing_campaign",
        entityId: data?.id,
        campaignId: data?.id,
        newValue: data,
        reason,
        request,
      });
      return json({ ok: true, campaign: data });
    }

    const code = cleanText(body.code, 60)?.toLowerCase()?.replace(/\s+/g, "_");
    const name = cleanText(body.name, 160);
    const campaignType = cleanText(body.campaign_type, 80);
    if (!code || !name || !campaignType) {
      return json({ ok: false, error: "Missing code/name/type" }, 400);
    }

    const payload = {
      code,
      name,
      description: cleanText(body.description, 1000),
      campaign_type: campaignType,
      status: String(body.status ?? "draft"),
      priority: Math.round(Number(body.priority ?? 100)),
      services: Array.isArray(body.services) ? body.services : ["food"],
      audiences: Array.isArray(body.audiences) ? body.audiences : ["client"],
      country_code: cleanText(body.country_code, 8)?.toUpperCase() ?? null,
      city: cleanText(body.city, 80),
      starts_at: body.starts_at ? String(body.starts_at) : null,
      ends_at: body.ends_at ? String(body.ends_at) : null,
      currency: String(body.currency ?? "USD").toUpperCase().slice(0, 3),
      min_order_cents: Math.max(0, Math.round(Number(body.min_order_cents ?? 0))),
      discount_percent:
        body.discount_percent == null ? null : Number(body.discount_percent),
      discount_cents:
        body.discount_cents == null ? null : Math.round(Number(body.discount_cents)),
      max_discount_cents:
        body.max_discount_cents == null
          ? null
          : Math.round(Number(body.max_discount_cents)),
      budget_total_cents:
        body.budget_total_cents == null
          ? null
          : Math.round(Number(body.budget_total_cents)),
      per_user_limit:
        body.per_user_limit == null ? null : Math.round(Number(body.per_user_limit)),
      requires_code: body.requires_code === true,
      auto_apply: body.auto_apply === true,
      requires_mmd_plus: body.requires_mmd_plus === true,
      first_order_only: body.first_order_only === true,
      stackable: body.stackable === true,
      visible: body.visible !== false,
      funder: String(body.funder ?? "mmd"),
      updated_at: new Date().toISOString(),
    };

    const campaignId = String(body.campaign_id ?? "").trim();
    if (campaignId) {
      const { data: old } = await supabase
        .from("marketing_campaigns")
        .select("*")
        .eq("id", campaignId)
        .maybeSingle();
      const { data, error } = await supabase
        .from("marketing_campaigns")
        .update(payload)
        .eq("id", campaignId)
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeMarketingAudit({
        supabase,
        adminUserId: session.userId,
        action: "campaign_update",
        entityType: "marketing_campaign",
        entityId: campaignId,
        campaignId,
        oldValue: old,
        newValue: data,
        reason,
        request,
      });
      return json({ ok: true, campaign: data });
    }

    const { data, error } = await supabase
      .from("marketing_campaigns")
      .insert({ ...payload, created_by: session.userId })
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    await writeMarketingAudit({
      supabase,
      adminUserId: session.userId,
      action: "campaign_create",
      entityType: "marketing_campaign",
      entityId: data?.id,
      campaignId: data?.id,
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
