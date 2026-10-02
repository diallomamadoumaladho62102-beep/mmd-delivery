"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageDriverIntegrity, canReviewDriverIntegrity } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { useAdminT } from "@/i18n/useAdminT";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";

type Settings = {
  monitoringEnabled: boolean;
  warningNotificationsEnabled: boolean;
  reassignmentEnabled: boolean;
  contactEnabled: boolean;
  reviewEnabled: boolean;
  sanctionWorkflowEnabled: boolean;
  driverAcceptanceWarningAfterSeconds: number | null;
  driverNoProgressReassignmentAfterSeconds: number | null;
  driverPickupProgressWarningAfterSeconds: number | null;
  driverNoProgressReviewAfterSeconds: number | null;
  restaurantWaitReviewThresholdSeconds: number | null;
  longTripThresholdSeconds: number | null;
  stationaryThresholdSeconds: number | null;
  impossibleSpeedThresholdMps: number | null;
  gpsStaleAfterSeconds: number | null;
  gpsJumpThresholdMeters: number | null;
  movementProgressThresholdMeters: number | null;
  requireChangeReason: boolean;
};

type Tab = "overview" | "incidents" | "reviews" | "disputes" | "communications" | "settings";

function errorMessage(t: (s: string) => string, code: string): string {
  const map: Record<string, string> = {
    reason_required: t("A change reason is required"),
    forbidden: t("Forbidden"),
    settings_load_failed: t("Unable to load settings"),
    settings_save_failed: t("Unable to save settings"),
    super_admin_required: t("Only Super Admin can enable Active mode or real transfers"),
    invalid_threshold: t("Invalid threshold"),
    contact_disabled: t("Contact driver is disabled"),
    invalid_transition: t("Invalid status"),
  };
  return map[code] ?? t("Unable to complete this action");
}

function yesNo(t: (s: string) => string, value: boolean): string {
  return value ? t("Yes") : t("No");
}

function statusLabel(t: (s: string) => string, status: string): string {
  const map: Record<string, string> = {
    open: t("Open"),
    warning: t("Warning"),
    final_warning: t("Final warning"),
    reassigned: t("Reassigned"),
    review: t("Review"),
    confirmed: t("Confirmed"),
    not_confirmed: t("Not confirmed"),
    policy_action: t("Policy action"),
    closed: t("Closed"),
    info: t("Info"),
    low: t("Low"),
    medium: t("Medium"),
    high: t("High"),
    restaurant_delay: t("Restaurant delay"),
    order_issue: t("Order issue"),
    traffic: t("Traffic"),
    gps_issue: t("GPS issue"),
    technical_issue: t("Technical issue"),
    vehicle_issue: t("Vehicle issue"),
    safety_issue: t("Safety issue"),
    other: t("Other"),
  };
  return map[status] ?? status;
}

