"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function DriverMarketingPage() {
  const [objectives, setObjectives] = useState<Array<Record<string, unknown>>>([]);
  const [progress, setProgress] = useState<Array<Record<string, unknown>>>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Session expirée");
      const res = await fetch("/api/driver/marketing/summary", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) throw new Error(json?.error ?? "Erreur");
      setObjectives(json.objectives ?? []);
      setProgress(json.progress ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Bonus & objectifs</h1>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <section className="mt-6">
        <h2 className="font-medium">Campagnes disponibles</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {objectives.map((o) => (
            <li key={String(o.id)} className="rounded-xl border p-3">
              {String(o.title)} — objectif {String(o.target_count)} · récompense{" "}
              {((Number(o.reward_cents) || 0) / 100).toFixed(2)} $
            </li>
          ))}
          {objectives.length === 0 && <li className="text-slate-500">Aucune campagne active.</li>}
        </ul>
      </section>
      <section className="mt-6">
        <h2 className="font-medium">Ma progression</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {progress.map((p) => (
            <li key={String(p.id)} className="rounded-xl border p-3">
              {String((p.marketing_driver_objectives as { title?: string } | null)?.title ?? "Objectif")}{" "}
              · {String(p.progress_count)} /{" "}
              {String((p.marketing_driver_objectives as { target_count?: number } | null)?.target_count ?? "?")}{" "}
              · {String(p.status)}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
