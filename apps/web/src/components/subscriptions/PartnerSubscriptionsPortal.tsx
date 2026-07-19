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

export default function PartnerSubscriptionsPortal({
  partnerLabel,
  summaryPath,
  actionsPath,
  backHref,
}: {
  partnerLabel: string;
  summaryPath: string;
  actionsPath: string;
  backHref: string;
}) {
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
      const res = await authFetch(summaryPath);
      setCurrent((res.current as Current) ?? null);
      setPlans((res.plans as Plan[]) ?? []);
      setInvoices((res.invoices as Invoice[]) ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [summaryPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (action: string, extra?: Record<string, unknown>) => {
      if (busy) return;
      setBusy(action);
      try {
        const res = await authFetch(actionsPath, {
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
    [actionsPath, busy, load]
  );

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-sm text-gray-500">Chargement des abonnements…</p>
      </main>
    );
  }

  if (err) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
        <button
          onClick={() => void load()}
          className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white"
        >
          Réessayer
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Abonnements {partnerLabel}</h1>
        <Link href={backHref} className="text-sm text-gray-500 hover:underline">
          ← Tableau de bord
        </Link>
      </div>

      <section className="mt-6 rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold">Plan actuel</h2>
        {current ? (
          <div className="mt-3 space-y-2 text-sm">
            <p>
              <strong>{current.plan?.name ?? "Plan"}</strong> — {current.status}
              {current.is_trial ? " (essai)" : ""}
            </p>
            <p>
              {formatMoney(current.price_cents, current.currency)}
              {current.plan?.billing_period === "yearly" ? " / an" : " / mois"}
            </p>
            {current.current_period_end && (
              <p className="text-gray-600">
                Prochaine échéance :{" "}
                {new Date(current.current_period_end).toLocaleDateString("fr-FR")}
                {current.cancel_at_period_end ? " (annulation programmée)" : ""}
              </p>
            )}
            {current.features && current.features.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-gray-700">
                {current.features.map((f) => (
                  <li key={f.feature_key}>{f.label ?? f.feature_key}</li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {!current.cancel_at_period_end && current.status !== "canceled" && (
                <button
                  disabled={busy === "cancel"}
                  onClick={() => {
                    if (window.confirm("Annuler à la fin de la période en cours ?")) {
                      void runAction("cancel", { at_period_end: true });
                    }
                  }}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium"
                >
                  Annuler
                </button>
              )}
              {current.cancel_at_period_end && (
                <button
                  disabled={busy === "resume"}
                  onClick={() => void runAction("resume")}
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Reprendre
                </button>
              )}
              <button
                disabled={busy === "portal"}
                onClick={() => void runAction("portal")}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium"
              >
                Portail de facturation
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-600">Aucun abonnement actif. Choisissez un plan ci-dessous.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Comparer les plans</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {plans.map((p) => {
            const isCurrent = current?.plan?.id === p.id;
            return (
              <div key={p.id} className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{p.name}</h3>
                    <p className="text-xs text-gray-500">{p.code}</p>
                  </div>
                  {isCurrent && (
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                      Actuel
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xl font-bold">
                  {formatMoney(p.price_cents, p.currency)}
                  <span className="text-sm font-normal text-gray-500">
                    {p.billing_period === "yearly" ? " / an" : " / mois"}
                  </span>
                </p>
                {p.description && <p className="mt-2 text-sm text-gray-600">{p.description}</p>}
                {p.features && p.features.length > 0 && (
                  <ul className="mt-3 space-y-1 text-xs text-gray-700">
                    {p.features.slice(0, 8).map((f) => (
                      <li key={f.feature_key}>• {f.label ?? f.feature_key}</li>
                    ))}
                  </ul>
                )}
                {!isCurrent && (
                  <button
                    disabled={busy === `plan-${p.id}`}
                    onClick={() => {
                      const label = current ? "Changer pour" : "Souscrire à";
                      if (window.confirm(`${label} « ${p.name} » ?`)) {
                        void runAction(current ? "change_plan" : "checkout", { plan_id: p.id });
                      }
                    }}
                    className="mt-4 w-full rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {busy === `plan-${p.id}` ? "…" : current ? "Changer de plan" : "Souscrire"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {invoices.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Historique de facturation</h2>
          <ul className="mt-3 space-y-2">
            {invoices.map((inv) => (
              <li key={inv.id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <span className="font-medium">{inv.kind}</span> · {inv.status} ·{" "}
                {formatMoney(inv.amount_cents, inv.currency)} ·{" "}
                {new Date(inv.created_at).toLocaleDateString("fr-FR")}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
