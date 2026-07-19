import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const NUMERIC_FIELDS = new Set([
  "points_per_delivery",
  "points_per_ride",
  "conversion_points",
  "conversion_credit_cents",
  "referral_points_client",
  "referral_points_driver",
]);

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("loyalty.read", request);
    const supabase = buildSupabaseAdminClient();

    const [{ data: settings, error: sErr }, { data: tiers, error: tErr }] =
      await Promise.all([
        supabase.from("loyalty_settings").select("*").eq("singleton", true).maybeSingle(),
        supabase
          .from("loyalty_tiers")
          .select("id, code, label, min_lifetime_points, sort_order, active")
          .order("sort_order", { ascending: true }),
      ]);

    if (sErr) return json({ ok: false, error: sErr.message }, 500);
    if (tErr) return json({ ok: false, error: tErr.message }, 500);

    return json({ ok: true, settings: settings ?? null, tiers: tiers ?? [] });
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

    const patch: Record<string, unknown> = {};

    if (typeof body.enabled === "boolean") {
      patch.enabled = body.enabled;
    }

    for (const field of NUMERIC_FIELDS) {
      if (body[field] !== undefined) {
        const value = Math.round(Number(body[field]));
        if (!Number.isFinite(value) || value < 0) {
          return json({ ok: false, error: `Invalid ${field}` }, 400);
        }
        if (
          (field === "conversion_points" || field === "conversion_credit_cents") &&
          value < 1
        ) {
          return json({ ok: false, error: `${field} must be >= 1` }, 400);
        }
        patch[field] = value;
      }
    }

    if (body.credit_validity_months !== undefined) {
      const months = Math.round(Number(body.credit_validity_months));
      if (![0, 6, 12].includes(months)) {
        return json({ ok: false, error: "credit_validity_months must be 0, 6 or 12" }, 400);
      }
      patch.credit_validity_months = months;
    }

    if (typeof body.currency === "string" && body.currency.trim()) {
      patch.currency = body.currency.trim().slice(0, 8).toUpperCase();
    }

    if (Object.keys(patch).length === 0) {
      return json({ ok: false, error: "No valid fields to update" }, 400);
    }

    const { data: before } = await supabase
      .from("loyalty_settings")
      .select("*")
      .eq("singleton", true)
      .maybeSingle();

    const { data, error } = await supabase
      .from("loyalty_settings")
      .update(patch)
      .eq("singleton", true)
      .select("*")
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "loyalty_config_updated",
      targetType: "loyalty_settings",
      targetId: "singleton",
      metadata: { patch },
      oldValues: (before ?? {}) as Record<string, unknown>,
      newValues: (data ?? {}) as Record<string, unknown>,
      request,
    });

    return json({ ok: true, settings: data ?? null });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
