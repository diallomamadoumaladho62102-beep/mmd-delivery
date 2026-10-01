import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMinimumPayMode } from "./engineGate";
import type { MinimumPayEngineSettings, PayRuleVersion } from "./types";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

export function mapSettingsRow(row: Record<string, unknown>): MinimumPayEngineSettings {
  return {
    mode: parseMinimumPayMode(row.mode),
    engineStartAt: row.engine_start_at ? String(row.engine_start_at) : null,
    timezone: row.timezone ? String(row.timezone) : null,
    periodLengthDays:
      row.period_length_days == null ? null : Number(row.period_length_days),
    periodStartWeekday:
      row.period_start_weekday == null ? null : Number(row.period_start_weekday),
    defaultJurisdiction: row.default_jurisdiction
      ? String(row.default_jurisdiction)
      : null,
    defaultCurrency: row.default_currency ? String(row.default_currency) : null,
    defaultMethod: row.default_method ? String(row.default_method) : null,
    defaultRounding: row.default_rounding ? String(row.default_rounding) : null,
    eligibleCountyCodes: asStringArray(row.eligible_county_codes),
    eligibleSourceTypes: asStringArray(row.eligible_source_types),
    excludedSourceTypes: asStringArray(row.excluded_source_types),
    waitFeeCounts: row.wait_fee_counts === true,
    bonusCounts: row.bonus_counts === true,
    transfersEnabled: row.transfers_enabled === true,
    onCallStaleAfterSeconds:
      row.on_call_stale_after_seconds == null
        ? null
        : Number(row.on_call_stale_after_seconds),
    requireChangeReason: row.require_change_reason !== false,
  };
}

export function mapRuleRow(row: Record<string, unknown>): PayRuleVersion {
  return {
    id: String(row.id),
    jurisdiction: String(row.jurisdiction ?? ""),
    ruleName: String(row.rule_name ?? ""),
    ruleVersion: String(row.rule_version ?? ""),
    effectiveFrom: String(row.effective_from ?? ""),
    effectiveTo: row.effective_to ? String(row.effective_to) : null,
    mprCentsPerHour: Math.trunc(Number(row.mpr_cents_per_hour) || 0),
    method: String(row.method ?? ""),
    rounding: String(row.rounding ?? ""),
    eligibleSourceTypes: asStringArray(row.eligible_source_types),
    excludedSourceTypes: asStringArray(row.excluded_source_types),
    waitFeeCounts: row.wait_fee_counts == null ? null : row.wait_fee_counts === true,
    bonusCounts: row.bonus_counts == null ? null : row.bonus_counts === true,
    notes: row.notes == null ? null : String(row.notes),
    status: String(row.status ?? "draft") as PayRuleVersion["status"],
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    sourceLabel: row.source_label == null ? null : String(row.source_label),
  };
}

export async function loadMinimumPaySettings(
  supabase: SupabaseClient
): Promise<MinimumPayEngineSettings | null> {
  const { data, error } = await supabase
    .from("minimum_pay_engine_settings")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  if (error || !data) return null;
  return mapSettingsRow(data as Record<string, unknown>);
}

export function resolvePayRuleForInstant(
  rules: PayRuleVersion[],
  jurisdiction: string,
  atIso: string
): PayRuleVersion | null {
  const at = Date.parse(atIso);
  if (!Number.isFinite(at)) return null;
  const matches = rules
    .filter((rule) => {
      if (rule.jurisdiction !== jurisdiction) return false;
      if (rule.status !== "active") return false;
      const from = Date.parse(rule.effectiveFrom);
      if (!Number.isFinite(from) || at < from) return false;
      if (rule.effectiveTo) {
        const to = Date.parse(rule.effectiveTo);
        if (Number.isFinite(to) && at >= to) return false;
      }
      return true;
    })
    .sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom));
  return matches[0] ?? null;
}

export async function loadActivePayRules(
  supabase: SupabaseClient,
  jurisdiction: string
): Promise<PayRuleVersion[]> {
  const { data, error } = await supabase
    .from("pay_rule_versions")
    .select("*")
    .eq("jurisdiction", jurisdiction)
    .eq("status", "active")
    .order("effective_from", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapRuleRow(row as Record<string, unknown>));
}
