import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiExchangeRates,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const SELECT =
  "id, from_currency, to_currency, rate, source, active, metadata, updated_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_exchange_rates.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("taxi_exchange_rates")
      .select(SELECT)
      .order("from_currency", { ascending: true })
      .order("to_currency", { ascending: true });

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
    const session = await assertCanManageTaxiExchangeRates(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "Missing id" }, 400);

    const { data: existing, error: readErr } = await supabase
      .from("taxi_exchange_rates")
      .select(SELECT)
      .eq("id", id)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "Rate not found" }, 404);

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.rate != null) update.rate = Number(body.rate);
    if (typeof body.active === "boolean") update.active = body.active;
    if (typeof body.source === "string") update.source = body.source;

    const { data: updated, error: updateErr } = await supabase
      .from("taxi_exchange_rates")
      .update(update)
      .eq("id", id)
      .select(SELECT)
      .maybeSingle();

    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_exchange_rate_updated",
      targetType: "taxi_exchange_rates",
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
