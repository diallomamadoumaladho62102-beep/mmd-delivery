"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { canManageDriverIdentitySettings } from "@/lib/adminAccess";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { supabase } from "@/lib/supabaseBrowser";

type Settings = Record<string, boolean | number | string>;

export default function AdminDriverIdentitySettingsPage() {
  const [role, setRole] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();
      setRole(profile?.role ?? null);
    })();
  }, []);

  const canEdit = canManageDriverIdentitySettings(role as any);

  const load = useCallback(async () => {
    const res = await adminFetch("/api/admin/driver-identity/settings");
    const body = await res.json();
    setSettings(body.settings ?? null);
  }, []);

  useEffect(() => {
    if (canEdit) void load();
  }, [canEdit, load]);

  const save = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await adminFetch("/api/admin/driver-identity/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error(body.error ?? "save_failed");
      setSettings(body.settings);
      setMessage("Paramètres enregistrés.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }, [settings]);

  if (!canEdit) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Paramètres vérification identité</h1>
        <p>Accès refusé.</p>
      </main>
    );
  }

  if (!settings) return <main style={{ padding: 24 }}>Chargement…</main>;

  const boolFields: Array<{ key: keyof Settings; label: string }> = [
    { key: "random_check_enabled", label: "Contrôles aléatoires" },
    { key: "require_on_new_device", label: "Nouvel appareil" },
    { key: "require_on_city_change", label: "Changement de ville" },
    { key: "require_on_country_change", label: "Changement de pays" },
    { key: "require_on_report", label: "Signalement client" },
    { key: "require_on_first_online", label: "Première mise en ligne" },
    { key: "require_on_profile_photo_change", label: "Changement photo profil" },
    { key: "require_on_phone_change", label: "Changement téléphone" },
    { key: "require_after_suspension", label: "Après suspension" },
    { key: "periodic_check_enabled", label: "Contrôle périodique" },
    { key: "manual_review_enabled", label: "Revue manuelle activée" },
  ];

  const intFields: Array<{ key: keyof Settings; label: string }> = [
    { key: "random_min_rides", label: "Courses min (aléatoire)" },
    { key: "random_max_rides", label: "Courses max (aléatoire)" },
    { key: "require_after_inactivity_days", label: "Inactivité (jours)" },
    { key: "periodic_check_days", label: "Périodique (jours)" },
    { key: "verification_validity_days", label: "Validité vérification (jours)" },
    { key: "retention_days", label: "Rétention selfies (jours)" },
  ];

  return (
    <main style={{ padding: 24, display: "grid", gap: 16, maxWidth: 720 }}>
      <header>
        <Link href="/admin/driver-identity">← Retour vérifications</Link>
        <h1 style={{ marginTop: 12 }}>Paramètres moteur de risque</h1>
      </header>

      <section style={{ display: "grid", gap: 10 }}>
        {boolFields.map(({ key, label }) => (
          <label key={String(key)} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={Boolean(settings[key])}
              onChange={(e) =>
                setSettings((prev) => ({ ...(prev ?? {}), [key]: e.target.checked }))
              }
            />
            {label}
          </label>
        ))}
      </section>

      <section style={{ display: "grid", gap: 10 }}>
        {intFields.map(({ key, label }) => (
          <label key={String(key)} style={{ display: "grid", gap: 4 }}>
            {label}
            <input
              type="number"
              value={Number(settings[key] ?? 0)}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...(prev ?? {}),
                  [key]: Number(e.target.value),
                }))
              }
            />
          </label>
        ))}

        <label style={{ display: "grid", gap: 4 }}>
          Seuil revue manuelle (score risque)
          <input
            type="number"
            step="0.01"
            value={Number(settings.manual_review_risk_threshold ?? 0)}
            onChange={(e) =>
              setSettings((prev) => ({
                ...(prev ?? {}),
                manual_review_risk_threshold: Number(e.target.value),
              }))
            }
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          Provider par défaut (internal, facetec, onfido…)
          <input
            type="text"
            value={String(settings.default_provider ?? "internal")}
            onChange={(e) =>
              setSettings((prev) => ({
                ...(prev ?? {}),
                default_provider: e.target.value,
              }))
            }
          />
        </label>
      </section>

      <button type="button" disabled={saving} onClick={() => void save()}>
        {saving ? "Enregistrement…" : "Enregistrer"}
      </button>
      {message ? <p>{message}</p> : null}
    </main>
  );
}
