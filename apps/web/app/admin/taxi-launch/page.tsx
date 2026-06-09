"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiLaunch } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { readinessScoreColor } from "@/lib/taxiLaunchControl";

type LaunchRow = {
  country_code: string;
  name: string;
  currency_code: string;
  launch_status: "enabled" | "disabled" | "maintenance";
  checkout_enabled: boolean;
  payout_enabled: boolean;
  shared_enabled: boolean;
  business_enabled: boolean;
  scheduled_enabled: boolean;
  premium_enabled: boolean;
  active: boolean;
  readiness?: {
    readiness_score?: number;
    dispatch_readiness?: number;
    payment_readiness?: number;
    payout_readiness?: number;
    driver_supply?: number;
    refund_readiness?: number;
    error_rate?: number;
  } | null;
};

function scoreBadge(score: unknown) {
  const n = Number(score ?? 0);
  const color = readinessScoreColor(n);
  const cls =
    color === "green"
      ? "bg-emerald-100 text-emerald-800"
      : color === "orange"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {n}
    </span>
  );
}

export default function AdminTaxiLaunchPage() {
  const [rows, setRows] = useState<LaunchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiLaunch(session?.role ?? null));
    const res = await adminFetch("/api/admin/taxi-launch");
    const body = await res.json().catch(() => ({}));
    setRows(body.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRow(e: FormEvent<HTMLFormElement>, row: LaunchRow) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    setSavingCode(row.country_code);
    try {
      const res = await adminFetch("/api/admin/taxi-launch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country_code: row.country_code,
          launch_status: form.get("launch_status"),
          checkout_enabled: form.get("checkout_enabled") === "on",
          payout_enabled: form.get("payout_enabled") === "on",
          shared_enabled: form.get("shared_enabled") === "on",
          business_enabled: form.get("business_enabled") === "on",
          scheduled_enabled: form.get("scheduled_enabled") === "on",
          premium_enabled: form.get("premium_enabled") === "on",
          active: form.get("active") === "on",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) alert(json.error ?? "Échec");
      else await load();
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <AdminGate requiredPermission="taxi_launch.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Taxi Launch Control</h1>
              <p className="mt-1 text-sm text-slate-600">
                Activer/désactiver les marchés et features sans redéploiement.
              </p>
            </div>
            <a
              href="/admin/taxi-monitoring"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              Monitoring →
            </a>
          </header>

          {loading ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {rows.map((row) => (
                <form
                  key={row.country_code}
                  onSubmit={(e) => void saveRow(e, row)}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-slate-900">
                        {row.country_code} · {row.name}
                      </h2>
                      <p className="text-xs text-slate-500">{row.currency_code}</p>
                    </div>
                    <div className="text-right">
                      {scoreBadge(row.readiness?.readiness_score ?? 0)}
                      <p className="mt-1 text-xs text-slate-500">readiness</p>
                    </div>
                  </div>

                  <div className="mb-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
                    <span>D:{row.readiness?.dispatch_readiness ?? "—"}</span>
                    <span>P:{row.readiness?.payment_readiness ?? "—"}</span>
                    <span>Pay:{row.readiness?.payout_readiness ?? "—"}</span>
                  </div>

                  <label className="mb-3 block text-sm">
                    Statut launch
                    <select
                      name="launch_status"
                      defaultValue={row.launch_status}
                      disabled={!canEdit}
                      className="mt-1 w-full rounded-lg border px-2 py-1"
                    >
                      <option value="enabled">Enabled</option>
                      <option value="disabled">Disabled</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {[
                      ["active", row.active],
                      ["checkout_enabled", row.checkout_enabled],
                      ["payout_enabled", row.payout_enabled],
                      ["shared_enabled", row.shared_enabled],
                      ["business_enabled", row.business_enabled],
                      ["scheduled_enabled", row.scheduled_enabled],
                      ["premium_enabled", row.premium_enabled],
                    ].map(([name, checked]) => (
                      <label key={String(name)} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name={String(name)}
                          defaultChecked={Boolean(checked)}
                          disabled={!canEdit}
                        />
                        {String(name).replace(/_enabled$/, "")}
                      </label>
                    ))}
                  </div>

                  {canEdit ? (
                    <button
                      type="submit"
                      disabled={savingCode === row.country_code}
                      className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {savingCode === row.country_code ? "Saving…" : "Save"}
                    </button>
                  ) : null}
                </form>
              ))}
            </div>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
