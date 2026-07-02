"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminCancelRefundPanel from "@/components/AdminCancelRefundPanel";
import AdminPricingHistory from "@/components/admin/AdminPricingHistory";
import { canModifyPricing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type PricingRow = {
  id: string;
  config_key: string;
  label: string;
  order_type: "food" | "errand" | "marketplace";
  active: boolean;
  client_pct: number | null;
  driver_pct: number | null;
  restaurant_pct: number | null;
  platform_pct: number | null;
  delivery_fee_base: number | null;
  delivery_fee_per_mile: number | null;
  delivery_fee_per_minute: number | null;
  delivery_platform_pct: number | null;
  delivery_driver_pct: number | null;
  minimum_order_amount: number | null;
  promo_enabled: boolean;
  promo_type: "percent" | "fixed" | "free_delivery" | null;
  promo_value: number | null;
  promo_code: string | null;
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  region: "global" | "us" | "africa" | null;
  tax_enabled: boolean;
  tax_pct: number | null;
  tax_label: string | null;
  fixed_client_fee: number | null;
  service_fee_enabled: boolean;
  service_fee_pct: number | null;
  service_fee_fixed_cents: number | null;
  currency: string | null;
  updated_at: string | null;
};

type SplitStatus = {
  total: number;
  isExact: boolean;
  isOver: boolean;
  label: string;
  tone: "ok" | "warn" | "danger";
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "???";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function numberValue(value: number | null | undefined) {
  return value ?? 0;
}

function moneyValue(value: number | null | undefined) {
  return Number(numberValue(value)).toFixed(2);
}

function pctValue(value: number | null | undefined) {
  return Number(numberValue(value)).toFixed(2).replace(/\.00$/, "");
}

function splitStatus(parts: Array<number | null | undefined>): SplitStatus {
  const total = parts.reduce((sum, value) => sum + numberValue(value), 0);
  const rounded = round2(total);
  const isExact = Math.abs(rounded - 100) < 0.01;
  const isOver = rounded > 100;

  if (isExact) {
    return {
      total: rounded,
      isExact,
      isOver,
      label: "Balanced at 100% / ??quilibr?? ?? 100%",
      tone: "ok",
    };
  }

  if (isOver) {
    return {
      total: rounded,
      isExact,
      isOver,
      label: `Over by ${(rounded - 100).toFixed(2)}% / D??passe de ${(rounded - 100).toFixed(2)}%`,
      tone: "danger",
    };
  }

  return {
    total: rounded,
    isExact,
    isOver,
    label: `Remaining ${(100 - rounded).toFixed(2)}% / Reste ${(100 - rounded).toFixed(2)}%`,
    tone: "warn",
  };
}

function toneClasses(tone: SplitStatus["tone"]) {
  if (tone === "ok") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (tone === "danger") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  return "border-amber-200 bg-amber-50 text-amber-800";
}

function sectionTitle(title: string, subtitle: string) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="text-xs leading-5 text-slate-500">{subtitle}</div>
    </div>
  );
}

