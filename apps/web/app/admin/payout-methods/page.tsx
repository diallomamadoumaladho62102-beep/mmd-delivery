"use client";


import { useAdminT } from "@/i18n/useAdminT";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canModifyPricing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import type {
  PayoutFrequency,
  PayoutProvider,
  PayoutRecipientType,
} from "@/lib/payoutTypes";

type AdminPayoutMethodRow = {
  id: string;
  country_code: string;
  recipient_type: PayoutRecipientType;
  provider: PayoutProvider;
  method_code: string;
  display_name: string;
  description: string | null;
  sort_order: number;
  enabled: boolean;
  test_mode: boolean;
  auto_payout_enabled: boolean;
  payout_frequency: PayoutFrequency;
  minimum_payout_cents: number;
  platform_commission_pct: number;
  runtime_available: boolean;
  unavailable_reason: string | null;
  secrets_configured: boolean;
  secrets_missing: string[];
};

type Meta = {
  providers: PayoutProvider[];
  recipient_types: PayoutRecipientType[];
  payout_frequencies: PayoutFrequency[];
  payout_statuses: string[];
};

const PROVIDER_LABELS: Record<PayoutProvider, string> = {
  stripe_connect: "Stripe Connect",
  orange_money_gn: "Orange Money Guinea",
  paydunya: "PayDunya",
  cinetpay: "CinetPay",
  bank_transfer: "Bank transfer",
  wave: "Wave",
  mtn_momo: "MTN Mobile Money",
  moov_money: "Moov Money",
  free_money: "Free Money",
};

function getRecipientLabels(t: (source: string) => string): Record<PayoutRecipientType, string> {
  return {
  driver: "Driver / livreur",
  restaurant: t("Restaurant"),
  seller: "Marketplace seller",
  partner: "Partner",
  business: "Business account",
  };
}

function availabilityBadge(
  row: AdminPayoutMethodRow,
  t: (english: string) => string,
) {
  if (row.runtime_available) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
        {t("Available")}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
      {t("Unavailable")}
    </span>
  );
}

