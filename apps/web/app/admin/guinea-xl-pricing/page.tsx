"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canWriteTaxiPricing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { useAdminT } from "@/i18n/useAdminT";
import { guineaAdminErrorLabel, guineaAuditActionLabel } from "@/lib/markets/guineaAdminErrors";
import { parseDispatchLimitInput } from "@/lib/markets/guineaXlSegmentDispatch";

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

type SegmentRow = {
  id: string;
  code: string;
  sequence: number;
  originLabel: string;
  destinationLabel: string;
  branch: string;
  distanceKm: number | null;
  durationMinutes: number | null;
  active: boolean;
  confirmed: boolean;
  version: number;
  rawGnf: number | null;
  finalGnf: number | null;
  priceable: boolean;
  estimateSource?: string;
};

type SegmentRoute = {
  originLabel: string;
  destinationLabel: string;
  segmentCodes: string[];
  totalGnf: number | null;
  definitive: boolean;
  error: string | null;
};

type SegmentTariff = {
  version: number;
  base_gnf: number;
  per_km_gnf: number;
  per_minute_gnf: number;
  minimum_gnf: number;
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
  const [segmentSchemaReady, setSegmentSchemaReady] = useState(false);
  const [segmentTariff, setSegmentTariff] = useState<SegmentTariff | null>(null);
  const [dispatchReady, setDispatchReady] = useState(false);
  const [dispatchLimits, setDispatchLimits] = useState<{
    maxPickupMeters: number;
    maxDetourMeters: number;
    maxPickupDelayMinutes: number;
    maxLocationAgeMs: number;
  } | null>(null);
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [segmentRoutes, setSegmentRoutes] = useState<SegmentRoute[]>([]);
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
      segmentSchemaReady?: boolean;
      segmentTariff?: SegmentTariff | null;
      dispatchReady?: boolean;
      dispatchLimits?: {
        maxPickupMeters: number;
        maxDetourMeters: number;
        maxPickupDelayMinutes: number;
        maxLocationAgeMs: number;
      } | null;
      segments?: SegmentRow[];
      segmentRoutes?: SegmentRoute[];
      segmentError?: string;
      dispatchError?: string;
    };
    if (!response.ok || body.ok === false) {
      setError(t(guineaAdminErrorLabel(body.error)));
      return;
    }
    setAxes(body.axes ?? []);
    setBands(body.bands ?? []);
    setHistory(body.history ?? []);
    setVersions(body.versions ?? []);
    setSegmentSchemaReady(body.segmentSchemaReady === true);
    setSegmentTariff(body.segmentTariff ?? null);
    setDispatchReady(body.dispatchReady === true);
    setDispatchLimits(body.dispatchLimits ?? null);
    setSegments(body.segments ?? []);
    setSegmentRoutes(body.segmentRoutes ?? []);
    setCommissionBps(String(body.settings?.platform_share_bps ?? ""));
    setCurrency(body.settings?.currency ?? "GNF");
    const notice = body.dispatchError ?? body.segmentError ?? (!body.dispatchLimits ? "xl_dispatch_not_configured" : null);
    setError(notice ? t(guineaAdminErrorLabel(notice)) : null);
  }, [active, destination, origin, t]);

  useEffect(() => {
    void resolveBrowserStaffSession().then((session) => {
      setCanEdit(session ? canWriteTaxiPricing(session.role) : false);
    });
    void load();
  }, [load]);

  async function post(payload: Record<string, unknown>) {
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

  function submit(event: FormEvent<HTMLFormElement>, payload: Record<string, unknown>) {
    event.preventDefault();
    void post(payload);
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

        <section className="space-y-3 rounded border p-4">
          <h2 className="font-semibold">{t("XL segments")}</h2>
          <p className="text-sm">{t("Segment bookings are not open")}</p>
          {segmentSchemaReady ? null : <p className="text-sm">{t("XL segments are not ready")}</p>}
          {segmentSchemaReady && !segmentTariff ? <p className="text-sm">{t("This segment is not priced")}</p> : null}
          {segmentSchemaReady && segmentTariff ? (
            <form
              key={segmentTariff.version}
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                const form = new FormData(event.currentTarget);
                void submit(event, {
                  action: "save_segment_tariff",
                  expectedVersion: segmentTariff.version,
                  baseGnf: Number(form.get("baseGnf")),
                  perKmGnf: Number(form.get("perKmGnf")),
                  perMinuteGnf: Number(form.get("perMinuteGnf")),
                  minimumGnf: Number(form.get("minimumGnf")),
                });
              }}
            >
              <label className="text-sm">{t("Base per segment")}<input name="baseGnf" type="number" defaultValue={segmentTariff.base_gnf} className="ml-2 rounded border px-2 py-1" disabled={!canEdit} /></label>
              <label className="text-sm">{t("Price per kilometer")}<input name="perKmGnf" type="number" defaultValue={segmentTariff.per_km_gnf} className="ml-2 rounded border px-2 py-1" disabled={!canEdit} /></label>
              <label className="text-sm">{t("Per minute")}<input name="perMinuteGnf" type="number" defaultValue={segmentTariff.per_minute_gnf} className="ml-2 rounded border px-2 py-1" disabled={!canEdit} /></label>
              <label className="text-sm">{t("Trip minimum")}<input name="minimumGnf" type="number" defaultValue={segmentTariff.minimum_gnf} className="ml-2 rounded border px-2 py-1" disabled={!canEdit} /></label>
              <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={!canEdit} type="submit">{t("Save")}</button>
            </form>
          ) : null}
          {!dispatchReady || !dispatchLimits ? <p className="text-sm">{t("Dispatch rules are not configured")}</p> : null}
          {dispatchReady && segmentTariff ? (
            <form
              key={`dispatch-${segmentTariff.version}`}
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const payload = {
                  action: "save_segment_dispatch",
                  expectedVersion: segmentTariff.version,
                  maxPickupMeters: form.get("maxPickupMeters"),
                  maxDetourMeters: form.get("maxDetourMeters"),
                  maxPickupDelayMinutes: form.get("maxPickupDelayMinutes"),
                  maxLocationAgeSeconds: form.get("maxLocationAgeSeconds"),
                };
                const parsed = parseDispatchLimitInput(payload);
                if (parsed.ok === false) {
                  setError(t(guineaAdminErrorLabel(parsed.error)));
                  return;
                }
                void post(payload);
              }}
            >
              <label className="text-sm">{t("Maximum distance to pickup")}<input name="maxPickupMeters" type="number" defaultValue={dispatchLimits?.maxPickupMeters ?? ""} className="ml-2 w-28 rounded border px-2 py-1" disabled={!canEdit} /></label>
              <label className="text-sm">{t("Maximum detour")}<input name="maxDetourMeters" type="number" defaultValue={dispatchLimits?.maxDetourMeters ?? ""} className="ml-2 w-28 rounded border px-2 py-1" disabled={!canEdit} /></label>
              <label className="text-sm">{t("Maximum pickup delay")}<input name="maxPickupDelayMinutes" type="number" defaultValue={dispatchLimits?.maxPickupDelayMinutes ?? ""} className="ml-2 w-24 rounded border px-2 py-1" disabled={!canEdit} /></label>
              <label className="text-sm">{t("Maximum GPS age")}<input name="maxLocationAgeSeconds" type="number" defaultValue={dispatchLimits ? dispatchLimits.maxLocationAgeMs / 1000 : ""} className="ml-2 w-24 rounded border px-2 py-1" disabled={!canEdit} /></label>
              <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={!canEdit} type="submit">{t("Save")}</button>
            </form>
          ) : null}
          <ul className="space-y-3">
            {segments.map((segment) => (
              <li key={segment.id} className="text-sm">
                <p>
                  {segment.sequence}. {segment.originLabel} → {segment.destinationLabel} · {segment.branch === "dougountounny" ? t("Dougountounny branch") : segment.branch === "mali" ? t("Mali Centre branch") : t("Main line")}
                  {" · "}
                  {segment.confirmed ? t("Validated segment") : t("Unconfirmed estimate")}
                  {" · "}
                  {segment.active ? t("Active") : t("Inactive")}
                </p>
                <p>
                  {segment.priceable
                    ? `${t("Raw segment price")} ${segment.rawGnf} GNF · ${t("Final segment price")} ${segment.finalGnf} GNF`
                    : t("No definitive price")}
                </p>
                {segment.estimateSource ? <p>{t("Distance source")}: {segment.estimateSource}</p> : null}
                <form
                  key={`${segment.id}-${segment.version}`}
                  className="mt-1 flex flex-wrap gap-2"
                  onSubmit={(event) => {
                    const form = new FormData(event.currentTarget);
                    const distance = String(form.get("distanceKm") ?? "").trim();
                    const duration = String(form.get("durationMinutes") ?? "").trim();
                    void submit(event, {
                      action: "save_segment",
                      segmentId: segment.id,
                      expectedVersion: segment.version,
                      originLabel: String(form.get("originLabel") ?? ""),
                      destinationLabel: String(form.get("destinationLabel") ?? ""),
                      estimateSource: String(form.get("estimateSource") ?? ""),
                      distanceKm: distance === "" ? null : Number(distance),
                      durationMinutes: duration === "" ? null : Number(duration),
                    });
                  }}
                >
                  <input name="originLabel" defaultValue={segment.originLabel} placeholder={t("Origin")} className="w-36 rounded border px-2 py-1" disabled={!canEdit} />
                  <input name="destinationLabel" defaultValue={segment.destinationLabel} placeholder={t("Destination")} className="w-36 rounded border px-2 py-1" disabled={!canEdit} />
                  <input name="distanceKm" type="number" defaultValue={segment.distanceKm ?? ""} placeholder={t("Distance km")} className="w-28 rounded border px-2 py-1" disabled={!canEdit} />
                  <input name="durationMinutes" type="number" defaultValue={segment.durationMinutes ?? ""} placeholder={t("Duration minutes")} className="w-28 rounded border px-2 py-1" disabled={!canEdit} />
                  <input name="estimateSource" defaultValue={segment.estimateSource ?? ""} placeholder={t("Distance source")} className="min-w-64 flex-1 rounded border px-2 py-1" disabled={!canEdit} />
                  <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={!canEdit} type="submit">{t("Save")}</button>
                  <button
                    className="rounded border px-3 py-1 disabled:opacity-40"
                    disabled={!canEdit || !segment.priceable}
                    type="button"
                    onClick={() => {
                      void post({
                        action: "set_segment_active",
                        segmentId: segment.id,
                        expectedVersion: segment.version,
                        active: !segment.active,
                      });
                    }}
                  >
                    {segment.active ? t("Deactivate") : t("Activate")}
                  </button>
                  <button
                    className="rounded border px-3 py-1 disabled:opacity-40"
                    disabled={!canEdit || !segment.priceable || segment.confirmed}
                    type="button"
                    onClick={() => {
                      void post({
                        action: "confirm_segment",
                        segmentId: segment.id,
                        expectedVersion: segment.version,
                      });
                    }}
                  >
                    {t("Mark segment validated")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <h3 className="font-medium">{t("Cumulative routes")}</h3>
          <ul className="space-y-1 text-sm">
            {segmentRoutes.map((route) => (
              <li key={`${route.originLabel}-${route.destinationLabel}`}>
                {route.originLabel} → {route.destinationLabel}
                {" · "}
                {route.totalGnf == null ? t("No definitive price") : `${route.totalGnf} GNF · ${t("Price per passenger")}`}
                {" · "}
                {route.definitive ? t("Validated segment") : t("Unconfirmed estimate")}
                {route.error ? ` · ${t(guineaAdminErrorLabel(route.error))}` : ""}
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