function PercentInput({
  name,
  label,
  value,
  help,
}: {
  name: string;
  label: string;
  value: number | null | undefined;
  help?: string;
}) {
  return (
    <label className="space-y-1">
      <div className="text-sm font-medium text-slate-800">{label}</div>
      <div className="relative">
        <input
          type="number"
          step="0.01"
          min="0"
          max="100"
          name={name}
          defaultValue={numberValue(value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
          %
        </span>
      </div>
      {help ? <div className="text-[11px] leading-4 text-slate-500">{help}</div> : null}
    </label>
  );
}

function MoneyInput({
  name,
  label,
  value,
  help,
}: {
  name: string;
  label: string;
  value: number | null | undefined;
  help?: string;
}) {
  return (
    <label className="space-y-1">
      <div className="text-sm font-medium text-slate-800">{label}</div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
          $
        </span>
        <input
          type="number"
          step="0.01"
          min="0"
          name={name}
          defaultValue={moneyValue(value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-7 py-2 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
        />
      </div>
      {help ? <div className="text-[11px] leading-4 text-slate-500">{help}</div> : null}
    </label>
  );
}

function TextInputField({
  name,
  label,
  value,
  placeholder,
  help,
}: {
  name: string;
  label: string;
  value: string | null | undefined;
  placeholder?: string;
  help?: string;
}) {
  return (
    <label className="space-y-1">
      <div className="text-sm font-medium text-slate-800">{label}</div>
      <input
        name={name}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
      />
      {help ? <div className="text-[11px] leading-4 text-slate-500">{help}</div> : null}
    </label>
  );
}

function SplitSummary({
  title,
  status,
  items,
}: {
  title: string;
  status: SplitStatus;
  items: Array<{ label: string; value: number | null | undefined }>;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClasses(status.tone)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide opacity-75">
            {title}
          </div>
          <div className="mt-1 text-sm font-semibold">{status.label}</div>
        </div>
        <div className="rounded-full bg-white/70 px-3 py-1 text-sm font-black">
          Total {pctValue(status.total)}%
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-xl bg-white/60 px-3 py-2">
            <div className="text-[11px] font-semibold opacity-70">
              {item.label}
            </div>
            <div className="text-sm font-black">{pctValue(item.value)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}


export default function AdminPricingView() {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await resolveBrowserStaffSession();
      setCanWrite(session ? canModifyPricing(session.role) : false);

      const res = await adminFetch("/api/admin/pricing");
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Failed to load pricing");
      }
      setRows((body.items ?? []) as PricingRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pricing");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  async function handleSave(e: FormEvent<HTMLFormElement>, rowId: string) {
    e.preventDefault();
    if (!canWrite) return;

    setSavingId(rowId);
    setSaveMessage(null);
    setError(null);

    try {
      const formData = new FormData(e.currentTarget);
      const res = await adminFetch("/api/admin/pricing", {
        method: "POST",
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Failed to save pricing");
      }
      setSaveMessage("Saved / Enregistré");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save pricing");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Chargement pricing…</div>;
  }

  return (
<main className="mx-auto max-w-6xl space-y-6 bg-slate-50 p-6 text-slate-950">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {saveMessage ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {saveMessage}
        </div>
      ) : null}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex rounded-full bg-black px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
              MMD Delivery Admin
            </div>
            <h1 className="text-2xl font-black tracking-tight">
              Pricing Configuration / Configuration des prix
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Edit commissions, promotions, delivery pricing and payout splits from
              <span className="font-semibold text-slate-900"> Supabase pricing_config</span>{" "}
              without changing the mobile app code. / Modifie les commissions,
              promotions, frais et partages depuis{" "}
              <span className="font-semibold text-slate-900">Supabase pricing_config</span>{" "}
              sans toucher au code mobile.
            </p>
            {!canWrite ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                Mode lecture seule ??? seul le Super Admin peut modifier le pricing.
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-bold">Production rule / R??gle production</div>
            <div className="mt-1 text-xs leading-5">
              Delivery driver % + delivery platform % must equal 100. The driver gets paid only from transport/delivery, not from the order subtotal. / La part chauffeur livraison + la part plateforme livraison doit faire 100. Le chauffeur est pay?? seulement sur le transport/livraison, pas sur le montant de la commande.
            </div>
          </div>
        </div>
      </div>

      <AdminCancelRefundPanel />

      <div className="grid gap-6">
        {rows.map((row) => {
          const coreStatus = splitStatus([row.restaurant_pct, row.platform_pct]);

          const deliveryStatus = splitStatus([
            row.delivery_driver_pct,
            row.delivery_platform_pct,
          ]);

          const isFood = row.order_type === "food";
          const isErrand = row.order_type === "errand";
          const isMarketplace = row.order_type === "marketplace";
          const serviceFeeFixed =
            row.service_fee_fixed_cents != null
              ? row.service_fee_fixed_cents / 100
              : row.fixed_client_fee ?? 0;

          return (
            <form
              key={row.id}
              onSubmit={canWrite ? (e) => void handleSave(e, row.id) : undefined}
              className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
            >
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="config_key" value={row.config_key} />

              <fieldset disabled={!canWrite} className="disabled:opacity-80">
              <div className="border-b border-slate-100 bg-white p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-black tracking-tight">
                        {row.label}
                      </h2>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          row.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {row.active ? "ACTIVE" : "INACTIVE"}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                        {row.order_type.toUpperCase()}
                      </span>
                    </div>

                    <div className="mt-2 text-xs text-slate-500">
                      Key: <span className="font-semibold">{row.config_key}</span>{" "}
                      ??? Last update / Derni??re mise ?? jour:{" "}
                      {formatDateTime(row.updated_at)}
                    </div>
                  </div>

                  {canWrite ? (
                    <button
                      type="submit"
                      className="rounded-2xl bg-black px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
                    >
                      {savingId === row.id ? "Saving… / Enregistrement…" : "Save changes / Enregistrer"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-5 p-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="space-y-1">
                    <div className="text-sm font-medium text-slate-800">
                      Active / Actif
                    </div>
                    <select
                      name="active"
                      defaultValue={row.active ? "true" : "false"}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </label>

                  <TextInputField
                    name="currency"
                    label="Currency / Devise"
                    value={row.currency ?? "USD"}
                    placeholder="USD"
                    help="3-letter currency code. / Code devise ?? 3 lettres."
                  />
                </div>

                <SplitSummary
                  title="Core split / Partage principal"
                  status={coreStatus}
                  items={[
                    { label: "Restaurant", value: row.restaurant_pct },
                    { label: "Platform", value: row.platform_pct },
                  ]}
                />

                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                  {sectionTitle(
                    "Client Service Fee / Frais de service client",
                    "Disabled by default. When enabled, the fee is added to the customer total at checkout. / Désactivé par défaut. Une fois activé, le fee s'ajoute au total client au checkout."
                  )}
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <label className="space-y-1">
                      <div className="text-sm font-medium text-slate-800">
                        Service fee enabled
                      </div>
                      <select
                        name="service_fee_enabled"
                        defaultValue={row.service_fee_enabled ? "true" : "false"}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="false">OFF</option>
                        <option value="true">ON</option>
                      </select>
                    </label>
                    <PercentInput
                      name="service_fee_pct"
                      label="Service fee % / Frais de service %"
                      value={row.service_fee_pct ?? row.client_pct}
                    />
                    <MoneyInput
                      name="service_fee_fixed"
                      label="Minimum fixed fee / Minimum fixe"
                      value={serviceFeeFixed}
                    />
                  </div>
                </div>

                {!isMarketplace ? (
                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Core commission split / Partage commission principale",
                    isFood
                      ? "Food: restaurant subtotal split only. Suggested: Restaurant 85%, Platform 15%, Driver 0%. / Food : partage nourriture seulement. Recommand?? : Restaurant 85%, Plateforme 15%, Chauffeur 0%."
                      : "Errand: no driver percentage on order money. Driver is paid from delivery/transport split below. / Errand : pas de % chauffeur sur la commande. Le chauffeur est pay?? via le transport ci-dessous."
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
                    <input type="hidden" name="driver_pct" value="0" />
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 md:col-span-3">
                      <div className="text-sm font-medium text-slate-800">
                        Driver order % / Chauffeur commande %
                      </div>
                      <div className="mt-2 text-lg font-black text-slate-900">0%</div>
                      <div className="mt-1 text-[11px] leading-4 text-slate-500">
                        Not used for order/subtotal commissions. Driver earnings are calculated only from the delivery/transport split below. / Non utilis?? sur l???argent de la commande. Le chauffeur est pay?? seulement avec le partage livraison/transport ci-dessous.
                      </div>
                    </div>
                    <PercentInput
                      name="restaurant_pct"
                      label="Restaurant %"
                      value={row.restaurant_pct}
                    />
                    <PercentInput
                      name="platform_pct"
                      label="Platform % / Plateforme %"
                      value={row.platform_pct}
                    />
                  </div>
                </div>
                ) : null}

                {!isMarketplace ? (
                <>
                <SplitSummary
                  title="Delivery split / Partage livraison"
                  status={deliveryStatus}
                  items={[
                    { label: "Driver / Chauffeur", value: row.delivery_driver_pct },
                    { label: "Platform / Plateforme", value: row.delivery_platform_pct },
                  ]}
                />

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Delivery split / Partage livraison",
                    isErrand
                      ? "Pickup/dropoff: used by Supabase triggers for driver_delivery_payout and platform_delivery_fee. / Pickup/dropoff : utilis?? par les triggers Supabase."
                      : "Food delivery: splits only the delivery fee, not the food subtotal. / Food delivery : partage seulement les frais de livraison."
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <PercentInput
                      name="delivery_platform_pct"
                      label="Delivery platform % / Plateforme livraison %"
                      value={row.delivery_platform_pct}
                      help="Platform share on delivery fee. / Part plateforme sur les frais de livraison."
                    />
                    <PercentInput
                      name="delivery_driver_pct"
                      label="Delivery driver % / Chauffeur livraison %"
                      value={row.delivery_driver_pct}
                      help="Driver payout shown in the driver app. / Gain chauffeur affich?? dans l???app."
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Delivery pricing inputs / Param??tres prix livraison",
                    "Base + distance + time. / Base + distance + temps."
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <MoneyInput
                      name="delivery_fee_base"
                      label="Delivery fee base / Base livraison"
                      value={row.delivery_fee_base}
                    />
                    <MoneyInput
                      name="delivery_fee_per_mile"
                      label="Per mile / Par mile"
                      value={row.delivery_fee_per_mile}
                    />
                    <MoneyInput
                      name="delivery_fee_per_minute"
                      label="Per minute / Par minute"
                      value={row.delivery_fee_per_minute}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Order floor & promotion / Minimum commande & promotion",
                    "Control minimum order amount and active promotions. / Contr??le du minimum et des promotions."
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <MoneyInput
                      name="minimum_order_amount"
                      label="Minimum order amount / Montant minimum"
                      value={row.minimum_order_amount}
                    />

                    <label className="space-y-1">
                      <div className="text-sm font-medium text-slate-800">
                        Promo enabled / Promo active
                      </div>
                      <select
                        name="promo_enabled"
                        defaultValue={row.promo_enabled ? "true" : "false"}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
                      >
                        <option value="false">false</option>
                        <option value="true">true</option>
                      </select>
                    </label>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <label className="space-y-1">
                      <div className="text-sm font-medium text-slate-800">
                        Promo type / Type promo
                      </div>
                      <select
                        name="promo_type"
                        defaultValue={row.promo_type ?? ""}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
                      >
                        <option value="">none / aucun</option>
                        <option value="percent">percent / pourcentage</option>
                        <option value="fixed">fixed / montant fixe</option>
                        <option value="free_delivery">
                          free_delivery / livraison gratuite
                        </option>
                      </select>
                    </label>

                    <MoneyInput
                      name="promo_value"
                      label="Promo value / Valeur promo"
                      value={row.promo_value}
                    />

                    <TextInputField
                      name="promo_code"
                      label="Promo code / Code promo"
                      value={row.promo_code}
                      placeholder="SAVE10"
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <TextInputField
                      name="promo_starts_at"
                      label="Promo starts (ISO) / D??but promo"
                      value={row.promo_starts_at}
                      placeholder="2026-07-01T00:00:00Z"
                    />
                    <TextInputField
                      name="promo_ends_at"
                      label="Promo ends (ISO) / Fin promo"
                      value={row.promo_ends_at}
                      placeholder="2026-12-31T23:59:59Z"
                    />
                  </div>
                </div>
                </>
                ) : (
                  <>
                    <input type="hidden" name="restaurant_pct" value="0" />
                    <input type="hidden" name="platform_pct" value="0" />
                    <input type="hidden" name="delivery_platform_pct" value="0" />
                    <input type="hidden" name="delivery_driver_pct" value="0" />
                    <input type="hidden" name="delivery_fee_base" value="0" />
                    <input type="hidden" name="delivery_fee_per_mile" value="0" />
                    <input type="hidden" name="delivery_fee_per_minute" value="0" />
                    <input type="hidden" name="minimum_order_amount" value="0" />
                    <input type="hidden" name="promo_enabled" value="false" />
                    <input type="hidden" name="tax_enabled" value="false" />
                    <input type="hidden" name="tax_pct" value="0" />
                  </>
                )}

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Region & taxes / R??gion & taxes",
                    "US, Africa or global ??? editable without redeploy. / US, Afrique ou global."
                  )}
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="space-y-1">
                      <div className="text-sm font-medium text-slate-800">Region</div>
                      <select
                        name="region"
                        defaultValue={row.region ?? "global"}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      >
                        <option value="global">global</option>
                        <option value="us">us</option>
                        <option value="africa">africa</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <div className="text-sm font-medium text-slate-800">Tax enabled</div>
                      <select
                        name="tax_enabled"
                        defaultValue={row.tax_enabled ? "true" : "false"}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      >
                        <option value="false">false</option>
                        <option value="true">true</option>
                      </select>
                    </label>
                    <PercentInput
                      name="tax_pct"
                      label="Tax % / Taxe %"
                      value={row.tax_pct}
                    />
                    <TextInputField
                      name="tax_label"
                      label="Tax label / Libell?? taxe"
                      value={row.tax_label}
                      placeholder="Sales tax / TVA"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 md:flex-row md:items-center md:justify-between">
                  <div className="text-xs leading-5 text-slate-500">
                    This page writes directly to <b>pricing_config</b>. Supabase
                    triggers read these values for the next orders. / Cette page
                    ??crit directement dans <b>pricing_config</b>. Les triggers
                    Supabase lisent ces valeurs pour les prochaines commandes.
                  </div>

                  {canWrite ? (
                    <button
                      type="submit"
                      className="rounded-2xl bg-black px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
                    >
                      Save changes / Enregistrer
                    </button>
                  ) : null}
                </div>
              </div>
              </fieldset>
            </form>
          );
        })}
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">
          Historique pricing & rollback
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Toutes les modifications et restaurations de versions pr??c??dentes.
        </p>
        <div className="mt-4">
          <AdminPricingHistory canRollback={canWrite} />
        </div>
      </section>
    </main>
  );
}
