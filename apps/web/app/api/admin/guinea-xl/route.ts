import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanWriteTaxiPricing, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { canonicalRouteKey, directionalRouteKey, localityKey } from "@/lib/markets/guineaXlPricing";
import {
  buildXlSegmentAdminView,
  parseSegmentDistanceKm,
  parseSegmentDurationMinutes,
  parseSegmentEstimateSource,
  parseSegmentPlaceLabel,
  segmentCanBeActivated,
  segmentFromRow,
  segmentSchemaMissing,
  tariffFromRow,
  validateXlSegmentGraph,
} from "@/lib/markets/guineaXlSegments";
import { dispatchLimitsFromRow, interpretDispatchLimitSave, parseDispatchLimitInput } from "@/lib/markets/guineaXlSegmentDispatch";

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
    const [axisRows, bands, settings, history, versions] = await Promise.all([
      axes,
      supabase.from("guinea_xl_baggage_bands").select("id,min_kg,max_kg,price_gnf,active,currency,updated_at,updated_by").order("min_kg"),
      supabase.from("guinea_xl_settings").select("platform_share_bps,currency,country_code,updated_at,updated_by").eq("id", "GN").maybeSingle(),
      supabase.from("guinea_xl_audit").select("id,actor_id,axis_id,action,old_value,new_value,reason,created_at").order("created_at", { ascending: false }).limit(50),
      supabase.from("guinea_xl_axis_versions").select("id,axis_id,version,front_seat_gnf,other_seat_gnf,active,created_at,created_by").order("created_at", { ascending: false }).limit(50),
    ]);
    const error = axisRows.error ?? bands.error ?? settings.error ?? history.error ?? versions.error;
    if (error) return json({ ok: false, error: "xl_catalog_failed" }, 500);
    const segments = await readSegments(supabase);
    const dispatch = await readDispatchLimits(supabase);
    return json({
      ok: true,
      axes: axisRows.data ?? [],
      bands: bands.data ?? [],
      settings: settings.data,
      history: history.data ?? [],
      versions: versions.data ?? [],
      ...segments,
      ...dispatch,
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
        if (inserted.error) return json({ ok: false, error: "xl_rate_invalid" }, 400);
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
      if (updated.error) return json({ ok: false, error: "xl_commission_not_configured" }, 400);
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
      if (saved.error) return json({ ok: false, error: "xl_baggage_invalid" }, 400);
      await supabase.from("guinea_xl_audit").insert({
        actor_id: staff.userId,
        action: "baggage_band_saved",
        new_value: saved.data,
        reason: body.reason ? String(body.reason) : null,
      });
      return json({ ok: true, band: saved.data });
    }

    if (
      action === "save_segment_tariff" ||
      action === "save_segment" ||
      action === "set_segment_active" ||
      action === "confirm_segment" ||
      action === "save_segment_dispatch"
    ) {
      return saveSegmentAdmin(supabase, staff.userId, action, body);
    }

    return json({ ok: false, error: "xl_booking_invalid" }, 400);
  } catch (error: unknown) {
    if (error instanceof AdminAccessError) return json({ ok: false, error: error.message }, error.status);
    return json({ ok: false, error: "Server error" }, 500);
  }
}

async function readDispatchLimits(supabase: ReturnType<typeof buildSupabaseAdminClient>) {
  const row = await supabase
    .from("guinea_xl_segment_tariff")
    .select("version,max_pickup_meters,max_detour_meters,max_pickup_delay_minutes,max_location_age_seconds")
    .eq("id", "GN")
    .maybeSingle();
  if (row.error) {
    if (/max_pickup_meters|schema cache|does not exist/i.test(row.error.message)) {
      return { dispatchReady: false, dispatchLimits: null };
    }
    return { dispatchReady: false, dispatchLimits: null, dispatchError: "xl_catalog_failed" };
  }
  return {
    dispatchReady: true,
    dispatchLimits: dispatchLimitsFromRow((row.data ?? null) as Record<string, unknown> | null),
    dispatchVersion: Number((row.data as { version?: number } | null)?.version ?? 0),
  };
}

