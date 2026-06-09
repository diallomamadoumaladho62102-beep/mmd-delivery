import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiRides,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const REWARD_SELECT =
  "id, title, description, points_cost, discount_cents, tier_required, active, max_redemptions, redemption_count, created_at, updated_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_rides.read", request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("taxi_loyalty_rewards")
      .select(REWARD_SELECT)
      .order("created_at", { ascending: false });

    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, items: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertCanManageTaxiRides(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const row = {
      title: String(body.title ?? "").trim(),
      description: typeof body.description === "string" ? body.description : null,
      points_cost: Math.round(Number(body.points_cost ?? body.pointsCost ?? 0)),
      discount_cents: Math.round(Number(body.discount_cents ?? body.discountCents ?? 0)),
      tier_required:
        typeof body.tier_required === "string" ? body.tier_required : null,
      active: body.active !== false,
      max_redemptions:
        body.max_redemptions != null
          ? Math.round(Number(body.max_redemptions))
          : null,
    };

    if (!row.title || row.points_cost <= 0 || row.discount_cents <= 0) {
      return json({ ok: false, error: "Invalid reward payload" }, 400);
    }

    const { data, error } = await supabase
      .from("taxi_loyalty_rewards")
      .insert(row)
      .select(REWARD_SELECT)
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_loyalty_reward_created",
      targetType: "taxi_loyalty_reward",
      targetId: String(data?.id ?? ""),
      newValues: (data ?? row) as Record<string, unknown>,
      request,
    });

    return json({ ok: true, item: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertCanManageTaxiRides(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "Missing id" }, 400);

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.title === "string") update.title = body.title;
    if (typeof body.description === "string") update.description = body.description;
    if (body.points_cost != null) update.points_cost = Math.round(Number(body.points_cost));
    if (body.discount_cents != null) {
      update.discount_cents = Math.round(Number(body.discount_cents));
    }
    if (typeof body.active === "boolean") update.active = body.active;
    if (body.tier_required !== undefined) {
      update.tier_required = body.tier_required ? String(body.tier_required) : null;
    }

    const { data, error } = await supabase
      .from("taxi_loyalty_rewards")
      .update(update)
      .eq("id", id)
      .select(REWARD_SELECT)
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_loyalty_reward_updated",
      targetType: "taxi_loyalty_reward",
      targetId: id,
      newValues: (data ?? update) as Record<string, unknown>,
      request,
    });

    return json({ ok: true, item: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
