import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const CRITERIA = new Set([
  "first_completed_order",
  "completed_orders_count",
  "revenue_reached",
  "avg_rating",
  "acceptance_rate",
  "cancellation_rate",
  "prep_time_compliance",
  "campaign_participation",
  "menu_complete",
  "profile_up_to_date",
  "valid_documents",
  "tenure",
  "custom",
]);
const PERIODS = new Set(["once", "lifetime", "daily", "weekly", "monthly"]);
const STATUSES = new Set(["draft", "active", "suspended", "ended"]);

function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function buildRulePatch(
  body: Record<string, unknown>,
  { requireCore }: { requireCore: boolean }
): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};

  const name = cleanText(body.name);
  if (requireCore && !name) return { error: "Missing name" };
  if (name) patch.name = name;
  if (body.description !== undefined) patch.description = cleanText(body.description, 1000);

  if (body.criterion !== undefined || requireCore) {
    const criterion = String(body.criterion ?? "");
    if (!CRITERIA.has(criterion)) return { error: "Invalid criterion" };
    patch.criterion = criterion;
  }
  if (body.period !== undefined) {
    const period = String(body.period);
    if (!PERIODS.has(period)) return { error: "Invalid period" };
    patch.period = period;
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!STATUSES.has(status)) return { error: "Invalid status" };
    patch.status = status;
  }

  if (body.threshold !== undefined) {
    const t = Number(body.threshold);
    if (!Number.isFinite(t) || t < 0) return { error: "Invalid threshold" };
    patch.threshold = t;
  }
  if (body.points !== undefined) {
    const p = Math.round(Number(body.points));
    if (!Number.isFinite(p) || p < 0) return { error: "Invalid points" };
    patch.points = p;
  }

  for (const key of ["country_code", "city"]) {
    if (body[key] !== undefined) patch[key] = cleanText(body[key], 120);
  }
  if (body.restaurant_user_id !== undefined) {
    patch.restaurant_user_id = body.restaurant_user_id === null ? null : cleanText(body.restaurant_user_id, 40);
  }
  for (const key of ["starts_at", "ends_at"]) {
    if (body[key] !== undefined) patch[key] = body[key] === null ? null : cleanText(body[key], 40);
  }
  for (const key of ["global_quota", "per_restaurant_quota"]) {
    if (body[key] !== undefined) {
      if (body[key] === null) {
        patch[key] = null;
      } else {
        const n = Math.round(Number(body[key]));
        if (!Number.isFinite(n) || n < 0) return { error: `Invalid ${key}` };
        patch[key] = n;
      }
    }
  }

  return { patch };
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("loyalty.restaurant.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("restaurant_loyalty_rules")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, rules: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("loyalty.restaurant.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const built = buildRulePatch(body, { requireCore: true });
    if ("error" in built) return json({ ok: false, error: built.error }, 400);

    const { data, error } = await supabase
      .from("restaurant_loyalty_rules")
      .insert({ ...built.patch, created_by: session.userId })
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "restaurant_loyalty_rule_created",
      targetType: "restaurant_loyalty_rule",
      targetId: String(data?.id ?? ""),
      metadata: { rule: data },
      request,
    });

    return json({ ok: true, rule: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("loyalty.restaurant.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "Missing id" }, 400);

    const built = buildRulePatch(body, { requireCore: false });
    if ("error" in built) return json({ ok: false, error: built.error }, 400);
    if (Object.keys(built.patch).length === 0) {
      return json({ ok: false, error: "No valid fields to update" }, 400);
    }

    const { data, error } = await supabase
      .from("restaurant_loyalty_rules")
      .update(built.patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "Rule not found" }, 404);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "restaurant_loyalty_rule_updated",
      targetType: "restaurant_loyalty_rule",
      targetId: id,
      metadata: { patch: built.patch },
      request,
    });

    return json({ ok: true, rule: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