async function readSegments(supabase: ReturnType<typeof buildSupabaseAdminClient>) {
  const [tariffRow, segmentRows] = await Promise.all([
    supabase
      .from("guinea_xl_segment_tariff")
      .select("version,base_gnf,per_km_gnf,per_minute_gnf,minimum_gnf,updated_at")
      .eq("id", "GN")
      .maybeSingle(),
    supabase
      .from("guinea_xl_segments")
      .select("id,code,sequence,origin_label,destination_label,branch,distance_km,duration_minutes,active,confirmed,version,estimate_source")
      .order("sequence"),
  ]);
  const error = tariffRow.error ?? segmentRows.error;
  if (error) {
    if (segmentSchemaMissing(error.message)) {
      return { segmentSchemaReady: false, segmentTariff: null, segments: [], segmentRoutes: [] };
    }
    return {
      segmentSchemaReady: true,
      segmentError: "xl_catalog_failed",
      segmentTariff: null,
      segments: [],
      segmentRoutes: [],
    };
  }
  const tariff = tariffFromRow((tariffRow.data ?? null) as Record<string, unknown> | null);
  const rows = ((segmentRows.data ?? []) as Array<Record<string, unknown>>).map(segmentFromRow);
  const view = buildXlSegmentAdminView(rows, tariff);
  return {
    segmentSchemaReady: true,
    segmentTariff: tariff
      ? {
          version: tariff.version,
          base_gnf: tariff.baseGnf,
          per_km_gnf: tariff.perKmGnf,
          per_minute_gnf: tariff.perMinuteGnf,
          minimum_gnf: tariff.minimumGnf,
        }
      : null,
    segments: view.segments,
    segmentRoutes: view.routes,
  };
}

