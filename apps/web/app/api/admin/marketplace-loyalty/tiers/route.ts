import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function cleanText(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function buildTierPatch(
  body: Record<string, unknown>,
  { requireCore }: { requireCore: boolean }
): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};

  const code = cleanText(body.code, 40);
  const label = cleanText(body.label, 120);
  if (requireCore && (!code || !label)) return { error: "Missing code/label" };
  if (code) patch.code = code.toLowerCase();
  if (label) patch.label = label;
  if (body.country_code !== undefined) patch.country_code = cleanText(body.country_code, 8);

  const intFields = ["sort_order", "min_points", "min_completed_sales", "min_tenure_days"];
  for (const key of intFields) {
    if (body[key] !== undefined) {
      const n = Math.round(Number(body[key]));
      if (!Number.isFinite(n) || n < 0) return { error: `Invalid ${key}` };
      patch[key] = n;
    }
  }
  if (body.min_revenue_cents !== undefined) {
    const n = Math.round(Number(body.min_revenue_cents));
    if (!Number.isFinite(n) || n < 0) return { error: "Invalid min_revenue_cents" };
    patch.min_revenue_cents = n;
  }
  for (const key of ["min_avg_rating", "max_cancellation_rate", "max_refund_rate"]) {
    if (body[key] !== undefined) {
      patch[key] = body[key] === null ? null : Number(body[key]);
    }
  }
  if (typeof body.active === "boolean") patch.active = body.active;

  return { patch };
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("loyalty.marketplace.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("marketplace_loyalty_tiers")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, tiers: data ?? [] });
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

    const built = buildTierPatch(body, { requireCore: true });
    if ("error" in built) return json({ ok: false, error: built.error }, 400);

    const { data, error } = await supabase
      .from("marketplace_loyalty_tiers")
      .insert(built.patch)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "marketplace_loyalty_tier_created",
      targetType: "marketplace_loyalty_tier",
      targetId: String(data?.id ?? ""),
      metadata: { tier: data },
      request,
    });

    return json({ ok: true, tier: data });
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

    const built = buildTierPatch(body, { requireCore: false });
    if ("error" in built) return json({ ok: false, error: built.error }, 400);
    if (Object.keys(built.patch).length === 0) {
      return json({ ok: false, error: "No valid fields to update" }, 400);
    }

    const { data, error } = await supabase
      .from("marketplace_loyalty_tiers")
      .update(built.patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "Tier not found" }, 404);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "marketplace_loyalty_tier_updated",
      targetType: "marketplace_loyalty_tier",
      targetId: id,
      metadata: { patch: built.patch },
      request,
    });

    return json({ ok: true, tier: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
