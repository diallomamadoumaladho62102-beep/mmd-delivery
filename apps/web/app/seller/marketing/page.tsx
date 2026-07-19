"use client";

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

export default function SellerMarketingPage() {
  const [campaigns, setCampaigns] = useState<Array<Record<string, unknown>>>([]);
  const [requests, setRequests] = useState<Array<Record<string, unknown>>>([]);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/seller/marketing");
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
        await authFetch("/api/seller/marketing", {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        setTitle("");
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erreur");
      }
    },
    [title, load]
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Campagnes Marketplace</h1>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <form onSubmit={submit} className="mt-6 space-y-3 rounded-2xl border p-4">
        <input
          className="w-full rounded-xl border px-3 py-2 text-sm"
          placeholder="Titre de la demande"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
          Demander une campagne
        </button>
      </form>
      <ul className="mt-6 space-y-2 text-sm">
        {campaigns.map((c) => (
          <li key={String(c.id)} className="rounded-xl border p-3">
            {String(c.name)} · {String(c.status)}
          </li>
        ))}
      </ul>
      <ul className="mt-4 space-y-2 text-sm">
        {requests.map((r) => (
          <li key={String(r.id)} className="rounded-xl border p-3">
            Demande : {String(r.title)} · {String(r.status)}
          </li>
        ))}
      </ul>
    </main>
  );
}
