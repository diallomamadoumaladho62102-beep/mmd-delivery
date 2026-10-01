import { NextRequest, NextResponse } from "next/server";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { parseAdminDateTime } from "@/lib/minimumPay/zonedTime";
import { mapRuleRow } from "@/lib/minimumPay/settingsStore";
import { MINIMUM_PAY_ROUNDINGS, MINIMUM_PAY_RULE_STATUSES } from "@/lib/minimumPay/types";
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
      .from("pay_rule_versions")
      .select("*")
      .order("effective_from", { ascending: false });
    if (error) return json({ ok: false, error: "rules_load_failed" }, 500);
    return json({
      ok: true,
      rules: (data ?? []).map((row) => mapRuleRow(row as Record<string, unknown>)),
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("minimum_pay.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = String(body.reason ?? "").trim();
    if (!reason) return json({ ok: false, error: "reason_required" }, 400);

    const jurisdiction = String(body.jurisdiction ?? "").trim();
    const ruleName = String(body.rule_name ?? "").trim();
    const ruleVersion = String(body.rule_version ?? "").trim();
    const method = String(body.method ?? "").trim();
    const rounding = String(body.rounding ?? "").trim();
    const { data: engineSettings } = await supabase
      .from("minimum_pay_engine_settings")
      .select("timezone")
      .eq("singleton", true)
      .maybeSingle();
    const zone = String(body.timezone ?? engineSettings?.timezone ?? "").trim() || null;
    const fromParsed = parseAdminDateTime(body.effective_from, zone);
    if (fromParsed.ok === false) return json({ ok: false, error: fromParsed.error }, 400);
    const toParsed = parseAdminDateTime(body.effective_to, zone);
    if (toParsed.ok === false) return json({ ok: false, error: toParsed.error }, 400);
    const effectiveFrom = fromParsed.iso ?? "";
    const mpr = Math.trunc(Number(body.mpr_cents_per_hour));
    const status = String(body.status ?? "draft").trim();

    if (!jurisdiction || !ruleName || !ruleVersion || !method || !effectiveFrom) {
      return json({ ok: false, error: "rule_fields_required" }, 400);
    }
    if (!Number.isInteger(mpr) || mpr <= 0) {
      return json({ ok: false, error: "invalid_mpr" }, 400);
    }
    if (!(MINIMUM_PAY_ROUNDINGS as readonly string[]).includes(rounding)) {
      return json({ ok: false, error: "invalid_rounding" }, 400);
    }
    if (!(MINIMUM_PAY_RULE_STATUSES as readonly string[]).includes(status)) {
      return json({ ok: false, error: "invalid_status" }, 400);
    }

    const insert = {
      jurisdiction,
      rule_name: ruleName,
      rule_version: ruleVersion,
      effective_from: effectiveFrom,
      effective_to: toParsed.iso,
      mpr_cents_per_hour: mpr,
      method,
      rounding,
      eligible_source_types: asStringList(body.eligible_source_types),
      excluded_source_types: asStringList(body.excluded_source_types),
      wait_fee_counts: body.wait_fee_counts == null ? null : body.wait_fee_counts === true,
      bonus_counts: body.bonus_counts == null ? null : body.bonus_counts === true,
      notes: body.notes ? String(body.notes) : null,
      status,
      source_url: body.source_url ? String(body.source_url) : null,
      source_label: body.source_label ? String(body.source_label) : null,
      created_by: session.userId,
      updated_by: session.userId,
    };

    const { data, error } = await supabase
      .from("pay_rule_versions")
      .insert(insert)
      .select("*")
      .single();
    if (error) return json({ ok: false, error: "rule_create_failed" }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "minimum_pay_rule_created",
      targetType: "pay_rule_versions",
      targetId: String(data.id),
      request,
      newValues: data as Record<string, unknown>,
      metadata: { reason },
    });

    return json({ ok: true, rule: mapRuleRow(data as Record<string, unknown>) });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}