export default function AdminPayoutMethodsPage() {
  const { t } = useAdminT();
  const recipientLabels = getRecipientLabels(t);

  const [items, setItems] = useState<AdminPayoutMethodRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [countryFilter, setCountryFilter] = useState("");
  const [recipientFilter, setRecipientFilter] = useState("");
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
      const params = new URLSearchParams();
      if (countryFilter) params.set("country_code", countryFilter);
      if (recipientFilter) params.set("recipient_type", recipientFilter);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await adminFetch(`/api/admin/payout-methods${query}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Load failed");
      setItems(json.items ?? []);
      setMeta(json.meta ?? null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [countryFilter, recipientFilter]);

  useEffect(() => {
    void resolveBrowserStaffSession().then((session) => {
      setRole(session?.role ?? null);
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRow(e: FormEvent<HTMLFormElement>, row: AdminPayoutMethodRow) {
    e.preventDefault();
    if (!canEdit) return;

    const form = new FormData(e.currentTarget);
    setSavingId(row.id);
    try {
      const payload = {
        provider: String(form.get("provider") ?? row.provider),
        enabled: form.get("enabled") === "on",
        test_mode: form.get("test_mode") === "on",
        auto_payout_enabled: form.get("auto_payout_enabled") === "on",
        display_name: String(form.get("display_name") ?? row.display_name),
        description: String(form.get("description") ?? ""),
        sort_order: Number(form.get("sort_order") ?? row.sort_order),
        payout_frequency: String(form.get("payout_frequency") ?? row.payout_frequency),
        minimum_payout_cents: Number(form.get("minimum_payout_cents") ?? row.minimum_payout_cents),
        platform_commission_pct: Number(
          form.get("platform_commission_pct") ?? row.platform_commission_pct
        ),
      };

      const res = await adminFetch(`/api/admin/payout-methods/${row.id}`, {
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
      <main className="space-y-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900">{t("Payout Methods (Outbound)")}</h1>
            <p className="text-sm text-slate-600">
              Configure how MMD pays drivers, restaurants, marketplace sellers and partners per
              country. Inbound client payment methods are managed separately.
            </p>
            {meta ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <div>
                  <span className="font-semibold">{t("Payout statuses:")}</span>{" "}
                  {meta.payout_statuses.join(", ")}
                </div>
              </div>
            ) : null}
          </header>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-slate-700">
              {t("Country")}
              <select
                className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
              >
                <option value="">{t("All countries")}</option>
                {countryOptions.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              {t("Recipient")}
              <select
                className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={recipientFilter}
                onChange={(e) => setRecipientFilter(e.target.value)}
              >
                <option value="">{t("All recipients")}</option>
                {(meta?.recipient_types ?? ["driver", "restaurant", "seller", "partner"]).map(
                  (type) => (
                    <option key={type} value={type}>
                      {recipientLabels[type as PayoutRecipientType] ?? type}
                    </option>
                  )
                )}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              {t("Refresh")}
            </button>
            <a
              href="/admin/payment-methods"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              {t("Inbound payment methods →")}
            </a>
          </div>

          {loading ? (
            <p className="text-sm text-slate-600">{t("Loading payout methods…")}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-600">{t("No payout methods found.")}</p>
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
                          {row.country_code} · {recipientLabels[row.recipient_type]} ·{" "}
                          {row.display_name}
                        </h2>
                        {availabilityBadge(row, t)}
                        {row.enabled ? (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                            {t("Enabled")}
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                            {t("Disabled")}
                          </span>
                        )}
                        {row.auto_payout_enabled ? (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">
                            {t("Auto payout")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        {t("Method code:")} <code>{row.method_code}</code>
                      </p>
                    </div>
                    <button
                      type="submit"
                      disabled={!canEdit || savingId === row.id}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {savingId === row.id ? t("Saving…") : t("Save")}
                    </button>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <label className="block text-sm">
                      <span className="font-medium text-slate-700">{t("Provider")}</span>
                      <select
                        name="provider"
                        defaultValue={row.provider}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        {(meta?.providers ?? Object.keys(PROVIDER_LABELS)).map((provider) => (
                          <option key={provider} value={provider}>
                            {PROVIDER_LABELS[provider as PayoutProvider] ?? provider}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-sm">
                      <span className="font-medium text-slate-700">{t("Display name")}</span>
                      <input
                        name="display_name"
                        defaultValue={row.display_name}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>

                    <label className="block text-sm">
                      <span className="font-medium text-slate-700">{t("Sort order")}</span>
                      <input
                        name="sort_order"
                        type="number"
                        defaultValue={row.sort_order}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>

                    <label className="block text-sm">
                      <span className="font-medium text-slate-700">{t("Payout frequency")}</span>
                      <select
                        name="payout_frequency"
                        defaultValue={row.payout_frequency}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        {(meta?.payout_frequencies ?? ["immediate", "daily", "weekly", "manual"]).map(
                          (frequency) => (
                            <option key={frequency} value={frequency}>
                              {frequency}
                            </option>
                          )
                        )}
                      </select>
                    </label>

                    <label className="block text-sm">
                      <span className="font-medium text-slate-700">{t("Minimum payout (cents)")}</span>
                      <input
                        name="minimum_payout_cents"
                        type="number"
                        min={0}
                        defaultValue={row.minimum_payout_cents}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>

                    <label className="block text-sm">
                      <span className="font-medium text-slate-700">{t("Platform commission (%)")}</span>
                      <input
                        name="platform_commission_pct"
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        defaultValue={row.platform_commission_pct}
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
                      <span className="font-medium text-slate-700">{t("Enabled for payouts")}</span>
                    </label>

                    <label className="flex items-center gap-2 text-sm md:col-span-2 xl:col-span-3">
                      <input
                        type="checkbox"
                        name="test_mode"
                        defaultChecked={row.test_mode}
                        disabled={!canEdit}
                      />
                      <span className="font-medium text-slate-700">{t("Test mode")}</span>
                    </label>

                    <label className="flex items-center gap-2 text-sm md:col-span-2 xl:col-span-3">
                      <input
                        type="checkbox"
                        name="auto_payout_enabled"
                        defaultChecked={row.auto_payout_enabled}
                        disabled={!canEdit}
                      />
                      <span className="font-medium text-slate-700">{t("Automatic payout (vs manual approval)")}</span>
                    </label>

                    <label className="block text-sm md:col-span-2 xl:col-span-3">
                      <span className="font-medium text-slate-700">{t("Description")}</span>
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
                      <span className="font-semibold">{t("Runtime availability:")}</span>{" "}
                      {row.runtime_available
                        ? t("Available")
                        : row.unavailable_reason ?? t("Unavailable")}
                    </div>
                    <div className="mt-1">
                      <span className="font-semibold">{t("Provider secrets:")}</span>{" "}
                      {row.secrets_configured
                        ? t("Configured")
                        : `${t("Missing")}: ${row.secrets_missing.join(", ")}`}
                    </div>
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
