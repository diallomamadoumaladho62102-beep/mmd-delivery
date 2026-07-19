"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMmdPlus } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type Plan = {
  id: string;
  code: string;
  name: string;
  price_cents: number;
  currency: string;
  billing_period: string;
  status: string;
  stripe_price_id: string | null;
};

type Sub = {
  id: string;
  user_id: string;
  status: string;
  plan_id: string;
  current_period_end: string | null;
  mmd_plus_plans?: { code: string; name: string } | null;
};

type Invoice = {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  amount_cents: number;
  currency: string;
  created_at: string;
};

const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

function MmdPlusAdminInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchUserId, setSearchUserId] = useState("");

  const [offerUserId, setOfferUserId] = useState("");
  const [offerPlanId, setOfferPlanId] = useState("");
  const [offerReason, setOfferReason] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMmdPlus(session?.role ?? null));
    const qs = searchUserId.trim() ? `?userId=${encodeURIComponent(searchUserId.trim())}` : "?limit=50";
    const [plansHttp, subsHttp, billHttp] = await Promise.all([
      adminFetch("/api/admin/mmd-plus/plans"),
      adminFetch(`/api/admin/mmd-plus/accounts${qs}`),
      adminFetch("/api/admin/mmd-plus/billing?limit=40"),
    ]);
    const plansRes = (await plansHttp.json().catch(() => ({}))) as Record<string, unknown>;
    const subsRes = (await subsHttp.json().catch(() => ({}))) as Record<string, unknown>;
    const billRes = (await billHttp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!plansHttp.ok || plansRes.ok === false) {
      setError(String(plansRes.error ?? "Chargement plans impossible"));
      return;
    }
    setPlans((plansRes.plans as Plan[]) ?? []);
    setSubs(
      subsHttp.ok && subsRes.ok !== false
        ? ((subsRes.subscriptions as Sub[]) ?? [])
        : []
    );
    setInvoices(
      billHttp.ok && billRes.ok !== false
        ? ((billRes.invoices as Invoice[]) ?? [])
        : []
    );
  }, [searchUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const offer = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canEdit) return;
      const http = await adminFetch("/api/admin/mmd-plus/accounts", {
        method: "POST",
        body: JSON.stringify({
          action: "offer",
          user_id: offerUserId.trim(),
          plan_id: offerPlanId,
          reason: offerReason,
        }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Offre impossible"));
        return;
      }
      setNotice("Abonnement MMD+ offert.");
      setOfferReason("");
      await load();
    },
    [canEdit, offerUserId, offerPlanId, offerReason, load]
  );

  const runSubAction = useCallback(
    async (action: string, subscriptionId: string, extra?: Record<string, unknown>) => {
      if (!canEdit) return;
      const reason = window.prompt("Motif (obligatoire)")?.trim();
      if (!reason) return;
      const http = await adminFetch("/api/admin/mmd-plus/accounts", {
        method: "POST",
        body: JSON.stringify({ action, subscription_id: subscriptionId, reason, ...extra }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Action impossible"));
        return;
      }
      setNotice(`Action ${action} effectuée.`);
      await load();
    },
    [canEdit, load]
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">MMD+ (clients)</h1>
        <p className="mt-1 text-sm text-slate-600">
          Catalogue, abonnements clients et facturation — indépendant des abonnements partenaires.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <section className={CARD}>
        <h2 className="text-lg font-semibold">Plans</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {plans.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <strong>{p.name}</strong> · {p.code} · {p.billing_period} · {p.status}
              </span>
              <span className="text-slate-500">
                {(p.price_cents / 100).toFixed(2)} {p.currency}
                {p.stripe_price_id ? ` · ${p.stripe_price_id}` : " · Stripe Price manquant"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {canEdit && (
        <section className={CARD}>
          <h2 className="text-lg font-semibold">Offrir un abonnement</h2>
          <form onSubmit={offer} className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              Client user_id
              <input className={INPUT} value={offerUserId} onChange={(e) => setOfferUserId(e.target.value)} required />
            </label>
            <label className="text-sm">
              Plan
              <select className={INPUT} value={offerPlanId} onChange={(e) => setOfferPlanId(e.target.value)} required>
                <option value="">Sélectionner</option>
                {plans.filter((p) => p.status === "active").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.billing_period})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm md:col-span-2">
              Motif
              <input className={INPUT} value={offerReason} onChange={(e) => setOfferReason(e.target.value)} required />
            </label>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">
              Offrir
            </button>
          </form>
        </section>
      )}

      <section className={CARD}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Rechercher client (user_id)
            <input
              className={INPUT}
              value={searchUserId}
              onChange={(e) => setSearchUserId(e.target.value)}
              placeholder="uuid"
            />
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm"
          >
            Actualiser
          </button>
        </div>
        <h2 className="mt-4 text-lg font-semibold">Abonnements</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {subs.map((s) => (
            <li key={s.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong>{s.mmd_plus_plans?.name ?? s.plan_id}</strong> · {s.status}
                  <div className="text-slate-500">{s.user_id}</div>
                  {s.current_period_end && (
                    <div className="text-slate-500">
                      Fin période {new Date(s.current_period_end).toLocaleDateString("fr-FR")}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-lg border px-2 py-1"
                      onClick={() => void runSubAction("extend", s.id, { days: 30 })}
                    >
                      +30j
                    </button>
                    <button
                      className="rounded-lg border px-2 py-1"
                      onClick={() => void runSubAction("suspend", s.id)}
                    >
                      Suspendre
                    </button>
                    <button
                      className="rounded-lg border px-2 py-1"
                      onClick={() => void runSubAction("resume", s.id)}
                    >
                      Reprendre
                    </button>
                    <button
                      className="rounded-lg border px-2 py-1"
                      onClick={() => void runSubAction("cancel", s.id)}
                    >
                      Résilier
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
          {subs.length === 0 && <li className="py-2 text-slate-500">Aucun abonnement.</li>}
        </ul>
      </section>

      <section className={CARD}>
        <h2 className="text-lg font-semibold">Factures / paiements</h2>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {invoices.map((inv) => (
            <li key={inv.id} className="flex justify-between py-2">
              <span>
                {inv.kind} · {inv.status} · {inv.user_id.slice(0, 8)}…
              </span>
              <span>
                {(inv.amount_cents / 100).toFixed(2)} {inv.currency}
              </span>
            </li>
          ))}
          {invoices.length === 0 && <li className="py-2 text-slate-500">Aucune facture.</li>}
        </ul>
      </section>
    </div>
  );
}

export default function AdminMmdPlusPage() {
  return (
    <AdminGate>
      <MmdPlusAdminInner />
    </AdminGate>
  );
}
