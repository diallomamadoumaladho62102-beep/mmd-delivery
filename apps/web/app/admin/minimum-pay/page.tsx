"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMinimumPay } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { useAdminT } from "@/i18n/useAdminT";
import { utcIsoToDatetimeLocal } from "@/lib/minimumPay/zonedTime";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";

type Settings = {
  mode: string;
  engineStartAt: string | null;
  timezone: string | null;
  periodLengthDays: number | null;
  periodStartWeekday: number | null;
  defaultJurisdiction: string | null;
  defaultCurrency: string | null;
  defaultMethod: string | null;
  defaultRounding: string | null;
  eligibleCountyCodes: string[];
  eligibleSourceTypes: string[];
  excludedSourceTypes: string[];
  waitFeeCounts: boolean;
  bonusCounts: boolean;
  transfersEnabled: boolean;
  onCallStaleAfterSeconds: number | null;
  requireChangeReason: boolean;
};

type Rule = {
  id: string;
  jurisdiction: string;
  ruleName: string;
  ruleVersion: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  mprCentsPerHour: number;
  method: string;
  rounding: string;
  status: string;
  notes: string | null;
};

function errorMessage(t: (s: string) => string, code: string): string {
  const map: Record<string, string> = {
    reason_required: t("A change reason is required"),
    invalid_mode: t("Invalid engine mode"),
    super_admin_required: t("Only Super Admin can enable Active mode or real transfers"),
    invalid_rounding: t("Invalid rounding method"),
    settings_save_failed: t("Unable to save settings"),
    settings_load_failed: t("Unable to load settings"),
    rule_fields_required: t("Rule fields are required"),
    invalid_mpr: t("Invalid hourly rate"),
    invalid_status: t("Invalid status"),
    rule_create_failed: t("Unable to create rule"),
    forbidden: t("Forbidden"),
    settings_incomplete: t("Engine settings are incomplete"),
    engine_not_calculating: t("Engine is not calculating yet"),
    rules_load_failed: t("Unable to load rules"),
    periods_load_failed: t("Unable to load periods"),
    adjustments_load_failed: t("Unable to load adjustments"),
    invalid_timezone: t("Invalid timezone"),
    invalid_datetime: t("Invalid date and time"),
    timezone_required: t("Timezone is required"),
    invalid_weekday: t("Invalid period start weekday"),
    period_start_weekday_required: t("Period start weekday is required"),
    engine_start_locked: t("Engine start cannot be changed after periods exist"),
    adjustment_not_found: t("Adjustment not found"),
    not_fleet_allocation: t("Only fleet allocations can be approved here"),
    zero_adjustment: t("This fleet allocation has no amount to transfer"),
    transfer_already_pending: t("This fleet allocation is already pending transfer"),
    shadow_adjustment: t("Shadow adjustments cannot be transferred"),
    not_pending_approval: t("This fleet allocation is not pending approval"),
    approval_conflict: t("This fleet allocation was already claimed"),
    already_transferred: t("This fleet allocation was already transferred"),
    transfers_not_enabled: t("Real transfers are not enabled"),
    connect_account_required: t("Driver Connect account is required"),
    approval_failed: t("Unable to approve this fleet allocation"),
    fleet_allocation_requires_manual_approval: t(
      "Fleet allocation transfers require admin approval."
    ),
  };
  return map[code] ?? t("Unable to complete this action");
}

function statusLabel(t: (s: string) => string, status: string): string {
  const map: Record<string, string> = {
    off: t("Off"),
    shadow: t("Shadow"),
    active: t("Active"),
    draft: t("Draft"),
    archived: t("Archived"),
    scheduled: t("Scheduled"),
    open: t("Open"),
    closed: t("Closed"),
    reconciled: t("Reconciled"),
    shadowed: t("Shadowed"),
    computed: t("Computed"),
    transfer_pending: t("Transfer pending"),
    transferred: t("Transferred"),
    void: t("Void"),
  };
  return map[status] ?? status;
}

function kindLabel(t: (s: string) => string, kind: string): string {
  if (kind === "individual") return t("Individual");
  if (kind === "fleet_allocation") return t("Fleet allocation");
  return kind;
}

function isPendingFleetApproval(row: Record<string, unknown>): boolean {
  return (
    String(row.kind) === "fleet_allocation" &&
    String(row.status) === "computed" &&
    Math.trunc(Number(row.adjustment_cents) || 0) > 0
  );
}