async function saveSegmentAdmin(
  supabase: ReturnType<typeof buildSupabaseAdminClient>,
  actorId: string,
  action: string,
  body: Record<string, unknown>,
) {
  const expectedVersion = integerGnf(body.expectedVersion);
  if (expectedVersion == null || expectedVersion < 1) return json({ ok: false, error: "xl_segment_conflict" }, 409);

  if (action === "save_segment_tariff") {
    const baseGnf = integerGnf(body.baseGnf);
    const perKmGnf = integerGnf(body.perKmGnf);
    const perMinuteGnf = integerGnf(body.perMinuteGnf);
    const minimumGnf = integerGnf(body.minimumGnf);
    if (baseGnf == null || perKmGnf == null || perMinuteGnf == null || minimumGnf == null) {
      return json({ ok: false, error: "xl_segment_not_priced" }, 400);
    }
    const updated = await supabase
      .from("guinea_xl_segment_tariff")
      .update({
        base_gnf: baseGnf,
        per_km_gnf: perKmGnf,
        per_minute_gnf: perMinuteGnf,
        minimum_gnf: minimumGnf,
        version: expectedVersion + 1,
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "GN")
      .eq("version", expectedVersion)
      .select("version,base_gnf,per_km_gnf,per_minute_gnf,minimum_gnf")
      .maybeSingle();
    if (updated.error) {
      if (segmentSchemaMissing(updated.error.message)) return json({ ok: false, error: "xl_segment_schema_not_ready" }, 503);
      return json({ ok: false, error: "xl_segment_not_priced" }, 400);
    }
    if (!updated.data) return json({ ok: false, error: "xl_segment_conflict" }, 409);
    await supabase.from("guinea_xl_audit").insert({
      actor_id: actorId,
      action: "segment_tariff_saved",
      new_value: updated.data,
    });
    return json({ ok: true, segmentTariff: updated.data });
  }

  if (action === "save_segment_dispatch") {
    const parsed = parseDispatchLimitInput(body);
    if (parsed.ok === false) return json({ ok: false, error: parsed.error }, 400);
    const updated = await supabase
      .from("guinea_xl_segment_tariff")
      .update({
        max_pickup_meters: parsed.maxPickupMeters,
        max_detour_meters: parsed.maxDetourMeters,
        max_pickup_delay_minutes: parsed.maxPickupDelayMinutes,
        max_location_age_seconds: parsed.maxLocationAgeSeconds,
        version: expectedVersion + 1,
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "GN")
      .eq("version", expectedVersion)
      .select("version,max_pickup_meters,max_detour_meters,max_pickup_delay_minutes,max_location_age_seconds")
      .maybeSingle();
    const interpreted = interpretDispatchLimitSave({
      errorMessage: updated.error?.message ?? null,
      row: (updated.data ?? null) as Record<string, unknown> | null,
    });
    if (interpreted.ok === false) {
      const schema = updated.error != null && /max_pickup_meters|schema cache|does not exist/i.test(updated.error.message);
      const status = interpreted.error === "xl_segment_conflict" ? 409 : interpreted.error === "xl_catalog_failed" ? 500 : schema ? 503 : 400;
      return json({ ok: false, error: interpreted.error }, status);
    }
    await supabase.from("guinea_xl_audit").insert({
      actor_id: actorId,
      action: "segment_dispatch_saved",
      new_value: updated.data,
    });
    return json({ ok: true, dispatchLimits: interpreted.limits });
  }

  const segmentId = String(body.segmentId ?? "");
  if (!segmentId) return json({ ok: false, error: "xl_segment_not_priced" }, 400);
  const current = await supabase
    .from("guinea_xl_segments")
    .select("id,origin_label,destination_label,distance_km,duration_minutes,active,confirmed,version,estimate_source")
    .eq("id", segmentId)
    .maybeSingle();
  if (current.error) {
    if (segmentSchemaMissing(current.error.message)) return json({ ok: false, error: "xl_segment_schema_not_ready" }, 503);
    return json({ ok: false, error: "xl_segment_not_priced" }, 400);
  }
  if (!current.data || Number(current.data.version) !== expectedVersion) {
    return json({ ok: false, error: "xl_segment_conflict" }, 409);
  }

  let patch: Record<string, unknown> = {
    version: expectedVersion + 1,
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  };
  if (action === "save_segment") {
    const distanceKm = parseSegmentDistanceKm(body.distanceKm);
    const durationMinutes = parseSegmentDurationMinutes(body.durationMinutes);
    if (distanceKm === "invalid" || durationMinutes === "invalid") {
      return json({ ok: false, error: "xl_segment_not_priced" }, 400);
    }
    const originLabel = parseSegmentPlaceLabel(body.originLabel ?? current.data.origin_label);
    const destinationLabel = parseSegmentPlaceLabel(body.destinationLabel ?? current.data.destination_label);
    const estimateSource = parseSegmentEstimateSource(
      body.estimateSource === undefined ? current.data.estimate_source : body.estimateSource,
    );
    if (originLabel === "invalid" || destinationLabel === "invalid" || estimateSource === "invalid") {
      return json({ ok: false, error: "xl_segment_path_invalid" }, 400);
    }
    const catalog = await supabase
      .from("guinea_xl_segments")
      .select("id,code,sequence,origin_label,destination_label,branch,distance_km,duration_minutes,active,confirmed,version,estimate_source");
    if (catalog.error) {
      if (segmentSchemaMissing(catalog.error.message)) return json({ ok: false, error: "xl_segment_schema_not_ready" }, 503);
      return json({ ok: false, error: "xl_catalog_failed" }, 500);
    }
    const next = ((catalog.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const segment = segmentFromRow(row);
      return segment.id === segmentId ? { ...segment, originLabel, destinationLabel } : segment;
    });
    if (validateXlSegmentGraph(next).ok === false) {
      return json({ ok: false, error: "xl_segment_path_invalid" }, 400);
    }
    const originKey = localityKey(originLabel);
    const destinationKey = localityKey(destinationLabel);
    const measuredChanged =
      distanceKm !== current.data.distance_km ||
      durationMinutes !== current.data.duration_minutes ||
      originKey !== localityKey(current.data.origin_label) ||
      destinationKey !== localityKey(current.data.destination_label);
    patch = {
      ...patch,
      origin_label: originLabel,
      destination_label: destinationLabel,
      origin_key: originKey,
      destination_key: destinationKey,
      estimate_source: estimateSource,
      distance_km: distanceKm,
      duration_minutes: durationMinutes,
      confirmed: measuredChanged ? false : current.data.confirmed === true,
    };
    if (current.data.active === true && !segmentCanBeActivated(distanceKm, durationMinutes)) {
      patch.active = false;
    }
  } else if (action === "set_segment_active") {
    const active = body.active === true;
    if (active && !segmentCanBeActivated(current.data.distance_km, current.data.duration_minutes)) {
      return json({ ok: false, error: "xl_segment_not_priced" }, 400);
    }
    patch = { ...patch, active };
  } else if (action === "confirm_segment") {
    if (!segmentCanBeActivated(current.data.distance_km, current.data.duration_minutes)) {
      return json({ ok: false, error: "xl_segment_not_priced" }, 400);
    }
    patch = { ...patch, confirmed: true };
  }

  const updated = await supabase
    .from("guinea_xl_segments")
    .update(patch)
    .eq("id", segmentId)
    .eq("version", expectedVersion)
    .select("id,code,sequence,active,confirmed,version,distance_km,duration_minutes")
    .maybeSingle();
  if (updated.error) return json({ ok: false, error: "xl_segment_not_priced" }, 400);
  if (!updated.data) return json({ ok: false, error: "xl_segment_conflict" }, 409);
  await supabase.from("guinea_xl_audit").insert({
    actor_id: actorId,
    action: action === "set_segment_active" ? "segment_activation" : "segment_updated",
    new_value: updated.data,
  });
  return json({ ok: true, segment: updated.data });
}
