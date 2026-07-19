import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { cleanText, writeSubscriptionAudit } from "@/lib/subscriptions/subscriptionAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const PARTNER_TYPES = new Set(["restaurant", "seller", "driver", "business"]);
const PERIODS = new Set(["monthly", "yearly"]);
const STATUSES = new Set(["draft", "active", "retired"]);

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("subscriptions.read", request);
    const supabase = buildSupabaseAdminClient();
    const partnerType = String(request.nextUrl.searchParams.get("partnerType") ?? "").trim();
    let query = supabase.from("subscription_plans").select("*").order("sort_order");
    if (partnerType) query = query.eq("partner_type", partnerType);
    const { data, error } = await query.limit(300);
    if (error) return json({ ok: false, error: error.message }, 500);

    const { data: features } = await supabase
      .from("subscription_features")
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
    const session = await assertStaffPermission("subscriptions.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const partnerType = String(body.partner_type ?? "").trim();
    const code = cleanText(body.code, 40)?.toLowerCase();
    const name = cleanText(body.name, 120);
    if (!PARTNER_TYPES.has(partnerType)) return json({ ok: false, error: "Invalid partner_type" }, 400);
    if (!code || !name) return json({ ok: false, error: "Missing code/name" }, 400);

    const period = String(body.billing_period ?? "monthly");
    if (!PERIODS.has(period)) return json({ ok: false, error: "Invalid billing_period" }, 400);
    const price = Math.round(Number(body.price_cents ?? 0));
    if (!Number.isFinite(price) || price < 0) return json({ ok: false, error: "Invalid price_cents" }, 400);
    const status = String(body.status ?? "draft");
    if (!STATUSES.has(status)) return json({ ok: false, error: "Invalid status" }, 400);

    const row = {
      partner_type: partnerType,
      code,
      name,
      description: cleanText(body.description, 2000),
      price_cents: price,
      currency: cleanText(body.currency, 8)?.toUpperCase() || "USD",
      billing_period: period,
      trial_enabled: body.trial_enabled === true,
      trial_days: Math.max(0, Math.round(Number(body.trial_days ?? 0)) || 0),
      status,
      country_code: cleanText(body.country_code, 8)?.toUpperCase() ?? null,
      city: cleanText(body.city, 120),
      category: cleanText(body.category, 120),
      color: cleanText(body.color, 40),
      sort_order: Math.round(Number(body.sort_order ?? 0)) || 0,
      visible: body.visible !== false,
      stripe_product_id: cleanText(body.stripe_product_id, 120),
      stripe_price_id: cleanText(body.stripe_price_id, 120),
      created_by: session.userId,
    };

    const { data, error } = await supabase.from("subscription_plans").insert(row).select("*").maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    // Optional feature matrix on create
    if (Array.isArray(body.features)) {
      const featureRows = body.features
        .map((f) => {
          if (!f || typeof f !== "object") return null;
          const fr = f as Record<string, unknown>;
          const key = cleanText(fr.feature_key, 80);
          if (!key) return null;
          return {
            plan_id: data!.id,
            feature_key: key,
            enabled: fr.enabled !== false,
            value_boolean: typeof fr.value_boolean === "boolean" ? fr.value_boolean : null,
            value_integer:
              fr.value_integer == null ? null : Math.round(Number(fr.value_integer)),
            value_numeric: fr.value_numeric == null ? null : Number(fr.value_numeric),
            value_text: cleanText(fr.value_text, 500),
            value_json: fr.value_json ?? null,
          };
        })
        .filter(Boolean);
      if (featureRows.length > 0) {
        await supabase.from("subscription_plan_features").insert(featureRows);
      }
    }

    await writeSubscriptionAudit({
      supabase,
      adminUserId: session.userId,
      action: "subscription_plan_created",
      entityType: "subscription_plan",
      entityId: data?.id,
      partnerType,
      newValue: data,
      reason: cleanText(body.reason, 500),
      request,
    });

    return json({ ok: true, plan: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("subscriptions.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "Missing id" }, 400);
    const reason = cleanText(body.reason, 500);
    if (!reason) return json({ ok: false, error: "Reason is required" }, 400);

    const { data: existing } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return json({ ok: false, error: "Plan not found" }, 404);

    // Soft-delete = retire
    if (body.retire === true || body.status === "retired") {
      const { data, error } = await supabase
        .from("subscription_plans")
        .update({ status: "retired", visible: false })
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeSubscriptionAudit({
        supabase,
        adminUserId: session.userId,
        action: "subscription_plan_retired",
        entityType: "subscription_plan",
        entityId: id,
        oldValue: existing,
        newValue: data,
        reason,
        request,
      });
      return json({ ok: true, plan: data });
    }

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = cleanText(body.name, 120);
    if (body.description !== undefined) patch.description = cleanText(body.description, 2000);
    if (body.price_cents !== undefined) {
      const price = Math.round(Number(body.price_cents));
      if (!Number.isFinite(price) || price < 0) return json({ ok: false, error: "Invalid price" }, 400);
      patch.price_cents = price;
    }
    if (body.status !== undefined) {
      if (!STATUSES.has(String(body.status))) return json({ ok: false, error: "Invalid status" }, 400);
      patch.status = String(body.status);
    }
    if (typeof body.visible === "boolean") patch.visible = body.visible;
    if (typeof body.trial_enabled === "boolean") patch.trial_enabled = body.trial_enabled;
    if (body.trial_days !== undefined) patch.trial_days = Math.max(0, Math.round(Number(body.trial_days)) || 0);
    if (body.stripe_price_id !== undefined) patch.stripe_price_id = cleanText(body.stripe_price_id, 120);
    if (body.stripe_product_id !== undefined) patch.stripe_product_id = cleanText(body.stripe_product_id, 120);
    if (body.color !== undefined) patch.color = cleanText(body.color, 40);
    if (body.sort_order !== undefined) patch.sort_order = Math.round(Number(body.sort_order)) || 0;

    if (Object.keys(patch).length === 0 && !Array.isArray(body.features)) {
      return json({ ok: false, error: "No valid fields" }, 400);
    }

    let data = existing;
    if (Object.keys(patch).length > 0) {
      const res = await supabase.from("subscription_plans").update(patch).eq("id", id).select("*").maybeSingle();
      if (res.error) return json({ ok: false, error: res.error.message }, 500);
      data = res.data;
    }

    if (Array.isArray(body.features)) {
      await supabase.from("subscription_plan_features").delete().eq("plan_id", id);
      const featureRows = body.features
        .map((f) => {
          if (!f || typeof f !== "object") return null;
          const fr = f as Record<string, unknown>;
          const key = cleanText(fr.feature_key, 80);
          if (!key) return null;
          return {
            plan_id: id,
            feature_key: key,
            enabled: fr.enabled !== false,
            value_boolean: typeof fr.value_boolean === "boolean" ? fr.value_boolean : true,
            value_integer: fr.value_integer == null ? null : Math.round(Number(fr.value_integer)),
            value_numeric: fr.value_numeric == null ? null : Number(fr.value_numeric),
            value_text: cleanText(fr.value_text, 500),
            value_json: fr.value_json ?? null,
          };
        })
        .filter(Boolean);
      if (featureRows.length > 0) {
        await supabase.from("subscription_plan_features").insert(featureRows);
      }
    }

    await writeSubscriptionAudit({
      supabase,
      adminUserId: session.userId,
      action: "subscription_plan_updated",
      entityType: "subscription_plan",
      entityId: id,
      oldValue: existing,
      newValue: data,
      reason,
      request,
    });

    return json({ ok: true, plan: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
