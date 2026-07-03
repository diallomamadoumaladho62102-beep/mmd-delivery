"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canModifyPricing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import type { PaymentProvider } from "@/lib/paymentTypes";

type AdminPaymentMethodRow = {
  id: string;
  country_code: string;
  provider: PaymentProvider;
  method_code: string;
  display_name: string;
  description: string | null;
  sort_order: number;
  enabled: boolean;
  test_mode: boolean;
  runtime_available: boolean;
  unavailable_reason: string | null;
  secrets_configured: boolean;
  secrets_missing: string[];
  stripe_gn_env_enabled: boolean;
  webhook_url: string | null;
};

type Meta = {
  public_base_url: string;
  stripe_gn_env_enabled: boolean;
  providers: PaymentProvider[];
};

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  stripe: "Stripe",
  orange_money_gn: "Orange Money Guinea",
  paydunya: "PayDunya",
  cinetpay: "CinetPay",
};

function availabilityBadge(row: AdminPaymentMethodRow) {
  if (row.runtime_available) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
        Available
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
      Unavailable
    </span>
  );
}

export default function AdminPaymentMethodsPage() {
  const [items, setItems] = useState<AdminPaymentMethodRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [countryFilter, setCountryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const canEdit = canModifyPricing(role as any);

  const countryOptions = useMemo(() => {
    const set = new Set(items.map((row) => row.country_code));
    return Array.from(set).sort();
  }, [items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = countryFilter ? `?country_code=${encodeURIComponent(countryFilter)}` : "";
      const res = await adminFetch(`/api/admin/payment-methods${query}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Load failed");
      setItems(json.items ?? []);
      setMeta(json.meta ?? null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [countryFilter]);

  useEffect(() => {
    void resolveBrowserStaffSession().then((session) => {
      setRole(session?.role ?? null);
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRow(e: FormEvent<HTMLFormElement>, row: AdminPaymentMethodRow) {
    e.preventDefault();
    if (!canEdit) return;

    const form = new FormData(e.currentTarget);
    setSavingId(row.id);
    try {
      const payload = {
        provider: String(form.get("provider") ?? row.provider),
        enabled: form.get("enabled") === "on",
        test_mode: form.get("test_mode") === "on",
        display_name: String(form.get("display_name") ?? row.display_name),
        description: String(form.get("description") ?? ""),
        sort_order: Number(form.get("sort_order") ?? row.sort_order),
      };

      const res = await adminFetch(`/api/admin/payment-methods/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        alert(json.error ?? "Save failed");
        return;
      }
      await load();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AdminGate requiredPermission="pricing.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900">Payment Methods</h1>
            <p className="text-sm text-slate-600">
              Country-based payment routing for Stripe and local mobile money. Provider secrets
              stay on the server — this page only toggles availability and shows runtime status.
            </p>
            {meta ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <div>
                  <span className="font-semibold">Public base URL:</span> {meta.public_base_url}
                </div>
                <div className="mt-1">
                  <span className="font-semibold">STRIPE_ENABLED_GN:</span>{" "}
                  {meta.stripe_gn_env_enabled ? (
                    <span className="text-emerald-700">true</span>
                  ) : (
                    <span className="text-amber-700">false — Stripe blocked in Guinea</span>
                  )}
                </div>
              </div>
            ) : null}
          </header>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-slate-700">
              Country
              <select
                className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
              >
                <option value="">All countries</option>
                {countryOptions.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              Refresh
            </button>
            <a
              href="/admin/pricing"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              Pricing →
            </a>
          </div>

          {loading ? (
            <p className="text-sm text-slate-600">Loading payment methods…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-600">No payment methods found.</p>
          ) : (
            <div className="space-y-4">
              {items.map((row) => (
                <form
                  key={row.id}
                  onSubmit={(e) => void saveRow(e, row)}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-slate-900">
                          {row.country_code} · {row.display_name}
                        </h2>
                        {availabilityBadge(row)}
                        {row.enabled ? (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                            Enabled
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                            Disabled
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        Method code: <code>{row.method_code}</code>
                      </p>
                    </div>
                    <button
                      type="submit"
                      disabled={!canEdit || savingId === row.id}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {savingId === row.id ? "Saving…" : "Save"}
                    </button>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <label className="block text-sm">
                      <span className="font-medium text-slate-700">Provider</span>
                      <select
                        name="provider"
                        defaultValue={row.provider}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        {(meta?.providers ?? Object.keys(PROVIDER_LABELS)).map((provider) => (
                          <option key={provider} value={provider}>
                            {PROVIDER_LABELS[provider as PaymentProvider] ?? provider}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-sm">
                      <span className="font-medium text-slate-700">Display name</span>
                      <input
                        name="display_name"
                        defaultValue={row.display_name}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>

                    <label className="block text-sm">
                      <span className="font-medium text-slate-700">Sort order</span>
                      <input
                        name="sort_order"
                        type="number"
                        defaultValue={row.sort_order}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>

                    <label className="flex items-center gap-2 text-sm md:col-span-2 xl:col-span-3">
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={row.enabled}
                        disabled={!canEdit}
                      />
                      <span className="font-medium text-slate-700">Enabled for clients</span>
                    </label>

                    <label className="flex items-center gap-2 text-sm md:col-span-2 xl:col-span-3">
                      <input
                        type="checkbox"
                        name="test_mode"
                        defaultChecked={row.test_mode}
                        disabled={!canEdit}
                      />
                      <span className="font-medium text-slate-700">Test mode</span>
                    </label>

                    <label className="block text-sm md:col-span-2 xl:col-span-3">
                      <span className="font-medium text-slate-700">Description</span>
                      <input
                        name="description"
                        defaultValue={row.description ?? ""}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                  </div>

                  <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                    <div>
                      <span className="font-semibold">Runtime availability:</span>{" "}
                      {row.runtime_available ? "Available" : row.unavailable_reason ?? "Unavailable"}
                    </div>
                    <div className="mt-1">
                      <span className="font-semibold">Provider secrets:</span>{" "}
                      {row.secrets_configured
                        ? "Configured"
                        : `Missing: ${row.secrets_missing.join(", ")}`}
                    </div>
                    {row.country_code === "GN" && row.provider === "stripe" ? (
                      <div className="mt-1 text-amber-800">
                        Guinea Stripe requires server env <code>STRIPE_ENABLED_GN=true</code>{" "}
                        {row.stripe_gn_env_enabled ? "(currently ON)" : "(currently OFF)"}
                      </div>
                    ) : null}
                    {row.webhook_url ? (
                      <div className="mt-1 break-all">
                        <span className="font-semibold">Webhook URL:</span> {row.webhook_url}
                      </div>
                    ) : null}
                  </div>
                </form>
              ))}
            </div>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
