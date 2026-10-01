import { NextRequest, NextResponse } from "next/server";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { isSuperAdmin } from "@/lib/adminRbac";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { parseAdminDateTime, isValidTimeZone } from "@/lib/minimumPay/zonedTime";
import { mapSettingsRow } from "@/lib/minimumPay/settingsStore";
import { MINIMUM_PAY_MODES, MINIMUM_PAY_ROUNDINGS } from "@/lib/minimumPay/types";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("minimum_pay.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("minimum_pay_engine_settings")
      .select("*")
      .eq("singleton", true)
      .maybeSingle();
    if (error) return json({ ok: false, error: "settings_load_failed" }, 500);
    return json({ ok: true, settings: data ? mapSettingsRow(data as Record<string, unknown>) : null });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("minimum_pay.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = String(body.reason ?? "").trim();

    const { data: current } = await supabase
      .from("minimum_pay_engine_settings")
      .select("*")
      .eq("singleton", true)
      .maybeSingle();

    if (current?.require_change_reason !== false && !reason) {
      return json({ ok: false, error: "reason_required" }, 400);
    }

    const nextMode = body.mode != null ? String(body.mode).trim().toLowerCase() : null;
    if (nextMode && !(MINIMUM_PAY_MODES as readonly string[]).includes(nextMode)) {
      return json({ ok: false, error: "invalid_mode" }, 400);
    }
    if (
      (nextMode === "active" || body.transfers_enabled === true) &&
      !session.isFounder &&
      !isSuperAdmin(session.role)
    ) {
      return json({ ok: false, error: "super_admin_required" }, 403);
    }

    const rounding = body.default_rounding != null ? String(body.default_rounding).trim() : null;
    if (rounding && !(MINIMUM_PAY_ROUNDINGS as readonly string[]).includes(rounding)) {
      return json({ ok: false, error: "invalid_rounding" }, 400);
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    };
    if (nextMode) patch.mode = nextMode;
    const nextTimezone =
      "timezone" in body
        ? body.timezone
          ? String(body.timezone).trim()
          : null
        : current?.timezone
          ? String(current.timezone)
          : null;
    if (nextTimezone && !isValidTimeZone(nextTimezone)) {
      return json({ ok: false, error: "invalid_timezone" }, 400);
    }
    if ("timezone" in body) patch.timezone = nextTimezone;
    if ("engine_start_at" in body) {
      const parsed = parseAdminDateTime(body.engine_start_at, nextTimezone);
      if (parsed.ok === false) return json({ ok: false, error: parsed.error }, 400);
      const currentStart = current?.engine_start_at
        ? String(current.engine_start_at)
        : null;
      const nextStart = parsed.iso;
      if (currentStart && currentStart !== nextStart) {
        const { count } = await supabase
          .from("pay_periods")
          .select("id", { count: "exact", head: true });
        if (String(current.mode ?? "off") !== "off" || (count ?? 0) > 0) {
          return json({ ok: false, error: "engine_start_locked" }, 400);
        }
      }
      patch.engine_start_at = parsed.iso;
    }
    if ("period_length_days" in body) {
      patch.period_length_days = body.period_length_days === "" || body.period_length_days == null
        ? null
        : Number(body.period_length_days);
    }
    if ("period_start_weekday" in body) {
      if (body.period_start_weekday === "" || body.period_start_weekday == null) {
        patch.period_start_weekday = null;
      } else {
        const weekday = Number(body.period_start_weekday);
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
          return json({ ok: false, error: "invalid_weekday" }, 400);
        }
        patch.period_start_weekday = weekday;
      }
    }
    if ("default_jurisdiction" in body) {
      patch.default_jurisdiction = body.default_jurisdiction
        ? String(body.default_jurisdiction)
        : null;
    }
    if ("default_currency" in body) {
      patch.default_currency = body.default_currency
        ? String(body.default_currency).trim().toUpperCase()
        : null;
    }
    if ("default_method" in body) {
      patch.default_method = body.default_method ? String(body.default_method) : null;
    }
    if (rounding) patch.default_rounding = rounding;
    if ("eligible_county_codes" in body) {
      patch.eligible_county_codes = asStringList(body.eligible_county_codes);
    }
    if ("eligible_source_types" in body) {
      patch.eligible_source_types = asStringList(body.eligible_source_types);
    }
    if ("excluded_source_types" in body) {
      patch.excluded_source_types = asStringList(body.excluded_source_types);
    }
    if ("wait_fee_counts" in body) patch.wait_fee_counts = body.wait_fee_counts === true;
    if ("bonus_counts" in body) patch.bonus_counts = body.bonus_counts === true;
    if ("transfers_enabled" in body) patch.transfers_enabled = body.transfers_enabled === true;
    if ("on_call_stale_after_seconds" in body) {
      patch.on_call_stale_after_seconds =
        body.on_call_stale_after_seconds === "" || body.on_call_stale_after_seconds == null
          ? null
          : Number(body.on_call_stale_after_seconds);
    }
    if ("require_change_reason" in body) {
      patch.require_change_reason = body.require_change_reason !== false;
    }

    const { data, error } = await supabase
      .from("minimum_pay_engine_settings")
      .update(patch)
      .eq("singleton", true)
      .select("*")
      .single();
    if (error) return json({ ok: false, error: "settings_save_failed" }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "minimum_pay_settings_updated",
      targetType: "minimum_pay_engine_settings",
      targetId: "singleton",
      request,
      oldValues: (current as Record<string, unknown>) ?? null,
      newValues: data as Record<string, unknown>,
      metadata: { reason },
    });

    return json({
      ok: true,
      settings: mapSettingsRow(data as Record<string, unknown>),
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}
