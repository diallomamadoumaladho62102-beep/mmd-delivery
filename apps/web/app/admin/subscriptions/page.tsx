"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageSubscriptions } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type Plan = {
  id: string;
  partner_type: string;
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
  partner_type: string;
  partner_user_id: string;
  status: string;
  plan_id: string;
  current_period_end: string | null;
  subscription_plans?: { code: string; name: string } | null;
};

const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

function SubscriptionsAdminInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [offerPartnerType, setOfferPartnerType] = useState("restaurant");
  const [offerUserId, setOfferUserId] = useState("");
  const [offerPlanId, setOfferPlanId] = useState("");
  const [offerReason, setOfferReason] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageSubscriptions(session?.role ?? null));
    const [plansHttp, subsHttp] = await Promise.all([
      adminFetch("/api/admin/subscriptions/plans"),
      adminFetch("/api/admin/subscriptions/accounts?limit=50"),
    ]);
    const plansRes = (await plansHttp.json().catch(() => ({}))) as Record<string, unknown>;
    const subsRes = (await subsHttp.json().catch(() => ({}))) as Record<string, unknown>;
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const offer = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canEdit) return;
      const http = await adminFetch("/api/admin/subscriptions/accounts", {
        method: "POST",
        body: JSON.stringify({
          action: "offer",
          partner_type: offerPartnerType,
          partner_user_id: offerUserId.trim(),
          plan_id: offerPlanId,
          reason: offerReason,
        }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Offre impossible"));
        return;
      }
      setNotice("Abonnement offert.");
      setOfferReason("");
      await load();
    },
    [canEdit, offerPartnerType, offerUserId, offerPlanId, offerReason, load]
  );

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <section className={CARD}>
        <h2 className="text-lg font-semibold">Plans</h2>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {plans.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="font-medium">
                  {p.partner_type}/{p.code}
                </span>{" "}
                — {p.name} · {(p.price_cents / 100).toFixed(2)} {p.currency} / {p.billing_period}
                <span className="ml-2 text-xs text-slate-500">{p.status}</span>
              </div>
              <div className="text-xs text-slate-500">
                Stripe Price: {p.stripe_price_id || "non configuré"}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {canEdit && (
        <section className={CARD}>
          <h2 className="text-lg font-semibold">Offrir un abonnement</h2>
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => void offer(e)}>
            <label className="text-sm">
              Type
              <select
                className={INPUT}
                value={offerPartnerType}
                onChange={(e) => setOfferPartnerType(e.target.value)}
              >
                <option value="restaurant">Restaurant</option>
                <option value="seller">Seller</option>
              </select>
            </label>
            <label className="text-sm">
              Partner user ID
              <input
                className={INPUT}
                value={offerUserId}
                onChange={(e) => setOfferUserId(e.target.value)}
                required
              />
            </label>
            <label className="text-sm sm:col-span-2">
              Plan
              <select
                className={INPUT}
                value={offerPlanId}
                onChange={(e) => setOfferPlanId(e.target.value)}
                required
              >
                <option value="">—</option>
                {plans
                  .filter((p) => p.partner_type === offerPartnerType && p.status === "active")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.billing_period})
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              Motif
              <input
                className={INPUT}
                value={offerReason}
                onChange={(e) => setOfferReason(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-medium text-white sm:col-span-2"
            >
              Offrir
            </button>
          </form>
        </section>
      )}

      <section className={CARD}>
        <h2 className="text-lg font-semibold">Abonnements récents</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {subs.length === 0 && <li className="text-slate-500">Aucun abonnement.</li>}
          {subs.map((s) => (
            <li key={s.id} className="rounded-lg border border-slate-100 px-3 py-2">
              <span className="font-medium">
                {s.partner_type} · {s.subscription_plans?.name ?? s.plan_id}
              </span>{" "}
              — {s.status}
              <div className="text-xs text-slate-500">
                {s.partner_user_id}
                {s.current_period_end
                  ? ` · fin ${new Date(s.current_period_end).toLocaleDateString("fr-FR")}`
                  : ""}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function SubscriptionsAdminPage() {
  return (
    <AdminGate requiredPermission="subscriptions.read">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">Abonnements</h1>
        <p className="mt-1 text-sm text-slate-600">
          Plans Premium restaurants & marketplace — indépendants de la fidélité.
        </p>
        <div className="mt-6">
          <SubscriptionsAdminInner />
        </div>
      </div>
    </AdminGate>
  );
}
