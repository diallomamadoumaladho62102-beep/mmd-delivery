import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanWriteTaxiPricing,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const PRICING_SELECT =
  "id, config_key, vehicle_class, country_code, currency, active, base_fare, per_mile, per_minute, min_fare, booking_fee, driver_share_pct, platform_share_pct, class_multiplier, max_passengers, notes, updated_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_pricing.read", request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("taxi_pricing")
      .select(PRICING_SELECT)
      .order("vehicle_class", { ascending: true });

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

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertCanWriteTaxiPricing(request);
    const supabase = buildSupabaseAdminClient();
    const body = await request.json().catch(() => ({}));

    const id = String((body as { id?: string }).id ?? "").trim();
    if (!id) return json({ ok: false, error: "Missing id" }, 400);

    const { data: existing, error: readErr } = await supabase
      .from("taxi_pricing")
      .select(PRICING_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "Pricing row not found" }, 404);

    const patch = body as Record<string, unknown>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    const numericFields = [
      "base_fare",
      "per_mile",
      "per_minute",
      "min_fare",
      "booking_fee",
      "driver_share_pct",
      "platform_share_pct",
      "class_multiplier",
      "max_passengers",
    ] as const;

    for (const field of numericFields) {
      if (patch[field] != null) {
        update[field] = Number(patch[field]);
      }
    }

    if (typeof patch.active === "boolean") update.active = patch.active;
    if (typeof patch.notes === "string") update.notes = patch.notes;

    const { data: updated, error: updateErr } = await supabase
      .from("taxi_pricing")
      .update(update)
      .eq("id", id)
      .select(PRICING_SELECT)
      .maybeSingle();

    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_pricing_updated",
      targetType: "taxi_pricing",
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