function adjustmentStatusLabel(
  t: (s: string) => string,
  row: Record<string, unknown>
): string {
  if (isPendingFleetApproval(row)) return t("Pending approval");
  return statusLabel(t, String(row.status));
}

function MinimumPayInner() {
  const { t, locale } = useAdminT();
  const [canEdit, setCanEdit] = useState(false);
  const [tab, setTab] = useState<"settings" | "rules" | "periods" | "adjustments">("settings");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [periods, setPeriods] = useState<Array<Record<string, unknown>>>([]);
  const [adjustments, setAdjustments] = useState<Array<Record<string, unknown>>>([]);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMinimumPay(session?.role ?? null));
    const [settingsHttp, rulesHttp, periodsHttp, adjHttp] = await Promise.all([
      adminFetch("/api/admin/minimum-pay/settings"),
      adminFetch("/api/admin/minimum-pay/rules"),
      adminFetch("/api/admin/minimum-pay/periods"),
      adminFetch("/api/admin/minimum-pay/adjustments"),
    ]);
    const settingsRes = (await settingsHttp.json().catch(() => ({}))) as Record<string, unknown>;
    const rulesRes = (await rulesHttp.json().catch(() => ({}))) as Record<string, unknown>;
    const periodsRes = (await periodsHttp.json().catch(() => ({}))) as Record<string, unknown>;
    const adjRes = (await adjHttp.json().catch(() => ({}))) as Record<string, unknown>;
    setLoading(false);
    if (!settingsHttp.ok) {
      setError(errorMessage(t, String(settingsRes.error ?? "settings_load_failed")));
      return;
    }
    setSettings((settingsRes.settings as Settings) ?? null);
    setRules((rulesRes.rules as Rule[]) ?? []);
    setPeriods((periodsRes.periods as Array<Record<string, unknown>>) ?? []);
    setAdjustments((adjRes.adjustments as Array<Record<string, unknown>>) ?? []);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    const wallStart = String(form.get("engine_start_at") ?? "");
    const previousWall =
      settings.engineStartAt && settings.timezone
        ? utcIsoToDatetimeLocal(settings.engineStartAt, settings.timezone)
        : "";
    const engineStartAt =
      wallStart && wallStart === previousWall && settings.engineStartAt
        ? settings.engineStartAt
        : wallStart || null;
    const http = await adminFetch("/api/admin/minimum-pay/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: form.get("mode"),
        engine_start_at: engineStartAt,
        timezone: String(form.get("timezone") ?? "") || null,
        period_length_days: String(form.get("period_length_days") ?? "") || null,
        period_start_weekday: String(form.get("period_start_weekday") ?? "") || null,
        default_jurisdiction: String(form.get("default_jurisdiction") ?? "") || null,
        default_currency: String(form.get("default_currency") ?? "") || null,
        default_method: String(form.get("default_method") ?? "") || null,
        default_rounding: String(form.get("default_rounding") ?? "") || null,
        eligible_county_codes: String(form.get("eligible_county_codes") ?? ""),
        eligible_source_types: String(form.get("eligible_source_types") ?? ""),
        excluded_source_types: String(form.get("excluded_source_types") ?? ""),
        wait_fee_counts: form.get("wait_fee_counts") === "on",
        bonus_counts: form.get("bonus_counts") === "on",
        transfers_enabled: form.get("transfers_enabled") === "on",
        on_call_stale_after_seconds: String(form.get("on_call_stale_after_seconds") ?? "") || null,
        require_change_reason: form.get("require_change_reason") === "on",
        reason,
      }),
    });
    const body = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    setLoading(false);
    if (!http.ok || body.ok === false) {
      setError(errorMessage(t, String(body.error ?? "settings_save_failed")));
      return;
    }
    setNotice(t("Settings saved"));
    setSettings(body.settings as Settings);
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    const http = await adminFetch("/api/admin/minimum-pay/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jurisdiction: form.get("jurisdiction"),
        rule_name: form.get("rule_name"),
        rule_version: form.get("rule_version"),
        effective_from: form.get("effective_from"),
        effective_to: String(form.get("effective_to") ?? "") || null,
        mpr_cents_per_hour: form.get("mpr_cents_per_hour"),
        method: form.get("method"),
        rounding: form.get("rounding"),
        eligible_source_types: form.get("eligible_source_types"),
        excluded_source_types: form.get("excluded_source_types"),
        notes: form.get("notes"),
        status: form.get("status"),
        source_url: form.get("source_url"),
        timezone: settings?.timezone,
        reason,
      }),
    });
    const body = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    setLoading(false);
    if (!http.ok || body.ok === false) {
      setError(errorMessage(t, String(body.error ?? "rule_create_failed")));
      return;
    }
    setNotice(t("Rule created"));
    await load();
  }

  async function closePeriods() {
    setLoading(true);
    setError(null);
    const http = await adminFetch("/api/admin/minimum-pay/periods", { method: "POST" });
    const body = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    setLoading(false);
    if (!http.ok || body.ok === false) {
      setError(errorMessage(t, String(body.error ?? body.skipped ?? "forbidden")));
      return;
    }
    setNotice(t("Due periods reconciled"));
    await load();
  }

  async function approveFleetAllocation(adjustmentId: string) {
    setLoading(true);
    setError(null);
    setNotice(null);
    const http = await adminFetch("/api/admin/minimum-pay/adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adjustment_id: adjustmentId,
        reason,
      }),
    });
    const body = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    setLoading(false);
    if (!http.ok || body.ok === false) {
      setError(errorMessage(t, String(body.error ?? "approval_failed")));
      return;
    }
    setNotice(
      body.skipped
        ? errorMessage(t, String(body.reason ?? "already_transferred"))
        : t("Fleet allocation approved")
    );
    await load();
  }

  const pendingFleet = adjustments.filter(isPendingFleetApproval);
  const visibleAdjustments = [...adjustments].sort((a, b) => {
    const ap = isPendingFleetApproval(a) ? 0 : 1;
    const bp = isPendingFleetApproval(b) ? 0 : 1;
    return ap - bp;
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        {t("Recording starts at the engine start date. Earlier activity is ignored.")}
      </p>
      <p className="text-sm text-slate-600">
        {t("Shadow mode never creates a real transfer. Active still requires transfers enabled.")}
      </p>
      <p className="text-sm text-slate-600">
        {t("Sunday bank payout is not the minimum-pay period.")}
      </p>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["settings", t("Engine settings")],
            ["rules", t("Pay rules")],
            ["periods", t("Pay periods")],
            ["adjustments", t("Adjustments")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full px-3 py-1 text-sm ${
              tab === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-full bg-slate-100 px-3 py-1 text-sm"
        >
          {t("Refresh")}
        </button>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
      {loading ? <p className="text-sm text-slate-500">{t("Loading…")}</p> : null}

      {settings ? (
        <section className={CARD} aria-live="polite">
          <h2 className="text-lg font-semibold">{t("Current status")}</h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">{t("Engine mode")}</dt>
              <dd className="font-semibold">{statusLabel(t, settings.mode)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("Engine start")}</dt>
              <dd className="font-semibold">
                {settings.engineStartAt ?? t("Not set")}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("Real transfers enabled")}</dt>
              <dd className="font-semibold">
                {settings.transfersEnabled ? t("Yes") : t("No")}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <label className="block text-sm">
        {t("Change reason")}
        <input
          className={INPUT}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      {tab === "settings" && settings && (
        <form className={`${CARD} grid gap-3 sm:grid-cols-2`} onSubmit={saveSettings}>
          <label className="text-sm">
            {t("Engine mode")}
            <select name="mode" className={INPUT} defaultValue={settings.mode}>
              <option value="off">{t("Off")}</option>
              <option value="shadow">{t("Shadow")}</option>
              <option value="active">{t("Active")}</option>
            </select>
          </label>
          <label className="text-sm">
            {t("Engine timezone")}
            <input name="timezone" className={INPUT} defaultValue={settings.timezone ?? ""} />
          </label>
          <label className="text-sm">
            {t("Engine start")}
            <input
              name="engine_start_at"
              type="datetime-local"
              className={INPUT}
              defaultValue={
                settings.engineStartAt && settings.timezone
                  ? utcIsoToDatetimeLocal(settings.engineStartAt, settings.timezone)
                  : ""
              }
            />
            <span className="mt-1 block text-xs text-slate-500">
              {!settings.engineStartAt
                ? t("Not set")
                : settings.timezone
                  ? `${t("Times are interpreted in the engine timezone")} (${settings.timezone})`
                  : t("Times are interpreted in the engine timezone")}
            </span>
          </label>
          <label className="text-sm">
            {t("Period length in days")}
            <input
              name="period_length_days"
              className={INPUT}
              defaultValue={settings.periodLengthDays ?? ""}
            />
          </label>
          <label className="text-sm">
            {t("Period start weekday")}
            <select
              name="period_start_weekday"
              className={INPUT}
              defaultValue={
                settings.periodStartWeekday == null ? "" : String(settings.periodStartWeekday)
              }
            >
              <option value="">{t("Required")}</option>
              <option value="0">{t("Sunday")}</option>
              <option value="1">{t("Monday")}</option>
              <option value="2">{t("Tuesday")}</option>
              <option value="3">{t("Wednesday")}</option>
              <option value="4">{t("Thursday")}</option>
              <option value="5">{t("Friday")}</option>
              <option value="6">{t("Saturday")}</option>
            </select>
          </label>
          <label className="text-sm">
            {t("Jurisdiction")}
            <input
              name="default_jurisdiction"
              className={INPUT}
              defaultValue={settings.defaultJurisdiction ?? ""}
            />
          </label>
          <label className="text-sm">
            {t("Currency")}
            <input
              name="default_currency"
              className={INPUT}
              defaultValue={settings.defaultCurrency ?? ""}
            />
          </label>
          <label className="text-sm">
            {t("Calculation method")}
            <input
              name="default_method"
              className={INPUT}
              defaultValue={settings.defaultMethod ?? ""}
            />
          </label>
          <label className="text-sm">
            {t("Rounding method")}
            <input
              name="default_rounding"
              className={INPUT}
              defaultValue={settings.defaultRounding ?? ""}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            {t("Eligible county codes")}
            <input
              name="eligible_county_codes"
              className={INPUT}
              defaultValue={settings.eligibleCountyCodes.join(", ")}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            {t("Eligible earning types")}
            <input
              name="eligible_source_types"
              className={INPUT}
              defaultValue={settings.eligibleSourceTypes.join(", ")}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            {t("Excluded earning types")}
            <input
              name="excluded_source_types"
              className={INPUT}
              defaultValue={settings.excludedSourceTypes.join(", ")}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="wait_fee_counts" type="checkbox" defaultChecked={settings.waitFeeCounts} />
            {t("Count wait fees toward minimum")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="bonus_counts" type="checkbox" defaultChecked={settings.bonusCounts} />
            {t("Count bonuses toward minimum")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              name="transfers_enabled"
              type="checkbox"
              defaultChecked={settings.transfersEnabled}
            />
            {t("Real transfers enabled")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              name="require_change_reason"
              type="checkbox"
              defaultChecked={settings.requireChangeReason}
            />
            {t("Require change reason")}
          </label>
          <label className="text-sm">
            {t("On-call stale after seconds")}
            <input
              name="on_call_stale_after_seconds"
              className={INPUT}
              defaultValue={settings.onCallStaleAfterSeconds ?? ""}
            />
          </label>
          {canEdit ? (
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white sm:col-span-2">
              {t("Save settings")}
            </button>
          ) : null}
        </form>
      )}

      {tab === "rules" && (
        <div className="space-y-4">
          <section className={CARD}>
            <h2 className="text-lg font-semibold">{t("Existing rules")}</h2>
            {rules.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{t("No rules yet")}</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {rules.map((rule) => (
                  <li key={rule.id} className="rounded-lg border border-slate-100 px-3 py-2">
                    {rule.ruleName} · {rule.ruleVersion} · {rule.method} · {rule.mprCentsPerHour} ·{" "}
                    {statusLabel(t, rule.status)}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {canEdit ? (
            <form className={`${CARD} grid gap-3 sm:grid-cols-2`} onSubmit={createRule}>
              <h2 className="text-lg font-semibold sm:col-span-2">{t("Create rule")}</h2>
              <label className="text-sm">
                {t("Jurisdiction")}
                <input name="jurisdiction" className={INPUT} required />
              </label>
              <label className="text-sm">
                {t("Rule name")}
                <input name="rule_name" className={INPUT} required />
              </label>
              <label className="text-sm">
                {t("Version")}
                <input name="rule_version" className={INPUT} required />
              </label>
              <label className="text-sm">
                {t("Minimum hourly rate in cents")}
                <input name="mpr_cents_per_hour" className={INPUT} required />
              </label>
              <label className="text-sm">
                {t("Calculation method")}
                <input name="method" className={INPUT} required />
              </label>
              <label className="text-sm">
                {t("Rounding method")}
                <input name="rounding" className={INPUT} required />
              </label>
              <label className="text-sm">
                {t("Effective start")}
                <input name="effective_from" type="datetime-local" className={INPUT} required />
                <span className="mt-1 block text-xs text-slate-500">
                  {t("Times are interpreted in the engine timezone")}
                </span>
              </label>
              <label className="text-sm">
                {t("Effective end")}
                <input name="effective_to" type="datetime-local" className={INPUT} />
              </label>
              <label className="text-sm sm:col-span-2">
                {t("Eligible earning types")}
                <input name="eligible_source_types" className={INPUT} />
              </label>
              <label className="text-sm sm:col-span-2">
                {t("Excluded earning types")}
                <input name="excluded_source_types" className={INPUT} />
              </label>
              <label className="text-sm">
                {t("Status")}
                <select name="status" className={INPUT} defaultValue="draft">
                  <option value="draft">{t("Draft")}</option>
                  <option value="active">{t("Active")}</option>
                  <option value="archived">{t("Archived")}</option>
                </select>
              </label>
              <label className="text-sm">
                {t("Source URL")}
                <input name="source_url" className={INPUT} />
              </label>
              <label className="text-sm sm:col-span-2">
                {t("Notes")}
                <input name="notes" className={INPUT} />
              </label>
              <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white sm:col-span-2">
                {t("Create")}
              </button>
            </form>
          ) : null}
        </div>
      )}

      {tab === "periods" && (
        <section className={CARD}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t("Pay periods")}</h2>
            {canEdit && settings?.mode !== "off" ? (
              <button
                type="button"
                onClick={() => void closePeriods()}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm text-white"
              >
                {t("Reconcile due periods")}
              </button>
            ) : null}
          </div>
          {periods.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">{t("No periods yet")}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {periods.map((row) => (
                <li key={String(row.id)} className="rounded-lg border border-slate-100 px-3 py-2">
                  {String(row.starts_at)} → {String(row.ends_at)} · {statusLabel(t, String(row.status))} ·{" "}
                  {String(row.method)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "adjustments" && (
        <section className={CARD}>
          <h2 className="text-lg font-semibold">{t("Adjustments")}</h2>
          <p className="mt-2 text-sm text-slate-600">
            {t("Fleet allocation transfers require admin approval.")}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {t("Pending fleet allocations must be reviewed before the NYC payment deadline.")}
          </p>
          {pendingFleet.length > 0 ? (
            <p className="mt-2 text-sm font-medium text-amber-800">
              {t("Pending approval")}: {pendingFleet.length}
            </p>
          ) : null}
          {visibleAdjustments.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">{t("No adjustments yet")}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {visibleAdjustments.map((row) => (
                <li key={String(row.id)} className="rounded-lg border border-slate-100 px-3 py-2">
                  {kindLabel(t, String(row.kind))} · {String(row.adjustment_cents)} ·{" "}
                  {adjustmentStatusLabel(t, row)}
                  <div className="text-slate-500">
                    {t("Required")}: {String(row.required_cents)} · {t("Eligible")}: {String(row.eligible_cents)}
                  </div>
                  {canEdit && isPendingFleetApproval(row) ? (
                    <button
                      type="button"
                      onClick={() => void approveFleetAllocation(String(row.id))}
                      className="mt-2 rounded-xl bg-slate-900 px-3 py-1.5 text-sm text-white"
                    >
                      {t("Approve fleet transfer")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <p className="sr-only">{locale}</p>
    </div>
  );
}

export default function MinimumPayAdminPage() {
  const { t } = useAdminT();
  return (
    <AdminGate requiredPermission="minimum_pay.read">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">{t("Minimum Pay")}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {t("Configure versioned minimum-pay rules without changing application code.")}
        </p>
        <div className="mt-6">
          <MinimumPayInner />
        </div>
      </div>
    </AdminGate>
  );
}
