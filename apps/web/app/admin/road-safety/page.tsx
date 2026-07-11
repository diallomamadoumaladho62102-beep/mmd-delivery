"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiDrivers } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type ConfigRow = {
  country_code: string;
  enable_speed_camera: boolean;
  enable_red_light_camera: boolean;
  enable_stop_sign: boolean;
  enable_school_zone: boolean;
  enable_speed_limit: boolean;
  enable_voice: boolean;
  announce_far_meters: number;
  announce_near_meters: number;
  overspeed_tolerance_kmh: number;
  corridor_radius_meters: number;
  min_confidence: number;
  legal_status: "allowed" | "restricted" | "unknown" | "disabled";
  is_active: boolean;
};

type EventRow = {
  id: string;
  type: string;
  latitude: number;
  longitude: number;
  country_code: string | null;
  source: string;
  confidence: number;
  is_active: boolean;
  updated_at: string;
};

const LEGAL = ["allowed", "restricted", "unknown", "disabled"] as const;

export default function AdminRoadSafetyPage() {
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [eventCountry, setEventCountry] = useState("US");

  const loadEvents = useCallback(async (country: string) => {
    const res = await adminFetch(`/api/admin/road-safety/events?country=${country}`);
    const body = await res.json().catch(() => ({}));
    setEvents(body.events ?? []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiDrivers(session?.role ?? null));
    const res = await adminFetch("/api/admin/road-safety/config");
    const body = await res.json().catch(() => ({}));
    setConfigs(body.configs ?? []);
    await loadEvents(eventCountry);
    setLoading(false);
  }, [eventCountry, loadEvents]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveConfig(e: FormEvent<HTMLFormElement>, cfg: ConfigRow) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    setSavingCode(cfg.country_code);
    try {
      const res = await adminFetch("/api/admin/road-safety/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country_code: cfg.country_code,
          enable_speed_camera: form.get("enable_speed_camera") === "on",
          enable_red_light_camera: form.get("enable_red_light_camera") === "on",
          enable_stop_sign: form.get("enable_stop_sign") === "on",
          enable_school_zone: form.get("enable_school_zone") === "on",
          enable_speed_limit: form.get("enable_speed_limit") === "on",
          enable_voice: form.get("enable_voice") === "on",
          announce_far_meters: Number(form.get("announce_far_meters")),
          announce_near_meters: Number(form.get("announce_near_meters")),
          overspeed_tolerance_kmh: Number(form.get("overspeed_tolerance_kmh")),
          corridor_radius_meters: Number(form.get("corridor_radius_meters")),
          min_confidence: Number(form.get("min_confidence")),
          legal_status: String(form.get("legal_status")),
          is_active: form.get("is_active") === "on",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) alert(json.error ?? "Échec");
      else await load();
    } finally {
      setSavingCode(null);
    }
  }

  async function toggleEvent(ev: EventRow) {
    if (!canEdit) return;
    await adminFetch("/api/admin/road-safety/events", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ev.id, is_active: !ev.is_active }),
    });
    await loadEvents(eventCountry);
  }

  async function createEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    const res = await adminFetch("/api/admin/road-safety/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: form.get("type"),
        latitude: Number(form.get("latitude")),
        longitude: Number(form.get("longitude")),
        country_code: String(form.get("country_code") || "").toUpperCase() || null,
        direction: form.get("direction"),
        speed_limit_kmh: form.get("speed_limit_kmh") ? Number(form.get("speed_limit_kmh")) : null,
        confidence: 0.95,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) alert(json.error ?? "Échec");
    else {
      (e.target as HTMLFormElement).reset();
      await loadEvents(eventCountry);
    }
  }

  const chk = "mr-1 align-middle";
  const numCls = "mt-1 block w-24 rounded border px-2 py-1 text-sm";

  return (
    <AdminGate requiredPermission="taxi_drivers.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Road Safety</h1>
            <p className="mt-1 text-sm text-slate-600">
              Configuration par pays des alertes de sécurité routière (radars, STOP, zones
              scolaires, limitations, vocal, seuils, tolérance, corridor, confiance) et gestion
              des événements curés. Les radars ne sont affichés que si l’état légal est «&nbsp;allowed&nbsp;».
              Données OSM : © OpenStreetMap contributors.
            </p>
          </header>

          {loading ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : (
            <>
              <section className="space-y-4">
                <h2 className="text-lg font-semibold text-slate-800">Configuration par pays</h2>
                {configs.map((cfg) => (
                  <form
                    key={cfg.country_code}
                    onSubmit={(e) => void saveConfig(e, cfg)}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-800">{cfg.country_code}</p>
                      <label className="text-xs text-slate-600">
                        État légal (radars)
                        <select
                          name="legal_status"
                          defaultValue={cfg.legal_status}
                          disabled={!canEdit}
                          className="ml-2 rounded border px-2 py-1 text-sm"
                        >
                          {LEGAL.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-700">
                      <label><input className={chk} type="checkbox" name="enable_speed_camera" defaultChecked={cfg.enable_speed_camera} disabled={!canEdit} />Radar vitesse</label>
                      <label><input className={chk} type="checkbox" name="enable_red_light_camera" defaultChecked={cfg.enable_red_light_camera} disabled={!canEdit} />Radar feu rouge</label>
                      <label><input className={chk} type="checkbox" name="enable_stop_sign" defaultChecked={cfg.enable_stop_sign} disabled={!canEdit} />STOP</label>
                      <label><input className={chk} type="checkbox" name="enable_school_zone" defaultChecked={cfg.enable_school_zone} disabled={!canEdit} />Zone scolaire</label>
                      <label><input className={chk} type="checkbox" name="enable_speed_limit" defaultChecked={cfg.enable_speed_limit} disabled={!canEdit} />Limitations</label>
                      <label><input className={chk} type="checkbox" name="enable_voice" defaultChecked={cfg.enable_voice} disabled={!canEdit} />Vocal</label>
                      <label><input className={chk} type="checkbox" name="is_active" defaultChecked={cfg.is_active} disabled={!canEdit} />Actif</label>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-4">
                      <label className="text-xs text-slate-600">Seuil 500 m<input name="announce_far_meters" type="number" defaultValue={cfg.announce_far_meters} disabled={!canEdit} className={numCls} /></label>
                      <label className="text-xs text-slate-600">Seuil 200 m<input name="announce_near_meters" type="number" defaultValue={cfg.announce_near_meters} disabled={!canEdit} className={numCls} /></label>
                      <label className="text-xs text-slate-600">Tolérance km/h<input name="overspeed_tolerance_kmh" type="number" defaultValue={cfg.overspeed_tolerance_kmh} disabled={!canEdit} className={numCls} /></label>
                      <label className="text-xs text-slate-600">Corridor m<input name="corridor_radius_meters" type="number" defaultValue={cfg.corridor_radius_meters} disabled={!canEdit} className={numCls} /></label>
                      <label className="text-xs text-slate-600">Confiance min<input name="min_confidence" type="number" step="0.05" min="0" max="1" defaultValue={cfg.min_confidence} disabled={!canEdit} className={numCls} /></label>
                    </div>

                    {canEdit ? (
                      <button
                        type="submit"
                        disabled={savingCode === cfg.country_code}
                        className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white"
                      >
                        Enregistrer
                      </button>
                    ) : null}
                  </form>
                ))}
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-semibold text-slate-800">Événements curés</h2>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-slate-600">Pays</label>
                  <input
                    value={eventCountry}
                    onChange={(e) => setEventCountry(e.target.value.toUpperCase())}
                    className="w-20 rounded border px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void loadEvents(eventCountry)}
                    className="rounded bg-slate-200 px-3 py-1 text-sm"
                  >
                    Filtrer
                  </button>
                </div>

                {canEdit ? (
                  <form
                    onSubmit={(e) => void createEvent(e)}
                    className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <label className="text-xs text-slate-600">Type
                      <select name="type" className="mt-1 block rounded border px-2 py-1 text-sm">
                        <option value="speed_camera">speed_camera</option>
                        <option value="red_light_camera">red_light_camera</option>
                        <option value="stop_sign">stop_sign</option>
                        <option value="school_zone">school_zone</option>
                        <option value="speed_limit">speed_limit</option>
                      </select>
                    </label>
                    <label className="text-xs text-slate-600">Latitude<input name="latitude" type="number" step="any" required className={numCls} /></label>
                    <label className="text-xs text-slate-600">Longitude<input name="longitude" type="number" step="any" required className={numCls} /></label>
                    <label className="text-xs text-slate-600">Pays<input name="country_code" defaultValue={eventCountry} className="mt-1 block w-20 rounded border px-2 py-1 text-sm" /></label>
                    <label className="text-xs text-slate-600">Sens
                      <select name="direction" className="mt-1 block rounded border px-2 py-1 text-sm">
                        <option value="unknown">unknown</option>
                        <option value="forward">forward</option>
                        <option value="backward">backward</option>
                        <option value="both">both</option>
                      </select>
                    </label>
                    <label className="text-xs text-slate-600">Limite km/h<input name="speed_limit_kmh" type="number" className={numCls} /></label>
                    <button type="submit" className="rounded bg-slate-900 px-4 py-2 text-sm text-white">Ajouter</button>
                  </form>
                ) : null}

                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-left text-xs text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Coord.</th>
                        <th className="px-3 py-2">Source</th>
                        <th className="px-3 py-2">Conf.</th>
                        <th className="px-3 py-2">Actif</th>
                        <th className="px-3 py-2">MAJ</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((ev) => (
                        <tr key={ev.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">{ev.type}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {ev.latitude.toFixed(4)}, {ev.longitude.toFixed(4)}
                          </td>
                          <td className="px-3 py-2">{ev.source}</td>
                          <td className="px-3 py-2 tabular-nums">{ev.confidence}</td>
                          <td className="px-3 py-2">{ev.is_active ? "✅" : "—"}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">
                            {new Date(ev.updated_at).toLocaleDateString()}
                          </td>
                          <td className="px-3 py-2">
                            {canEdit ? (
                              <button
                                type="button"
                                onClick={() => void toggleEvent(ev)}
                                className="rounded bg-slate-200 px-2 py-1 text-xs"
                              >
                                {ev.is_active ? "Désactiver" : "Activer"}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                      {events.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">
                            Aucun événement pour ce pays.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
