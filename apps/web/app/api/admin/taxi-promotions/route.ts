import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiPromotions,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const PROMO_SELECT =
  "id, code, promotion_type, discount_percent, discount_cents, active, starts_at, ends_at, max_redemptions, max_redemptions_per_user, redemption_count, title, notes, created_at, updated_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_promotions.read", request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("taxi_promotions")
      .select(PROMO_SELECT)
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
    const session = await assertCanManageTaxiPromotions(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const code = String(body.code ?? "").trim().toUpperCase();
    const promotionType = String(body.promotion_type ?? body.promotionType ?? "").trim();

    if (!code || !promotionType) {
      return json({ ok: false, error: "Missing code or promotion_type" }, 400);
    }

    const row = {
      code,
      promotion_type: promotionType,
      discount_percent:
        body.discount_percent != null ? Number(body.discount_percent) : null,
      discount_cents:
        body.discount_cents != null ? Math.round(Number(body.discount_cents)) : null,
      active: body.active !== false,
      starts_at: body.starts_at
        ? String(body.starts_at)
        : new Date().toISOString(),
      ends_at: body.ends_at ? String(body.ends_at) : null,
      max_redemptions:
        body.max_redemptions != null
          ? Math.round(Number(body.max_redemptions))
          : null,
      max_redemptions_per_user:
        body.max_redemptions_per_user != null
          ? Math.round(Number(body.max_redemptions_per_user))
          : null,
      title: typeof body.title === "string" ? body.title : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    };

    const { data, error } = await supabase
      .from("taxi_promotions")
      .insert(row)
      .select(PROMO_SELECT)
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_promotion_created",
      targetType: "taxi_promotion",
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
    const session = await assertCanManageTaxiPromotions(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "Missing id" }, 400);

    const { data: existing, error: readErr } = await supabase
      .from("taxi_promotions")
      .select(PROMO_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "Promotion not found" }, 404);

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.code === "string") update.code = body.code.trim().toUpperCase();
    if (typeof body.promotion_type === "string") {
      update.promotion_type = body.promotion_type;
    }
    if (body.discount_percent != null) {
      update.discount_percent = Number(body.discount_percent);
    }
    if (body.discount_cents != null) {
      update.discount_cents = Math.round(Number(body.discount_cents));
    }
    if (typeof body.active === "boolean") update.active = body.active;
    if (body.starts_at != null) update.starts_at = String(body.starts_at);
    if (body.ends_at !== undefined) {
      update.ends_at = body.ends_at ? String(body.ends_at) : null;
    }
    if (body.max_redemptions !== undefined) {
      update.max_redemptions =
        body.max_redemptions != null
          ? Math.round(Number(body.max_redemptions))
          : null;
    }
    if (body.max_redemptions_per_user !== undefined) {
      update.max_redemptions_per_user =
        body.max_redemptions_per_user != null
          ? Math.round(Number(body.max_redemptions_per_user))
          : null;
    }
    if (typeof body.title === "string") update.title = body.title;
    if (typeof body.notes === "string") update.notes = body.notes;

    const { data: updated, error: updateErr } = await supabase
      .from("taxi_promotions")
      .update(update)
      .eq("id", id)
      .select(PROMO_SELECT)
      .maybeSingle();

    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_promotion_updated",
      targetType: "taxi_promotion",
      targetId: id,
      oldValues: existing as Record<string, unknown>,
      newValues: (updated ?? update) as Record<string, unknown>,
      request,
    });

    return json({ ok: true, item: updated });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
