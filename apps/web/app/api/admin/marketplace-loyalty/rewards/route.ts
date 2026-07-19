import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const BENEFIT_TYPES = new Set([
  "marketplace_fee_credit",
  "commission_discount",
  "priority_placement",
  "sponsored_product",
  "recommended_badge",
  "ad_credit",
  "free_promotion",
  "advanced_tools",
  "extra_visibility",
  "custom",
]);
const STATUSES = new Set(["draft", "active", "suspended", "ended"]);

function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function buildRewardPatch(
  body: Record<string, unknown>,
  { requireCore }: { requireCore: boolean }
): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};

  const name = cleanText(body.name);
  if (requireCore && !name) return { error: "Missing name" };
  if (name) patch.name = name;
  if (body.description !== undefined) patch.description = cleanText(body.description, 1000);

  if (body.benefit_type !== undefined || requireCore) {
    const benefitType = String(body.benefit_type ?? "");
    if (!BENEFIT_TYPES.has(benefitType)) return { error: "Invalid benefit_type" };
    patch.benefit_type = benefitType;
  }
  if (body.points_cost !== undefined || requireCore) {
    const pc = Math.round(Number(body.points_cost));
    if (!Number.isFinite(pc) || pc <= 0) return { error: "Invalid points_cost" };
    patch.points_cost = pc;
  }
  if (body.benefit_value !== undefined) {
    const v = Number(body.benefit_value);
    if (!Number.isFinite(v) || v < 0) return { error: "Invalid benefit_value" };
    patch.benefit_value = v;
  }
  if (typeof body.benefit_currency === "string" && body.benefit_currency.trim()) {
    patch.benefit_currency = body.benefit_currency.trim().slice(0, 8).toUpperCase();
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!STATUSES.has(status)) return { error: "Invalid status" };
    patch.status = status;
  }

  if (body.duration_days !== undefined) {
    if (body.duration_days === null) {
      patch.duration_days = null;
    } else {
      const n = Math.round(Number(body.duration_days));
      if (!Number.isFinite(n) || n < 0) return { error: "Invalid duration_days" };
      patch.duration_days = n;
    }
  }
  for (const key of ["country_code", "city", "category"]) {
    if (body[key] !== undefined) patch[key] = cleanText(body[key], 120);
  }
  for (const key of ["starts_at", "ends_at"]) {
    if (body[key] !== undefined) patch[key] = body[key] === null ? null : cleanText(body[key], 40);
  }
  if (body.max_redemptions !== undefined) {
    if (body.max_redemptions === null) {
      patch.max_redemptions = null;
    } else {
      const n = Math.round(Number(body.max_redemptions));
      if (!Number.isFinite(n) || n < 0) return { error: "Invalid max_redemptions" };
      patch.max_redemptions = n;
    }
  }
  if (body.eligible_seller_ids !== undefined) {
    if (body.eligible_seller_ids === null) {
      patch.eligible_seller_ids = null;
    } else if (Array.isArray(body.eligible_seller_ids)) {
      patch.eligible_seller_ids = body.eligible_seller_ids.map((v) => String(v).trim()).filter(Boolean);
    } else {
      return { error: "Invalid eligible_seller_ids" };
    }
  }
  if (body.conditions !== undefined && typeof body.conditions === "object" && body.conditions !== null) {
    patch.conditions = body.conditions;
  }

  return { patch };
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("loyalty.marketplace.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("marketplace_rewards")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, rewards: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("loyalty.marketplace.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const built = buildRewardPatch(body, { requireCore: true });
    if ("error" in built) return json({ ok: false, error: built.error }, 400);

    const { data, error } = await supabase
      .from("marketplace_rewards")
      .insert({ ...built.patch, created_by: session.userId })
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "marketplace_reward_created",
      targetType: "marketplace_reward",
      targetId: String(data?.id ?? ""),
      metadata: { reward: data },
      request,
    });

    return json({ ok: true, reward: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("loyalty.marketplace.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "Missing id" }, 400);

    const built = buildRewardPatch(body, { requireCore: false });
    if ("error" in built) return json({ ok: false, error: built.error }, 400);
    if (Object.keys(built.patch).length === 0) {
      return json({ ok: false, error: "No valid fields to update" }, 400);
    }

    const { data, error } = await supabase
      .from("marketplace_rewards")
      .update(built.patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "Reward not found" }, 404);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "marketplace_reward_updated",
      targetType: "marketplace_reward",
      targetId: id,
      metadata: { patch: built.patch },
      request,
    });

    return json({ ok: true, reward: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
