"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canWriteTaxiPricing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { useAdminT } from "@/i18n/useAdminT";
import {
  guineaAdminErrorLabel,
  guineaAuditActionLabel,
  guineaConfigSourceLabel,
} from "@/lib/markets/guineaAdminErrors";

type Settings = {
  currency?: string;
  base_fare_gnf?: number;
  per_km_gnf?: number;
  per_minute_gnf?: number;
  minimum_fare_gnf?: number;
  platform_share_bps?: number;
  updated_at?: string | null;
};

type HistoryRow = {
  id: string;
  action: string;
  created_at: string;
  new_value: unknown;
};

export default function GuineaStandardPricingPage() {
  const { t } = useAdminT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [source, setSource] = useState("missing");
  const [schemaReady, setSchemaReady] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [baseFare, setBaseFare] = useState("");
  const [perKm, setPerKm] = useState("");
  const [perMinute, setPerMinute] = useState("");
  const [minimum, setMinimum] = useState("");
  const [commission, setCommission] = useState("");

  const load = useCallback(async () => {
    const response = await adminFetch("/api/admin/guinea-standard");
    const body = (await response.json()) as {
      ok?: boolean;
      error?: string;
      source?: string;
      schemaReady?: boolean;
      settings?: Settings | null;
      history?: HistoryRow[];
    };
    if (!response.ok || body.ok === false) {
      setError(t(guineaAdminErrorLabel(body.error)));
      return;
    }
    const saved = body.settings ?? null;
    setSettings(saved);
    setSource(body.source ?? "missing");
    setSchemaReady(body.schemaReady === true);
    setHistory(body.history ?? []);
    setBaseFare(saved?.base_fare_gnf == null ? "" : String(saved.base_fare_gnf));
    setPerKm(saved?.per_km_gnf == null ? "" : String(saved.per_km_gnf));
    setPerMinute(saved?.per_minute_gnf == null ? "" : String(saved.per_minute_gnf));
    setMinimum(saved?.minimum_fare_gnf == null ? "" : String(saved.minimum_fare_gnf));
    setCommission(saved?.platform_share_bps == null ? "" : String(saved.platform_share_bps));
    setError(null);
  }, [t]);

  useEffect(() => {
    void resolveBrowserStaffSession().then((session) => {
      setCanEdit(session ? canWriteTaxiPricing(session.role) : false);
    });
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    const response = await adminFetch("/api/admin/guinea-standard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currency: "GNF",
        baseFareGnf: baseFare,
        perKmGnf: perKm,
        perMinuteGnf: perMinute,
        minimumFareGnf: minimum,
        platformShareBps: commission,
        expectedUpdatedAt: settings?.updated_at ?? null,
      }),
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; settings?: Settings };
    if (!response.ok || body.ok === false) {
      setNotice(null);
      setError(t(guineaAdminErrorLabel(body.error)));
      if (response.status === 409) await load();
      return;
    }
    setNotice(t("Saved values"));
    setError(null);
    await load();
  }

  return (
    <AdminGate requiredPermission="taxi_pricing.read">
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">{t("Guinea Standard Pricing")}</h1>
        <p className="text-sm text-slate-600">
          {t("Currency")} GNF · {t("Price per kilometer")} · {t("Timezone")} {t("Conakry")}
        </p>
        <p className="text-sm text-slate-600">
          {t("Configuration source")}: {t(guineaConfigSourceLabel(source))}
          {schemaReady ? "" : ` · ${t("Guinea standard settings are not ready")}`}
        </p>
        {error ? <p className="text-red-700">{error}</p> : null}
        {notice ? <p className="text-green-800">{notice}</p> : null}
        {settings ? (
          <section className="rounded border border-slate-200 p-4 text-sm">
            <h2 className="font-medium">{t("Saved values")}</h2>
            <p>
              {t("Base fare")} {settings.base_fare_gnf} GNF · {t("Price per kilometer")} {settings.per_km_gnf} GNF ·{" "}
              {t("Per minute")} {settings.per_minute_gnf} GNF · {t("Trip minimum")} {settings.minimum_fare_gnf} GNF ·{" "}
              {t("Commission")} {settings.platform_share_bps}
            </p>
          </section>
        ) : null}
        <form className="grid gap-3" onSubmit={save}>
          <label>
            {t("Base fare")} (GNF)
            <input className="mt-1 w-full rounded border px-3 py-2" value={baseFare} onChange={(event) => setBaseFare(event.target.value)} inputMode="numeric" disabled={!canEdit || !schemaReady} />
          </label>
          <label>
            {t("Price per kilometer")} (GNF)
            <input className="mt-1 w-full rounded border px-3 py-2" value={perKm} onChange={(event) => setPerKm(event.target.value)} inputMode="numeric" disabled={!canEdit || !schemaReady} />
          </label>
          <label>
            {t("Per minute")} (GNF)
            <input className="mt-1 w-full rounded border px-3 py-2" value={perMinute} onChange={(event) => setPerMinute(event.target.value)} inputMode="numeric" disabled={!canEdit || !schemaReady} />
          </label>
          <label>
            {t("Trip minimum")} (GNF)
            <input className="mt-1 w-full rounded border px-3 py-2" value={minimum} onChange={(event) => setMinimum(event.target.value)} inputMode="numeric" disabled={!canEdit || !schemaReady} />
          </label>
          <label>
            {t("MMD commission basis points")}
            <input className="mt-1 w-full rounded border px-3 py-2" value={commission} onChange={(event) => setCommission(event.target.value)} inputMode="numeric" disabled={!canEdit || !schemaReady} />
          </label>
          <button className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50" type="submit" disabled={!canEdit || !schemaReady}>
            {t("Save")}
          </button>
        </form>
        <section>
          <h2 className="font-medium">{t("History")}</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {history.map((row) => (
              <li key={row.id}>
                {row.created_at} · {t(guineaAuditActionLabel(row.action))}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </AdminGate>
  );
}
