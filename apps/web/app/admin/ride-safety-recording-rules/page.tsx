"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiDrivers } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type RuleRow = {
  id: string;
  country_code: string | null;
  state_code: string | null;
  city: string | null;
  client_audio_allowed: boolean;
  driver_video_allowed: boolean;
  retention_days: number;
  is_active: boolean;
};

export default function AdminRideSafetyRecordingRulesPage() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiDrivers(session?.role ?? null));
    const res = await adminFetch("/api/admin/ride-safety-recording-rules");
    const body = await res.json().catch(() => ({}));
    setRules(body.rules ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRule(e: FormEvent<HTMLFormElement>, rule: RuleRow) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    setSavingId(rule.id);
    try {
      const res = await adminFetch("/api/admin/ride-safety-recording-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rule_id: rule.id,
          client_audio_allowed: form.get("client_audio_allowed") === "on",
          driver_video_allowed: form.get("driver_video_allowed") === "on",
          retention_days: Number(form.get("retention_days")),
          is_active: form.get("is_active") === "on",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) alert(json.error ?? "Échec");
      else await load();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AdminGate requiredPermission="taxi_drivers.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Ride Safety Recordings</h1>
            <p className="mt-1 text-sm text-slate-600">
              Conformité audio/vidéo par pays, état ou ville. Conservation 14 jours par défaut.
            </p>
          </header>
          {loading ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : (
            rules.map((rule) => (
              <form
                key={rule.id}
                onSubmit={(e) => void saveRule(e, rule)}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="mb-3 text-sm font-semibold text-slate-700">
                  {rule.country_code ?? "GLOBAL"}
                  {rule.state_code ? ` / ${rule.state_code}` : ""}
                  {rule.city ? ` / ${rule.city}` : ""}
                </p>
                <label className="mr-4 text-sm">
                  <input
                    type="checkbox"
                    name="client_audio_allowed"
                    defaultChecked={rule.client_audio_allowed}
                    disabled={!canEdit}
                  />{" "}
                  Audio client
                </label>
                <label className="mr-4 text-sm">
                  <input
                    type="checkbox"
                    name="driver_video_allowed"
                    defaultChecked={rule.driver_video_allowed}
                    disabled={!canEdit}
                  />{" "}
                  Vidéo chauffeur
                </label>
                <label className="block text-sm mt-3">
                  Conservation (jours)
                  <input
                    name="retention_days"
                    type="number"
                    min={1}
                    max={90}
                    defaultValue={rule.retention_days}
                    disabled={!canEdit}
                    className="mt-1 block w-32 rounded border px-2 py-1"
                  />
                </label>
                <label className="mt-2 block text-sm">
                  <input type="checkbox" name="is_active" defaultChecked={rule.is_active} disabled={!canEdit} />{" "}
                  Active
                </label>
                {canEdit ? (
                  <button
                    type="submit"
                    disabled={savingId === rule.id}
                    className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white"
                  >
                    Enregistrer
                  </button>
                ) : null}
              </form>
            ))
          )}
        </div>
      </main>
    </AdminGate>
  );
}
