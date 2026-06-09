import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiCountries,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const SELECT =
  "country_code, name, currency_code, active, sort_order, timezone, phone_country_code, default_language, metadata, updated_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_countries.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("taxi_countries")
      .select(SELECT)
      .order("sort_order", { ascending: true })
      .order("country_code", { ascending: true });

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
    const session = await assertCanManageTaxiCountries(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const countryCode = String(body.country_code ?? body.countryCode ?? "")
      .trim()
      .toUpperCase();

    if (!countryCode) return json({ ok: false, error: "Missing country_code" }, 400);

    const { data: existing, error: readErr } = await supabase
      .from("taxi_countries")
      .select(SELECT)
      .eq("country_code", countryCode)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "Country not found" }, 404);

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.active === "boolean") update.active = body.active;
    if (typeof body.currency_code === "string") {
      update.currency_code = body.currency_code.trim().toUpperCase();
    }
    if (typeof body.timezone === "string") update.timezone = body.timezone.trim();
    if (typeof body.phone_country_code === "string") {
      update.phone_country_code = body.phone_country_code.trim();
    }
    if (typeof body.default_language === "string") {
      const lang = body.default_language.trim().toLowerCase();
      if (lang === "en" || lang === "fr") update.default_language = lang;
    }
    if (body.metadata && typeof body.metadata === "object") {
      update.metadata = body.metadata;
    }

    const { data: updated, error: updateErr } = await supabase
      .from("taxi_countries")
      .update(update)
      .eq("country_code", countryCode)
      .select(SELECT)
      .maybeSingle();

    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_country_updated",
      targetType: "taxi_countries",
      targetId: countryCode,
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
