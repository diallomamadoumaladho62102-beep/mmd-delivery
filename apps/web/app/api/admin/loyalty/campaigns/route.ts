import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const AUDIENCES = new Set(["client", "driver", "both"]);
const VERTICALS = new Set(["any", "food", "taxi", "marketplace", "delivery"]);
const BONUS_TYPES = new Set(["flat", "multiplier"]);

function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function buildCampaignPatch(
  body: Record<string, unknown>,
  { requireName }: { requireName: boolean }
): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};

  const name = cleanText(body.name);
  if (requireName && !name) return { error: "Missing name" };
  if (name) patch.name = name;

  if (body.description !== undefined) patch.description = cleanText(body.description, 1000);

  if (body.audience !== undefined) {
    const audience = String(body.audience);
    if (!AUDIENCES.has(audience)) return { error: "Invalid audience" };
    patch.audience = audience;
  }
  if (body.vertical !== undefined) {
    const vertical = String(body.vertical);
    if (!VERTICALS.has(vertical)) return { error: "Invalid vertical" };
    patch.vertical = vertical;
  }
  if (body.bonus_type !== undefined) {
    const bonusType = String(body.bonus_type);
    if (!BONUS_TYPES.has(bonusType)) return { error: "Invalid bonus_type" };
    patch.bonus_type = bonusType;
  }

  if (body.bonus_points !== undefined) {
    const bonus = Math.round(Number(body.bonus_points));
    if (!Number.isFinite(bonus) || bonus < 0) return { error: "Invalid bonus_points" };
    patch.bonus_points = bonus;
  }
  if (body.multiplier !== undefined) {
    const mult = Number(body.multiplier);
    if (!Number.isFinite(mult) || mult < 0) return { error: "Invalid multiplier" };
    patch.multiplier = mult;
  }

  for (const key of ["country_code", "city", "restaurant_id", "category"]) {
    if (body[key] !== undefined) patch[key] = cleanText(body[key], 120);
  }

  if (body.days_of_week !== undefined) {
    if (!Array.isArray(body.days_of_week)) return { error: "Invalid days_of_week" };
    const days = body.days_of_week
      .map((d) => Math.round(Number(d)))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    patch.days_of_week = days;
  }

  for (const key of ["hour_start", "hour_end"]) {
    if (body[key] !== undefined) {
      if (body[key] === null) {
        patch[key] = null;
      } else {
        const hour = Math.round(Number(body[key]));
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
          return { error: `Invalid ${key}` };
        }
        patch[key] = hour;
      }
    }
  }

  for (const key of ["starts_at", "ends_at"]) {
    if (body[key] !== undefined) {
      patch[key] = body[key] === null ? null : cleanText(body[key], 40);
    }
  }

  if (body.max_uses !== undefined) {
    if (body.max_uses === null) {
      patch.max_uses = null;
    } else {
      const maxUses = Math.round(Number(body.max_uses));
      if (!Number.isFinite(maxUses) || maxUses < 0) return { error: "Invalid max_uses" };
      patch.max_uses = maxUses;
    }
  }

  if (typeof body.active === "boolean") patch.active = body.active;

  return { patch };
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("loyalty.read", request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("loyalty_campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, campaigns: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("loyalty.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const built = buildCampaignPatch(body, { requireName: true });
    if ("error" in built) return json({ ok: false, error: built.error }, 400);

    const insert = { ...built.patch, created_by: session.userId };
    const { data, error } = await supabase
      .from("loyalty_campaigns")
      .insert(insert)
      .select("*")
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "loyalty_campaign_created",
      targetType: "loyalty_campaign",
      targetId: String(data?.id ?? ""),
      metadata: { campaign: data },
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
    const session = await assertStaffPermission("loyalty.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "Missing id" }, 400);

    const built = buildCampaignPatch(body, { requireName: false });
    if ("error" in built) return json({ ok: false, error: built.error }, 400);
    if (Object.keys(built.patch).length === 0) {
      return json({ ok: false, error: "No valid fields to update" }, 400);
    }

    const { data, error } = await supabase
      .from("loyalty_campaigns")
      .update(built.patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "Campaign not found" }, 404);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "loyalty_campaign_updated",
      targetType: "loyalty_campaign",
      targetId: id,
      metadata: { patch: built.patch },
      request,
    });

    return json({ ok: true, campaign: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
