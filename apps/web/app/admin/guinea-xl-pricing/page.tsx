"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canWriteTaxiPricing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { useAdminT } from "@/i18n/useAdminT";
import { guineaAdminErrorLabel, guineaAuditActionLabel } from "@/lib/markets/guineaAdminErrors";

type AxisRow = {
  id: string;
  origin_label: string;
  destination_label: string;
  front_seat_gnf: number;
  other_seat_gnf: number;
  currency: string;
  active: boolean;
  directional?: boolean;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
};

type BandRow = {
  id: string;
  min_kg: number;
  max_kg: number;
  price_gnf: number;
  active: boolean;
  currency: string;
};

type HistoryRow = {
  id: string;
  action: string;
  actor_id: string | null;
  axis_id: string | null;
  created_at: string;
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
};

type VersionRow = {
  id: string;
  axis_id: string;
  version: number;
  front_seat_gnf: number;
  other_seat_gnf: number;
  active: boolean;
  created_at: string;
  created_by: string | null;
};

export default function GuineaXlPricingPage() {
  const { t } = useAdminT();
  const [axes, setAxes] = useState<AxisRow[]>([]);
  const [bands, setBands] = useState<BandRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [commissionBps, setCommissionBps] = useState("");
  const [currency, setCurrency] = useState("GNF");
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [active, setActive] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (origin.trim()) params.set("origin", origin.trim());
    if (destination.trim()) params.set("destination", destination.trim());
    if (active) params.set("active", active);
    const response = await adminFetch(`/api/admin/guinea-xl?${params.toString()}`);
    const body = (await response.json()) as {
      ok?: boolean;
      error?: string;
      axes?: AxisRow[];
      bands?: BandRow[];
      history?: HistoryRow[];
      versions?: VersionRow[];
      settings?: { platform_share_bps?: number; currency?: string } | null;
    };
    if (!response.ok || body.ok === false) {
      setError(t(guineaAdminErrorLabel(body.error)));
      return;
    }
    setAxes(body.axes ?? []);
    setBands(body.bands ?? []);
    setHistory(body.history ?? []);
    setVersions(body.versions ?? []);
    setCommissionBps(String(body.settings?.platform_share_bps ?? ""));
    setCurrency(body.settings?.currency ?? "GNF");
    setError(null);
  }, [active, destination, origin, t]);

  useEffect(() => {
    void resolveBrowserStaffSession().then((session) => {
      setCanEdit(session ? canWriteTaxiPricing(session.role) : false);
    });
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>, payload: Record<string, unknown>) {
    event.preventDefault();
    if (!canEdit) return;
    const response = await adminFetch("/api/admin/guinea-xl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || body.ok === false) {
      setError(t(guineaAdminErrorLabel(body.error)));
      return;
    }
    await load();
  }

  return (
    <AdminGate requiredPermission="taxi_pricing.read">
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">{t("XL Interregional Pricing")}</h1>
        <p className="text-sm text-slate-600">
          {t("Currency")} {currency} · {t("Timezone")} {t("Conakry")}
        </p>
        {error ? <p className="text-red-700">{error}</p> : null}

        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <input className="rounded border px-3 py-2" placeholder={t("Origin")} value={origin} onChange={(event) => setOrigin(event.target.value)} />
          <input className="rounded border px-3 py-2" placeholder={t("Destination")} value={destination} onChange={(event) => setDestination(event.target.value)} />
          <select className="rounded border px-3 py-2" value={active} onChange={(event) => setActive(event.target.value)}>
            <option value="">{t("Status")}</option>
            <option value="true">{t("Active")}</option>
            <option value="false">{t("Inactive")}</option>
          </select>
          <button className="rounded bg-slate-900 px-4 py-2 text-white" type="submit">{t("Search")}</button>
        </form>

        <form
          className="grid gap-2 rounded border p-4 md:grid-cols-2"
          onSubmit={(event) => {
            const form = new FormData(event.currentTarget);
            void submit(event, {
              action: "create_axis",
              originLabel: form.get("originLabel"),
              destinationLabel: form.get("destinationLabel"),
              frontSeatGnf: Number(form.get("frontSeatGnf")),
              otherSeatGnf: Number(form.get("otherSeatGnf")),
              directional: form.get("directional") === "on",
            });
          }}
        >
          <h2 className="md:col-span-2 font-semibold">{t("Add axis")}</h2>
          <input name="originLabel" className="rounded border px-3 py-2" placeholder={t("Origin")} disabled={!canEdit} />
          <input name="destinationLabel" className="rounded border px-3 py-2" placeholder={t("Destination")} disabled={!canEdit} />
          <input name="frontSeatGnf" type="number" className="rounded border px-3 py-2" placeholder={t("Front seat")} disabled={!canEdit} />
          <input name="otherSeatGnf" type="number" className="rounded border px-3 py-2" placeholder={t("Other seats")} disabled={!canEdit} />
          <label className="md:col-span-2 text-sm">
            <input name="directional" type="checkbox" disabled={!canEdit} /> {t("One direction only")}
          </label>
          <p className="md:col-span-2 text-sm text-slate-600">
            {t("Both directions share one price. Check this only for a one-way axis.")}
          </p>
          <button className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40" disabled={!canEdit} type="submit">{t("Save")}</button>
        </form>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            const form = new FormData(event.currentTarget);
            void submit(event, { action: "set_commission", platformShareBps: Number(form.get("platformShareBps")) });
          }}
        >
          <label className="text-sm">
            {t("MMD commission basis points")}
            <input name="platformShareBps" defaultValue={commissionBps} className="ml-2 rounded border px-3 py-2" disabled={!canEdit} />
          </label>
          <button className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40" disabled={!canEdit} type="submit">{t("Save")}</button>
        </form>

        <ul className="space-y-3">
          {axes.map((axis) => (
            <li key={axis.id} className="rounded border p-4">
              <p className="font-semibold">{axis.origin_label} ↔ {axis.destination_label}</p>
              <p className="text-sm">
                {t("Front seat")} {axis.front_seat_gnf} {axis.currency} · {t("Other seats")} {axis.other_seat_gnf} {axis.currency}
              </p>
              <p className="text-sm">
                {t("Status")} {axis.active ? t("Active") : t("Inactive")} · {axis.directional ? t("One direction only") : t("Both directions")} · {t("Version")} {axis.version}
              </p>
              <p className="text-sm text-slate-500">
                {t("Updated")} {axis.updated_at ?? "—"} · {t("Updated by")} {axis.updated_by ?? "—"}
              </p>
              <form
                className="mt-2 flex flex-wrap gap-2"
                onSubmit={(event) => {
                  const form = new FormData(event.currentTarget);
                  void submit(event, {
                    action: "update_rate",
                    axisId: axis.id,
                    expectedVersion: axis.version,
                    frontSeatGnf: Number(form.get("frontSeatGnf")),
                    otherSeatGnf: Number(form.get("otherSeatGnf")),
                  });
                }}
              >
                <input name="frontSeatGnf" type="number" defaultValue={axis.front_seat_gnf} className="rounded border px-3 py-2" disabled={!canEdit} />
                <input name="otherSeatGnf" type="number" defaultValue={axis.other_seat_gnf} className="rounded border px-3 py-2" disabled={!canEdit} />
                <button className="rounded border px-3 py-2 disabled:opacity-40" disabled={!canEdit} type="submit">{t("Save")}</button>
                <button
                  className="rounded border px-3 py-2 disabled:opacity-40"
                  disabled={!canEdit}
                  type="button"
                  onClick={() => {
                    void adminFetch("/api/admin/guinea-xl", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "set_active",
                        axisId: axis.id,
                        expectedVersion: axis.version,
                        active: !axis.active,
                      }),
                    }).then(async (response) => {
                      const payload = (await response.json()) as { ok?: boolean; error?: string };
                      if (!response.ok || payload.ok === false) {
                        setError(t(guineaAdminErrorLabel(payload.error)));
                        return;
                      }
                      await load();
                    });
                  }}
                >
                  {axis.active ? t("Deactivate") : t("Activate")}
                </button>
              </form>
            </li>
          ))}
        </ul>

        <section>
          <h2 className="font-semibold">{t("Baggage")}</h2>
          <ul className="mt-2 space-y-2">
            {bands.map((band) => (
              <li key={band.id}>
                <form
                  className="flex flex-wrap items-center gap-2 text-sm"
                  onSubmit={(event) => {
                    const form = new FormData(event.currentTarget);
                    void submit(event, {
                      action: "save_band",
                      bandId: band.id,
                      minKg: Number(form.get("minKg")),
                      maxKg: Number(form.get("maxKg")),
                      priceGnf: Number(form.get("priceGnf")),
                      active: form.get("active") === "on",
                    });
                  }}
                >
                  <input name="minKg" type="number" defaultValue={band.min_kg} className="w-24 rounded border px-2 py-1" disabled={!canEdit} />
                  <input name="maxKg" type="number" defaultValue={band.max_kg} className="w-24 rounded border px-2 py-1" disabled={!canEdit} />
                  <input name="priceGnf" type="number" defaultValue={band.price_gnf} className="w-32 rounded border px-2 py-1" disabled={!canEdit} />
                  <span>{band.currency}</span>
                  <label><input name="active" type="checkbox" defaultChecked={band.active} disabled={!canEdit} /> {t("Active")}</label>
                  <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={!canEdit} type="submit">{t("Save")}</button>
                </form>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(event) => {
              const form = new FormData(event.currentTarget);
              void submit(event, {
                action: "save_band",
                minKg: Number(form.get("minKg")),
                maxKg: Number(form.get("maxKg")),
                priceGnf: Number(form.get("priceGnf")),
                active: form.get("active") === "on",
              });
            }}
          >
            <input name="minKg" type="number" className="rounded border px-3 py-2" placeholder={t("Minimum kg")} disabled={!canEdit} />
            <input name="maxKg" type="number" className="rounded border px-3 py-2" placeholder={t("Maximum kg")} disabled={!canEdit} />
            <input name="priceGnf" type="number" className="rounded border px-3 py-2" placeholder={t("Price")} disabled={!canEdit} />
            <label className="text-sm"><input name="active" type="checkbox" defaultChecked disabled={!canEdit} /> {t("Active")}</label>
            <button className="rounded border px-3 py-2 disabled:opacity-40" disabled={!canEdit} type="submit">{t("Save")}</button>
          </form>
        </section>

        <section>
          <h2 className="font-semibold">{t("Version")}</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {versions.map((row) => (
              <li key={row.id}>
                {row.created_at} · {t("Version")} {row.version} · {t("Front seat")} {row.front_seat_gnf} · {t("Other seats")} {row.other_seat_gnf} · {row.active ? t("Active") : t("Inactive")} · {row.axis_id} · {row.created_by ?? "—"}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-semibold">{t("History")}</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {history.map((row) => (
              <li key={row.id}>
                <p>{row.created_at} · {t(guineaAuditActionLabel(row.action))} · {row.actor_id ?? "—"} · {row.axis_id ?? "—"}</p>
                <p>{t("Updated")}: {JSON.stringify(row.old_value ?? null)} → {JSON.stringify(row.new_value ?? null)}</p>
                {row.reason ? <p>{row.reason}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </AdminGate>
  );
}
