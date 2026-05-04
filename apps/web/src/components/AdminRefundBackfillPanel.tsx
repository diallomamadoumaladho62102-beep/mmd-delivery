"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function AdminRefundBackfillPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function runBackfill(dryRun: boolean) {
    setLoading(true);
    setResult(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        throw new Error("Session admin expirée. Reconnecte-toi.");
      }

      const res = await fetch("/api/admin/refunds/backfill-canceled-orders", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dryRun,
          limit: 10,
        }),
      });

      const json = await res.json();
      setResult(json);
    } catch (e: any) {
      setResult({ error: e?.message ?? "Erreur inconnue" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">
          🧾 Refunds anciens
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Outil admin pour vérifier et rembourser les anciennes commandes déjà annulées.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={loading}
          onClick={() => runBackfill(true)}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          🔍 Vérifier sans rembourser
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={() => runBackfill(false)}
          className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          💳 Lancer les remboursements
        </button>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Traitement en cours…</p>
      ) : null}

      {result ? (
        <pre className="mt-4 max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-green-300">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}