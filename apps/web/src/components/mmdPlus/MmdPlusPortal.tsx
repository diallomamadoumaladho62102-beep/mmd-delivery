"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  billing_period: string;
  color: string | null;
  trial_enabled?: boolean;
  trial_days?: number;
  features?: Array<{ feature_key: string; label?: string; enabled: boolean }>;
};

type Current = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  is_trial: boolean;
  price_cents: number;
  currency: string;
  plan?: Plan | null;
  features?: Array<{ feature_key: string; label?: string }>;
};

type Invoice = {
  id: string;
  kind: string;
  status: string;
  amount_cents: number;
  currency: string;
  created_at: string;
  description: string | null;
};

async function authFetch(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expirée. Veuillez vous reconnecter.");
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? "Action temporairement impossible.");
  }
  return json;
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency || "USD",
  }).format((cents || 0) / 100);
}

export default function MmdPlusPortal() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await authFetch("/api/mmd-plus/summary");
      setCurrent((res.current as Current) ?? null);
      setPlans((res.plans as Plan[]) ?? []);
      setInvoices((res.invoices as Invoice[]) ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (action: string, extra?: Record<string, unknown>) => {
      if (busy) return;
      setBusy(action);
      try {
        const res = await authFetch("/api/mmd-plus/actions", {
          method: "POST",
          body: JSON.stringify({ action, ...extra }),
        });
        if (res.checkout_url) {
          window.location.href = String(res.checkout_url);
          return;
        }
        if (res.portal_url) {
          window.location.href = String(res.portal_url);
          return;
        }
        await load();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Action impossible.");
      } finally {
        setBusy(null);
      }
    },
    [busy, load]
  );

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-sm text-slate-500">Chargement de MMD+…</p>
      </main>
    );
  }

  if (err) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {err}
        </div>
        <button
          onClick={() => void load()}
          className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Réessayer
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8">
        <p className="text-sm font-medium uppercase tracking-wide text-amber-600">MMD+</p>
        <h1 className="mt-1 text-3xl font-semibold text-slate-900">Abonnement Premium client</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Un seul abonnement pour Food, Delivery, Taxi et Marketplace — indépendant de vos points
          fidélité et du Crédit MMD.
        </p>
      </div>

      <section className="mb-8 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-white">
        {current ? (
          <>
            <p className="text-sm text-slate-300">Abonnement actuel</p>
            <h2 className="mt-1 text-2xl font-semibold">
              {current.plan?.name ?? "MMD+"}{" "}
              <span className="text-base font-normal text-slate-300">({current.status})</span>
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              {formatMoney(current.price_cents, current.currency)}
              {current.is_trial ? " · Essai" : ""}
              {current.current_period_end
                ? ` · Prochaine échéance ${new Date(current.current_period_end).toLocaleDateString("fr-FR")}`
                : ""}
              {current.cancel_at_period_end ? " · Annulation en fin de période" : ""}
            </p>
            <ul className="mt-4 grid gap-1 text-sm text-slate-200 sm:grid-cols-2">
              {(current.features ?? []).map((f) => (
                <li key={f.feature_key}>• {f.label ?? f.feature_key}</li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                disabled={!!busy}
                onClick={() => void runAction("portal")}
                className="rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-900"
              >
                Gérer le paiement
              </button>
              {current.cancel_at_period_end ? (
                <button
                  disabled={!!busy}
                  onClick={() => void runAction("resume")}
                  className="rounded-md border border-white/40 px-3 py-2 text-sm"
                >
                  Reprendre
                </button>
              ) : (
                <button
                  disabled={!!busy}
                  onClick={() => void runAction("cancel")}
                  className="rounded-md border border-white/40 px-3 py-2 text-sm"
                >
                  Annuler
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold">Aucun abonnement actif</h2>
            <p className="mt-2 text-sm text-slate-300">
              Comparez les plans ci-dessous et souscrivez pour débloquer vos avantages.
            </p>
          </>
        )}
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-slate-900">Comparer les plans</h2>
        {plans.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Aucun plan disponible pour le moment.</p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = current?.plan?.id === plan.id;
              return (
                <div
                  key={plan.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  style={{ borderTopColor: plan.color ?? "#0f172a", borderTopWidth: 4 }}
                >
                  <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">{plan.description}</p>
                  <p className="mt-3 text-xl font-semibold text-slate-900">
                    {formatMoney(plan.price_cents, plan.currency)}
                    <span className="text-sm font-normal text-slate-500">
                      /{plan.billing_period === "yearly" ? "an" : "mois"}
                    </span>
                  </p>
                  <ul className="mt-3 space-y-1 text-sm text-slate-600">
                    {(plan.features ?? []).slice(0, 6).map((f) => (
                      <li key={f.feature_key}>• {f.label ?? f.feature_key}</li>
                    ))}
                  </ul>
                  <button
                    disabled={!!busy || isCurrent}
                    onClick={() =>
                      void runAction(current ? "change_plan" : "checkout", { plan_id: plan.id })
                    }
                    className="mt-4 w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {isCurrent ? "Plan actuel" : current ? "Changer" : "Souscrire"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Historique de facturation</h2>
        {invoices.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Aucune facture pour le moment.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-slate-800">
                    {inv.description ?? inv.kind} · {inv.status}
                  </p>
                  <p className="text-slate-500">
                    {new Date(inv.created_at).toLocaleString("fr-FR")}
                  </p>
                </div>
                <p className="font-medium text-slate-900">
                  {formatMoney(inv.amount_cents, inv.currency)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-sm text-slate-500">
        <Link href="/client" className="underline">
          Retour à l&apos;espace client
        </Link>
      </p>
    </main>
  );
}
