"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { hasPermission } from "@/lib/adminRbac";
import { supabase } from "@/lib/supabaseBrowser";
import { normalizeUserRole } from "@/lib/roles";

type DispatchData = {
  attempts: Array<Record<string, unknown>>;
  schedules: Array<Record<string, unknown>>;
  active_orders: Array<Record<string, unknown>>;
  errors: Record<string, string | null>;
};

export default function AdminDispatchPage() {
  const [data, setData] = useState<DispatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [triggering, setTriggering] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/dispatch", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Échec chargement");
      setData(null);
    } else {
      setData(body as DispatchData);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .maybeSingle();
      setCanManage(hasPermission(normalizeUserRole(profile?.role), "dispatch.manage"));
    })();
  }, [load]);

  async function triggerDispatch(orderId: string) {
    setTriggering(orderId);
    const res = await fetch("/api/admin/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, wave: 1 }),
    });
    const body = await res.json().catch(() => ({}));
    setTriggering(null);
    if (!res.ok || !body.ok) {
      alert(body.error ?? "Échec relance dispatch");
    }
    void load();
  }

  return (
    <AdminGate requiredPermission="dispatch.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Dispatch</h1>
              <p className="mt-1 text-sm text-slate-600">
                Tentatives, planification et commandes actives.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="h-10 rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm text-white"
            >
              Actualiser
            </button>
          </header>

          {loading ? (
            <div className="text-sm text-slate-500">Chargement…</div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : data ? (
            <div className="space-y-8">
              <section>
                <h2 className="mb-3 text-lg font-semibold">Commandes actives</h2>
                <div className="space-y-2">
                  {(data.active_orders ?? []).map((o) => {
                    const id = String(o.id ?? "");
                    return (
                      <div
                        key={id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"
                      >
                        <div className="text-sm">
                          <span className="font-mono">{id.slice(0, 8)}…</span>
                          {" · "}
                          {String(o.status ?? "—")} / {String(o.payment_status ?? "—")}
                        </div>
                        {canManage ? (
                          <button
                            type="button"
                            disabled={triggering === id}
                            onClick={() => void triggerDispatch(id)}
                            className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                          >
                            Relancer dispatch
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <h2 className="mb-3 text-lg font-semibold">Tentatives récentes</h2>
                <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 text-xs">
                  {JSON.stringify(data.attempts, null, 2)}
                </pre>
              </section>

              <section>
                <h2 className="mb-3 text-lg font-semibold">Planification vagues</h2>
                <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 text-xs">
                  {JSON.stringify(data.schedules, null, 2)}
                </pre>
              </section>
            </div>
          ) : null}
        </div>
      </main>
    </AdminGate>
  );
}