function DriverIntegrityInner() {
  const { t } = useAdminT();
  const [canEdit, setCanEdit] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [incidents, setIncidents] = useState<Array<Record<string, unknown>>>([]);
  const [warnings, setWarnings] = useState<Array<Record<string, unknown>>>([]);
  const [reviews, setReviews] = useState<Array<Record<string, unknown>>>([]);
  const [disputes, setDisputes] = useState<Array<Record<string, unknown>>>([]);
  const [contacts, setContacts] = useState<Array<Record<string, unknown>>>([]);
  const [reason, setReason] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [contactDriverId, setContactDriverId] = useState("");
  const [contactReason, setContactReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageDriverIntegrity(session?.role ?? null));
    setCanReview(canReviewDriverIntegrity(session?.role ?? null));
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
    const [settingsHttp, incidentsHttp, reviewsHttp, disputesHttp, contactsHttp] =
      await Promise.all([
        adminFetch("/api/admin/driver-integrity/settings"),
        adminFetch(`/api/admin/driver-integrity/incidents${qs}`),
        adminFetch("/api/admin/driver-integrity/reviews"),
        adminFetch("/api/admin/driver-integrity/disputes"),
        adminFetch("/api/admin/driver-integrity/contact"),
      ]);
    const settingsJson = await settingsHttp.json();
    const incidentsJson = await incidentsHttp.json();
    const reviewsJson = await reviewsHttp.json();
    const disputesJson = await disputesHttp.json();
    const contactsJson = await contactsHttp.json();
    if (!settingsJson.ok) setError(errorMessage(t, String(settingsJson.error ?? "")));
    setSettings(settingsJson.settings ?? null);
    setIncidents(incidentsJson.incidents ?? []);
    setWarnings(incidentsJson.warnings ?? []);
    setReviews(reviewsJson.reviews ?? []);
    setDisputes(disputesJson.disputes ?? []);
    setContacts(contactsJson.contacts ?? []);
    setLoading(false);
  }, [statusFilter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setError(null);
    setNotice(null);
    const res = await adminFetch("/api/admin/driver-integrity/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason,
        monitoring_enabled: settings.monitoringEnabled,
        warning_notifications_enabled: settings.warningNotificationsEnabled,
        reassignment_enabled: settings.reassignmentEnabled,
        contact_enabled: settings.contactEnabled,
        review_enabled: settings.reviewEnabled,
        sanction_workflow_enabled: settings.sanctionWorkflowEnabled,
        driver_acceptance_warning_after_seconds:
          settings.driverAcceptanceWarningAfterSeconds,
        driver_no_progress_reassignment_after_seconds:
          settings.driverNoProgressReassignmentAfterSeconds,
        driver_pickup_progress_warning_after_seconds:
          settings.driverPickupProgressWarningAfterSeconds,
        driver_no_progress_review_after_seconds:
          settings.driverNoProgressReviewAfterSeconds,
        restaurant_wait_review_threshold_seconds:
          settings.restaurantWaitReviewThresholdSeconds,
        long_trip_threshold_seconds: settings.longTripThresholdSeconds,
        stationary_threshold_seconds: settings.stationaryThresholdSeconds,
        impossible_speed_threshold_mps: settings.impossibleSpeedThresholdMps,
        gps_stale_after_seconds: settings.gpsStaleAfterSeconds,
        gps_jump_threshold_meters: settings.gpsJumpThresholdMeters,
        movement_progress_threshold_meters: settings.movementProgressThresholdMeters,
      }),
    });
    const json = await res.json();
    if (!json.ok) {
      setError(errorMessage(t, String(json.error ?? "")));
      return;
    }
    setSettings(json.settings);
    setNotice(t("Saved"));
  }

  async function reviewAction(incidentId: string, action: string, policy?: string) {
    setError(null);
    const res = await adminFetch("/api/admin/driver-integrity/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: incidentId,
        action,
        policy_action: policy,
        notes: reason,
      }),
    });
    const json = await res.json();
    if (!json.ok) {
      setError(errorMessage(t, String(json.error ?? "")));
      return;
    }
    setNotice(t("Saved"));
    await load();
  }

  async function contactDriver(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const res = await adminFetch("/api/admin/driver-integrity/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driver_id: contactDriverId,
        reason: contactReason,
      }),
    });
    const json = await res.json();
    if (!json.ok) {
      setError(errorMessage(t, String(json.error ?? "")));
      return;
    }
    setNotice(t("Saved"));
    setContactDriverId("");
    setContactReason("");
    await load();
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: t("Overview") },
    { id: "incidents", label: t("Incidents") },
    { id: "reviews", label: t("Reviews") },
    { id: "disputes", label: t("Disputes") },
    { id: "communications", label: t("Communications") },
    { id: "settings", label: t("Settings") },
  ];

  const warningCount = warnings.filter((w) => w.warning_kind === "first").length;
  const noProgress = incidents.filter((i) =>
    ["open", "warning", "final_warning"].includes(String(i.status))
  ).length;
  const reassigned = incidents.filter((i) => i.status === "reassigned").length;
  const sanctionCount = incidents.filter((i) => i.status === "policy_action").length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{t("Driver Integrity")}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {t("Operational anti-abuse monitoring. An anomaly is not automatic fraud.")}
        </p>
      </header>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded-full px-3 py-1 text-sm ${
              tab === item.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
            }`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
        <button type="button" className="rounded-full bg-slate-100 px-3 py-1 text-sm" onClick={() => void load()}>
          {t("Refresh")}
        </button>
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className={CARD}>
            <p className="text-sm text-slate-500">{t("Active warnings")}</p>
            <p className="mt-2 text-2xl font-semibold">{warningCount}</p>
          </div>
          <div className={CARD}>
            <p className="text-sm text-slate-500">{t("Drivers without progress")}</p>
            <p className="mt-2 text-2xl font-semibold">{noProgress}</p>
          </div>
          <div className={CARD}>
            <p className="text-sm text-slate-500">{t("Reassigned orders")}</p>
            <p className="mt-2 text-2xl font-semibold">{reassigned}</p>
          </div>
          <div className={CARD}>
            <p className="text-sm text-slate-500">{t("Sanctions")}</p>
            <p className="mt-2 text-2xl font-semibold">{sanctionCount}</p>
          </div>
          <div className={`${CARD} md:col-span-2`}>
            <p className="text-sm font-medium">{t("Monitoring enabled")}</p>
            <p className="mt-1">{yesNo(t, settings?.monitoringEnabled === true)}</p>
            <p className="mt-3 text-sm font-medium">{t("Automatic reassignment enabled")}</p>
            <p className="mt-1">{yesNo(t, settings?.reassignmentEnabled === true)}</p>
          </div>
        </div>
      ) : null}

      {tab === "incidents" ? (
        <section className={CARD}>
          <div className="mb-3 flex flex-wrap gap-2">
            <select
              className={INPUT}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t("Status")}</option>
              <option value="warning">{t("Warning")}</option>
              <option value="reassigned">{t("Reassigned")}</option>
              <option value="review">{t("Review")}</option>
              <option value="confirmed">{t("Confirmed")}</option>
              <option value="not_confirmed">{t("Not confirmed")}</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2">{t("Status")}</th>
                  <th>{t("Driver")}</th>
                  <th>{t("Trip")}</th>
                  <th>{t("Severity")}</th>
                  <th>{t("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((row) => (
                  <tr key={String(row.id)} className="border-t border-slate-100">
                    <td className="py-2">{statusLabel(t, String(row.status))}</td>
                    <td className="font-mono text-xs">{String(row.original_driver_id)}</td>
                    <td className="font-mono text-xs">{String(row.entity_id)}</td>
                    <td>{statusLabel(t, String(row.severity))}</td>
                    <td>
                      {canReview ? (
                        <button
                          type="button"
                          className="text-sm text-slate-700 underline"
                          onClick={() => void reviewAction(String(row.id), "open_review")}
                        >
                          {t("Open review")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {loading ? <p className="mt-3 text-sm">{t("Loading…")}</p> : null}
        </section>
      ) : null}

      {tab === "reviews" ? (
        <section className={CARD}>
          <ul className="space-y-3 text-sm">
            {reviews.map((row) => (
              <li key={String(row.id)} className="rounded-xl border border-slate-100 p-3">
                <p>{t("Status")}: {statusLabel(t, String(row.status))}</p>
                {canReview ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void reviewAction(String(row.incident_id), "confirm")}>
                      {t("Confirmed")}
                    </button>
                    <button type="button" onClick={() => void reviewAction(String(row.incident_id), "not_confirm")}>
                      {t("Not confirmed")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void reviewAction(String(row.incident_id), "policy", "warning")}
                    >
                      {t("Policy action")}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "disputes" ? (
        <section className={CARD}>
          <ul className="space-y-2 text-sm">
            {disputes.map((row) => (
              <li key={String(row.id)}>
                {statusLabel(t, String(row.reason_code))} — {String(row.entity_id)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "communications" ? (
        <section className={`${CARD} space-y-4`}>
          {canEdit ? (
            <form onSubmit={contactDriver} className="space-y-3">
              <h2 className="font-medium">{t("Contact driver")}</h2>
              <input
                className={INPUT}
                value={contactDriverId}
                onChange={(e) => setContactDriverId(e.target.value)}
                placeholder={t("Driver")}
              />
              <textarea
                className={INPUT}
                value={contactReason}
                onChange={(e) => setContactReason(e.target.value)}
                placeholder={t("Reason")}
              />
              <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
                {t("Send")}
              </button>
            </form>
          ) : null}
          <ul className="space-y-2 text-sm">
            {contacts.map((row) => (
              <li key={String(row.id)}>
                {String(row.created_at)} — {String(row.channel)} — {String(row.reason ?? "")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "settings" ? (
        <form className={`${CARD} space-y-4`} onSubmit={saveSettings}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings?.monitoringEnabled === true}
              disabled={!canEdit}
              onChange={(e) =>
                setSettings((s) => s && { ...s, monitoringEnabled: e.target.checked })
              }
            />
            {t("Monitoring enabled")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings?.warningNotificationsEnabled === true}
              disabled={!canEdit}
              onChange={(e) =>
                setSettings((s) => s && { ...s, warningNotificationsEnabled: e.target.checked })
              }
            />
            {t("Warning notifications enabled")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings?.reassignmentEnabled === true}
              disabled={!canEdit}
              onChange={(e) =>
                setSettings((s) => s && { ...s, reassignmentEnabled: e.target.checked })
              }
            />
            {t("Automatic reassignment enabled")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings?.contactEnabled === true}
              disabled={!canEdit}
              onChange={(e) =>
                setSettings((s) => s && { ...s, contactEnabled: e.target.checked })
              }
            />
            {t("Contact enabled")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings?.reviewEnabled === true}
              disabled={!canEdit}
              onChange={(e) =>
                setSettings((s) => s && { ...s, reviewEnabled: e.target.checked })
              }
            />
            {t("Review enabled")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings?.sanctionWorkflowEnabled === true}
              disabled={!canEdit}
              onChange={(e) =>
                setSettings((s) => s && { ...s, sanctionWorkflowEnabled: e.target.checked })
              }
            />
            {t("Sanction workflow enabled")}
          </label>
          {[
            ["driverAcceptanceWarningAfterSeconds", "Warning after accept (seconds)"],
            ["driverNoProgressReassignmentAfterSeconds", "Reassignment after no progress (seconds)"],
            ["driverPickupProgressWarningAfterSeconds", "Pickup progress warning (seconds)"],
            ["driverNoProgressReviewAfterSeconds", "Review after no progress (seconds)"],
            ["restaurantWaitReviewThresholdSeconds", "Restaurant wait review threshold (seconds)"],
            ["longTripThresholdSeconds", "Long trip threshold (seconds)"],
            ["stationaryThresholdSeconds", "Stationary threshold (seconds)"],
            ["gpsStaleAfterSeconds", "GPS stale after (seconds)"],
            ["gpsJumpThresholdMeters", "GPS jump threshold (meters)"],
            ["movementProgressThresholdMeters", "Movement progress threshold (meters)"],
          ].map(([field, label]) => (
            <label key={field} className="block text-sm">
              {t(label)}
              <input
                className={INPUT}
                type="number"
                min={1}
                disabled={!canEdit}
                value={(settings?.[field as keyof Settings] as number | null) ?? ""}
                onChange={(e) =>
                  setSettings(
                    (s) =>
                      s && {
                        ...s,
                        [field]: e.target.value === "" ? null : Number(e.target.value),
                      }
                  )
                }
              />
            </label>
          ))}
          <label className="block text-sm">
            {t("Impossible speed threshold (m/s)")}
            <input
              className={INPUT}
              type="number"
              min={0}
              step="0.1"
              disabled={!canEdit}
              value={settings?.impossibleSpeedThresholdMps ?? ""}
              onChange={(e) =>
                setSettings(
                  (s) =>
                    s && {
                      ...s,
                      impossibleSpeedThresholdMps:
                        e.target.value === "" ? null : Number(e.target.value),
                    }
                )
              }
            />
          </label>
          <label className="block text-sm">
            {t("Change reason")}
            <input className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {canEdit ? (
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
              {t("Save")}
            </button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

export default function DriverIntegrityPage() {
  return (
    <AdminGate requiredPermission="driver_integrity.read">
      <DriverIntegrityInner />
    </AdminGate>
  );
}
