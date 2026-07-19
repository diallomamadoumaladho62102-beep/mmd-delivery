import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeMmdPlusAudit } from "@/lib/mmdPlus/mmdPlusAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

const PERIODS = new Set(["monthly", "yearly"]);
const STATUSES = new Set(["draft", "active", "retired"]);

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("mmd_plus.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("mmd_plus_plans")
      .select("*")
      .order("sort_order");
    if (error) return json({ ok: false, error: error.message }, 500);

    const { data: features } = await supabase
      .from("mmd_plus_features")
      .select("*")
      .order("sort_order");

    return json({ ok: true, plans: data ?? [], features: features ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("mmd_plus.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "upsert").trim();

    if (action === "retire" || action === "deactivate") {
      const planId = String(body.plan_id ?? "").trim();
      if (!planId) return json({ ok: false, error: "Missing plan_id" }, 400);
      const { data: old } = await supabase
        .from("mmd_plus_plans")
        .select("*")
        .eq("id", planId)
        .maybeSingle();
      const { error } = await supabase
        .from("mmd_plus_plans")
        .update({ status: "retired", visible: false, updated_at: new Date().toISOString() })
        .eq("id", planId);
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeMmdPlusAudit({
        supabase,
        adminUserId: session.userId,
        action: "plan_retire",
        entityType: "mmd_plus_plan",
        entityId: planId,
        oldValue: old,
        newValue: { status: "retired" },
        reason: cleanText(body.reason, 500) ?? "admin_retire",
        request,
      });
      return json({ ok: true });
    }

    if (action === "activate") {
      const planId = String(body.plan_id ?? "").trim();
      if (!planId) return json({ ok: false, error: "Missing plan_id" }, 400);
      const { error } = await supabase
        .from("mmd_plus_plans")
        .update({ status: "active", visible: true, updated_at: new Date().toISOString() })
        .eq("id", planId);
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeMmdPlusAudit({
        supabase,
        adminUserId: session.userId,
        action: "plan_activate",
        entityType: "mmd_plus_plan",
        entityId: planId,
        reason: cleanText(body.reason, 500) ?? "admin_activate",
        request,
      });
      return json({ ok: true });
    }

    const code = cleanText(body.code, 40)?.toLowerCase();
    const name = cleanText(body.name, 120);
    if (!code || !name) return json({ ok: false, error: "Missing code/name" }, 400);

    const period = String(body.billing_period ?? "monthly");
    if (!PERIODS.has(period)) return json({ ok: false, error: "Invalid billing_period" }, 400);

    const status = String(body.status ?? "draft");
    if (!STATUSES.has(status)) return json({ ok: false, error: "Invalid status" }, 400);

    const payload = {
      code,
      name,
      description: cleanText(body.description, 500),
      price_cents: Math.max(0, Math.round(Number(body.price_cents ?? 0))),
      currency: String(body.currency ?? "USD").toUpperCase().slice(0, 3),
      billing_period: period,
      trial_enabled: body.trial_enabled === true,
      trial_days: Math.max(0, Math.round(Number(body.trial_days ?? 0))),
      status,
      country_code: cleanText(body.country_code, 8)?.toUpperCase() ?? null,
      city: cleanText(body.city, 80),
      color: cleanText(body.color, 32),
      sort_order: Math.round(Number(body.sort_order ?? 0)),
      visible: body.visible !== false,
      stripe_product_id: cleanText(body.stripe_product_id, 120),
      stripe_price_id: cleanText(body.stripe_price_id, 120),
      updated_at: new Date().toISOString(),
    };

    const planId = String(body.plan_id ?? "").trim();
    if (planId) {
      const { data: old } = await supabase
        .from("mmd_plus_plans")
        .select("*")
        .eq("id", planId)
        .maybeSingle();
      const { data, error } = await supabase
        .from("mmd_plus_plans")
        .update(payload)
        .eq("id", planId)
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeMmdPlusAudit({
        supabase,
        adminUserId: session.userId,
        action: "plan_update",
        entityType: "mmd_plus_plan",
        entityId: planId,
        oldValue: old,
        newValue: data,
        reason: cleanText(body.reason, 500) ?? "admin_update",
        request,
      });
      return json({ ok: true, plan: data });
    }

    const { data, error } = await supabase
      .from("mmd_plus_plans")
      .insert({ ...payload, created_by: session.userId })
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    await writeMmdPlusAudit({
      supabase,
      adminUserId: session.userId,
      action: "plan_create",
      entityType: "mmd_plus_plan",
      entityId: data?.id,
      newValue: data,
      reason: cleanText(body.reason, 500) ?? "admin_create",
      request,
    });
    return json({ ok: true, plan: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
