import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiTaxes,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const SELECT =
  "id, country_code, tax_name, tax_rate, active, applies_to, metadata, updated_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_taxes.read", request);
    const supabase = buildSupabaseAdminClient();
    const countryCode = String(
      request.nextUrl.searchParams.get("country_code") ?? ""
    )
      .trim()
      .toUpperCase();

    let query = supabase
      .from("taxi_country_taxes")
      .select(SELECT)
      .order("country_code", { ascending: true })
      .order("tax_name", { ascending: true });

    if (countryCode) query = query.eq("country_code", countryCode);

    const { data, error } = await query;
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
    const session = await assertCanManageTaxiTaxes(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "Missing id" }, 400);

    const { data: existing, error: readErr } = await supabase
      .from("taxi_country_taxes")
      .select(SELECT)
      .eq("id", id)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "Tax row not found" }, 404);

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.tax_rate != null) update.tax_rate = Number(body.tax_rate);
    if (typeof body.active === "boolean") update.active = body.active;
    if (typeof body.tax_name === "string") update.tax_name = body.tax_name;

    const { data: updated, error: updateErr } = await supabase
      .from("taxi_country_taxes")
      .update(update)
      .eq("id", id)
      .select(SELECT)
      .maybeSingle();

    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_country_tax_updated",
      targetType: "taxi_country_taxes",
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
