"use client";


import { useAdminT } from "@/i18n/useAdminT";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

async function authFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expirée");
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) throw new Error(json?.error ?? "Erreur");
  return json;
}

export default function RestaurantMarketingPage() {
  const { t } = useAdminT();

  const [campaigns, setCampaigns] = useState<Array<Record<string, unknown>>>([]);
  const [requests, setRequests] = useState<Array<Record<string, unknown>>>([]);
  const [title, setTitle] = useState("");
  const [budget, setBudget] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await authFetch("/api/restaurant/marketing");
      setCampaigns((res.campaigns as Array<Record<string, unknown>>) ?? []);
      setRequests((res.requests as Array<Record<string, unknown>>) ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      try {
        await authFetch("/api/restaurant/marketing", {
          method: "POST",
          body: JSON.stringify({
            title,
            proposed_budget_cents: Math.round(Number(budget || 0) * 100),
          }),
        });
        setTitle("");
        setBudget("");
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erreur");
      }
    },
    [title, budget, load]
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("Campagnes Restaurant")}</h1>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}

      <form onSubmit={submit} className="mt-6 space-y-3 rounded-2xl border p-4">
        <h2 className="font-medium">{t("Demande de campagne sponsorisée")}</h2>
        <input
          className="w-full rounded-xl border px-3 py-2 text-sm"
          placeholder={t("Titre")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <input
          className="w-full rounded-xl border px-3 py-2 text-sm"
          placeholder={t("Budget (USD)")}
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
          {t("Soumettre (validation MMD)")}
        </button>
      </form>

      <section className="mt-8">
        <h2 className="font-medium">{t("Mes campagnes")}</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {campaigns.map((c) => (
            <li key={String(c.id)} className="rounded-xl border p-3">
              {String(c.name)} · {String(c.status)} · budget {String(c.budget_spent_cents ?? 0)}/
              {String(c.budget_total_cents ?? "∞")}
            </li>
          ))}
          {campaigns.length === 0 && <li className="text-slate-500">{t("Aucune.")}</li>}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="font-medium">{t("Demandes")}</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {requests.map((r) => (
            <li key={String(r.id)} className="rounded-xl border p-3">
              {String(r.title)} · {String(r.status)}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
