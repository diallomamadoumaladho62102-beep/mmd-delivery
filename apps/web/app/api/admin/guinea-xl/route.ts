import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanWriteTaxiPricing, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { canonicalRouteKey, directionalRouteKey, localityKey } from "@/lib/markets/guineaXlPricing";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function integerGnf(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  return amount;
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_pricing.read", request);
    const supabase = buildSupabaseAdminClient();
    const origin = localityKey(request.nextUrl.searchParams.get("origin") ?? "") ?? "";
    const destination = localityKey(request.nextUrl.searchParams.get("destination") ?? "") ?? "";
    const active = request.nextUrl.searchParams.get("active");
    let axes = supabase
      .from("guinea_xl_axes")
      .select(
        "id,origin_label,destination_label,origin_key,destination_key,route_key,directional,front_seat_gnf,other_seat_gnf,currency,active,version,updated_at,updated_by",
      )
      .order("origin_label");
    if (origin) axes = axes.or(`origin_key.eq.${origin},destination_key.eq.${origin}`);
    if (destination) axes = axes.or(`origin_key.eq.${destination},destination_key.eq.${destination}`);
    if (active === "true" || active === "false") axes = axes.eq("active", active === "true");
    const [axisRows, bands, settings, history] = await Promise.all([
      axes,
      supabase.from("guinea_xl_baggage_bands").select("id,min_kg,max_kg,price_gnf,active,currency,updated_at,updated_by").order("min_kg"),
      supabase.from("guinea_xl_settings").select("platform_share_bps,currency,country_code,updated_at,updated_by").eq("id", "GN").maybeSingle(),
      supabase.from("guinea_xl_audit").select("id,actor_id,axis_id,action,old_value,new_value,reason,created_at").order("created_at", { ascending: false }).limit(50),
    ]);
    const error = axisRows.error ?? bands.error ?? settings.error ?? history.error;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({
      ok: true,
      axes: axisRows.data ?? [],
      bands: bands.data ?? [],
      settings: settings.data,
      history: history.data ?? [],
    });
  } catch (error: unknown) {
    if (error instanceof AdminAccessError) return json({ ok: false, error: error.message }, error.status);
    return json({ ok: false, error: "Server error" }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const staff = await assertCanWriteTaxiPricing(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "create_axis" || action === "update_rate" || action === "set_active") {
      const originLabel = String(body.originLabel ?? "").trim();
      const destinationLabel = String(body.destinationLabel ?? "").trim();
      if (action === "create_axis") {
        const origin = localityKey(originLabel);
        const destination = localityKey(destinationLabel);
        const front = integerGnf(body.frontSeatGnf);
        const other = integerGnf(body.otherSeatGnf);
        if (!origin || !destination || origin === destination || front == null || other == null) {
          return json({ ok: false, error: "xl_rate_invalid" }, 400);
        }
        const directional = body.directional === true;
        const inserted = await supabase
          .from("guinea_xl_axes")
          .insert({
            origin_key: origin,
            destination_key: destination,
            origin_label: originLabel,
            destination_label: destinationLabel,
            route_key: directional ? directionalRouteKey(origin, destination) : canonicalRouteKey(origin, destination),
            directional,
            front_seat_gnf: front,
            other_seat_gnf: other,
            active: body.active !== false,
            currency: "GNF",
            country_code: "GN",
            updated_by: staff.userId,
          })
          .select("id,version,front_seat_gnf,other_seat_gnf,active")
          .maybeSingle();
        if (inserted.error) return json({ ok: false, error: inserted.error.message }, 400);
        await supabase.from("guinea_xl_audit").insert({
          actor_id: staff.userId,
          axis_id: inserted.data?.id,
          action: "axis_created",
          new_value: inserted.data,
          reason: body.reason ? String(body.reason) : null,
        });
        await writeAdminAuditServer({
          supabaseAdmin: supabase,
          adminUserId: staff.userId,
          action: "guinea_xl_axis_created",
          targetType: "guinea_xl_axis",
          targetId: String(inserted.data?.id ?? ""),
          newValues: inserted.data,
          request,
        });
        return json({ ok: true, axis: inserted.data });
      }

      const axisId = String(body.axisId ?? "");
      const current = await supabase
        .from("guinea_xl_axes")
        .select("id,version,front_seat_gnf,other_seat_gnf,active")
        .eq("id", axisId)
        .maybeSingle();
      if (current.error || !current.data) return json({ ok: false, error: "xl_route_not_configured" }, 404);
      if (String(body.expectedVersion ?? "") !== String(current.data.version)) {
        return json({ ok: false, error: "xl_rate_conflict" }, 409);
      }
      const patch =
        action === "set_active"
          ? { active: body.active === true, updated_by: staff.userId }
          : {
              front_seat_gnf: integerGnf(body.frontSeatGnf),
              other_seat_gnf: integerGnf(body.otherSeatGnf),
              updated_by: staff.userId,
            };
      if (action === "update_rate" && (patch.front_seat_gnf == null || patch.other_seat_gnf == null)) {
        return json({ ok: false, error: "xl_rate_invalid" }, 400);
      }
      const updated = await supabase
        .from("guinea_xl_axes")
        .update(patch)
        .eq("id", axisId)
        .eq("version", current.data.version)
        .select("id,version,front_seat_gnf,other_seat_gnf,active")
        .maybeSingle();
      if (updated.error || !updated.data) return json({ ok: false, error: "xl_rate_conflict" }, 409);
      await supabase.from("guinea_xl_audit").insert({
        actor_id: staff.userId,
        axis_id: axisId,
        action,
        old_value: current.data,
        new_value: updated.data,
        reason: body.reason ? String(body.reason) : null,
      });
      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: staff.userId,
        action: `guinea_xl_${action}`,
        targetType: "guinea_xl_axis",
        targetId: axisId,
        oldValues: current.data,
        newValues: updated.data,
        request,
      });
      return json({ ok: true, axis: updated.data });
    }

    if (action === "set_commission") {
      const bps = integerGnf(body.platformShareBps);
      if (bps == null || bps > 10_000) return json({ ok: false, error: "xl_commission_not_configured" }, 400);
      const current = await supabase.from("guinea_xl_settings").select("platform_share_bps").eq("id", "GN").maybeSingle();
      const updated = await supabase
        .from("guinea_xl_settings")
        .update({ platform_share_bps: bps, updated_by: staff.userId, updated_at: new Date().toISOString() })
        .eq("id", "GN")
        .select("platform_share_bps")
        .maybeSingle();
      if (updated.error) return json({ ok: false, error: updated.error.message }, 400);
      await supabase.from("guinea_xl_audit").insert({
        actor_id: staff.userId,
        action: "commission_changed",
        old_value: current.data,
        new_value: updated.data,
        reason: body.reason ? String(body.reason) : null,
      });
      return json({ ok: true, settings: updated.data });
    }

    if (action === "save_band") {
      const minKg = integerGnf(body.minKg);
      const maxKg = integerGnf(body.maxKg);
      const priceGnf = integerGnf(body.priceGnf);
      if (minKg == null || maxKg == null || priceGnf == null || maxKg < minKg) {
        return json({ ok: false, error: "xl_baggage_invalid" }, 400);
      }
      const payload = {
        country_code: "GN",
        currency: "GNF",
        min_kg: minKg,
        max_kg: maxKg,
        price_gnf: priceGnf,
        active: body.active !== false,
        updated_by: staff.userId,
        updated_at: new Date().toISOString(),
      };
      const bandId = String(body.bandId ?? "");
      const saved = bandId
        ? await supabase.from("guinea_xl_baggage_bands").update(payload).eq("id", bandId).select("id,min_kg,max_kg,price_gnf,active").maybeSingle()
        : await supabase.from("guinea_xl_baggage_bands").insert(payload).select("id,min_kg,max_kg,price_gnf,active").maybeSingle();
      if (saved.error) return json({ ok: false, error: saved.error.message }, 400);
      await supabase.from("guinea_xl_audit").insert({
        actor_id: staff.userId,
        action: "baggage_band_saved",
        new_value: saved.data,
        reason: body.reason ? String(body.reason) : null,
      });
      return json({ ok: true, band: saved.data });
    }

    return json({ ok: false, error: "xl_booking_invalid" }, 400);
  } catch (error: unknown) {
    if (error instanceof AdminAccessError) return json({ ok: false, error: error.message }, error.status);
    return json({ ok: false, error: "Server error" }, 500);
  }
}
