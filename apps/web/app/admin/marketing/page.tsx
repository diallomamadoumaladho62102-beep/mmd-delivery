"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canFinanceMarketing, canManageMarketing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type Campaign = {
  id: string;
  code: string;
  name: string;
  campaign_type: string;
  status: string;
  services: string[];
  discount_percent: number | null;
  discount_cents: number | null;
  auto_apply: boolean;
  requires_code: boolean;
};

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";

function MarketingAdminInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [canFinance, setCanFinance] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [opsSummary, setOpsSummary] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState("percentage_discount");
  const [percent, setPercent] = useState("10");
  const [grantUserId, setGrantUserId] = useState("");
  const [grantCampaignId, setGrantCampaignId] = useState("");
  const [grantReason, setGrantReason] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMarketing(session?.role ?? null));
    setCanFinance(canFinanceMarketing(session?.role ?? null));
    const [http, opsHttp] = await Promise.all([
      adminFetch("/api/admin/marketing/campaigns?limit=80"),
      adminFetch("/api/admin/marketing/ops"),
    ]);
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    const ops = (await opsHttp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Chargement impossible"));
      return;
    }
    setCampaigns((res.campaigns as Campaign[]) ?? []);
    if (opsHttp.ok && ops.ok !== false && ops.summary) {
      setOpsSummary(ops.summary as Record<string, number>);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runOps = useCallback(
    async (action: string, extra?: Record<string, unknown>) => {
      if (!canFinance) return;
      const reason = window.prompt("Motif (audit)")?.trim();
      if (!reason) return;
      const http = await adminFetch("/api/admin/marketing/ops", {
        method: "POST",
        body: JSON.stringify({ action, reason, ...extra }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Action impossible"));
        return;
      }
      setNotice(`Action ${action} exécutée.`);
      await load();
    },
    [canFinance, load]
  );

  const createCampaign = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canEdit) return;
      const http = await adminFetch("/api/admin/marketing/campaigns", {
        method: "POST",
        body: JSON.stringify({
          action: "upsert",
          code,
          name,
          campaign_type: type,
          discount_percent: Number(percent),
          auto_apply: true,
          status: "draft",
          services: ["food", "delivery", "taxi", "marketplace"],
          reason: "admin_create",
        }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Création impossible"));
        return;
      }
      setNotice("Campagne créée (brouillon).");
      setName("");
      setCode("");
      await load();
    },
    [canEdit, code, name, type, percent, load]
  );

  const setStatus = useCallback(
    async (campaignId: string, status: string) => {
      if (!canEdit) return;
      const reason = window.prompt("Motif")?.trim();
      if (!reason) return;
      const http = await adminFetch("/api/admin/marketing/campaigns", {
        method: "POST",
        body: JSON.stringify({ action: "set_status", campaign_id: campaignId, status, reason }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Action impossible"));
        return;
      }
      setNotice(`Statut → ${status}`);
      await load();
    },
    [canEdit, load]
  );

  const grantCoupon = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canEdit) return;
      const http = await adminFetch("/api/admin/marketing/codes", {
        method: "POST",
        body: JSON.stringify({
          action: "grant_coupon",
          user_id: grantUserId.trim(),
          campaign_id: grantCampaignId,
          reason: grantReason,
        }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Attribution impossible"));
        return;
      }
      setNotice("Coupon attribué.");
      setGrantReason("");
    },
    [canEdit, grantUserId, grantCampaignId, grantReason]
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Marketing</h1>
        <p className="mt-1 text-sm text-slate-600">
          Campagnes, codes promo, coupons — moteur central Food / Delivery / Taxi / Marketplace.
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

      {canEdit && (
        <section className={CARD}>
          <h2 className="text-lg font-semibold">Nouvelle campagne</h2>
          <form onSubmit={createCampaign} className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              Code
              <input className={INPUT} value={code} onChange={(e) => setCode(e.target.value)} required />
            </label>
            <label className="text-sm">
              Nom
              <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="text-sm">
              Type
              <select className={INPUT} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="percentage_discount">percentage_discount</option>
                <option value="fixed_discount">fixed_discount</option>
                <option value="free_delivery">free_delivery</option>
                <option value="cashback">cashback</option>
                <option value="first_order_offer">first_order_offer</option>
                <option value="subscription_exclusive_offer">subscription_exclusive_offer</option>
                <option value="happy_hour">happy_hour</option>
              </select>
            </label>
            <label className="text-sm">
              % réduction
              <input className={INPUT} value={percent} onChange={(e) => setPercent(e.target.value)} />
            </label>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">
              Créer
            </button>
          </form>
        </section>
      )}

      {canEdit && (
        <section className={CARD}>
          <h2 className="text-lg font-semibold">Attribuer un coupon</h2>
          <form onSubmit={grantCoupon} className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              Client user_id
              <input className={INPUT} value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)} required />
            </label>
            <label className="text-sm">
              Campagne
              <select
                className={INPUT}
                value={grantCampaignId}
                onChange={(e) => setGrantCampaignId(e.target.value)}
                required
              >
                <option value="">Sélectionner</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm md:col-span-2">
              Motif
              <input className={INPUT} value={grantReason} onChange={(e) => setGrantReason(e.target.value)} required />
            </label>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">
              Attribuer
            </button>
          </form>
        </section>
      )}

      <section className={CARD}>
        <h2 className="text-lg font-semibold">Campagnes</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {campaigns.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div>
                <strong>{c.name}</strong> · {c.code} · {c.campaign_type} · {c.status}
                <div className="text-slate-500">
                  {(c.services ?? []).join(", ")}
                  {c.discount_percent != null ? ` · ${c.discount_percent}%` : ""}
                  {c.auto_apply ? " · auto" : ""}
                  {c.requires_code ? " · code" : ""}
                </div>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-lg border px-2 py-1" onClick={() => void setStatus(c.id, "active")}>
                    Activer
                  </button>
                  <button className="rounded-lg border px-2 py-1" onClick={() => void setStatus(c.id, "suspended")}>
                    Suspendre
                  </button>
                  <button className="rounded-lg border px-2 py-1" onClick={() => void setStatus(c.id, "ended")}>
                    Terminer
                  </button>
                </div>
              )}
            </li>
          ))}
          {campaigns.length === 0 && <li className="py-2 text-slate-500">Aucune campagne.</li>}
        </ul>
      </section>

      <section className={CARD}>
        <h2 className="text-lg font-semibold">Opérations Phase 7.1</h2>
        <p className="mt-1 text-sm text-slate-600">
          Réservations, cashback → Crédit MMD, bonus chauffeurs, pont taxi legacy.
        </p>
        {opsSummary && (
          <dl className="mt-3 grid gap-2 text-sm md:grid-cols-3">
            {Object.entries(opsSummary).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                <dt className="text-slate-500">{k}</dt>
                <dd className="font-medium text-slate-900">{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {canFinance && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border px-3 py-1.5 text-sm"
              onClick={() => void runOps("credit_cashback_batch")}
            >
              Créditer cashback
            </button>
            <button
              type="button"
              className="rounded-lg border px-3 py-1.5 text-sm"
              onClick={() => void runOps("process_driver_batch")}
            >
              Traiter objectifs chauffeurs
            </button>
            <button
              type="button"
              className="rounded-lg border px-3 py-1.5 text-sm"
              onClick={() => void runOps("bridge_taxi_legacy", { dry_run: true })}
            >
              Pont taxi (dry-run)
            </button>
            <button
              type="button"
              className="rounded-lg border px-3 py-1.5 text-sm"
              onClick={() => void runOps("bridge_taxi_legacy", { dry_run: false })}
            >
              Migrer taxi legacy
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function AdminMarketingPage() {
  return (
    <AdminGate>
      <MarketingAdminInner />
    </AdminGate>
  );
}
