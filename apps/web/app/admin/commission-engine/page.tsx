"use client";

import { FormEvent, useCallback, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageCommissions } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type Resolved = {
  rate_pct: number;
  fixed_fee_cents: number;
  fee_credit_cents: number;
  base_rate_pct: number | null;
  rule_type: string;
  rule_label: string | null;
  loyalty_benefit_id: string | null;
};

type LoyaltyBenefit = {
  id: string;
  benefit_type: string;
  benefit_value: number;
  status: string;
  expires_at: string | null;
};

const INPUT =
  "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

function CommissionEngineInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [partnerType, setPartnerType] = useState<"restaurant" | "seller">("restaurant");
  const [partnerUserId, setPartnerUserId] = useState("");
  const [service, setService] = useState<"food" | "marketplace">("food");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [partnerLabel, setPartnerLabel] = useState<string | null>(null);
  const [loyaltyBenefits, setLoyaltyBenefits] = useState<LoyaltyBenefit[]>([]);
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);

  const [ratePct, setRatePct] = useState("12");
  const [fixedFee, setFixedFee] = useState("0");
  const [reason, setReason] = useState("");
  const [overrideStatus, setOverrideStatus] = useState("active");

  const lookup = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageCommissions(session?.role ?? null));

    const [resolveHttp, auditHttp] = await Promise.all([
      adminFetch(
        `/api/admin/commission-engine/resolve?partnerType=${partnerType}&partnerUserId=${encodeURIComponent(partnerUserId.trim())}&service=${service}`
      ),
      adminFetch(
        `/api/admin/commission-engine/audit?partnerUserId=${encodeURIComponent(partnerUserId.trim())}&limit=20`
      ),
    ]);

    setLoading(false);
    const resolveRes = (await resolveHttp.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const auditRes = (await auditHttp.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!resolveHttp.ok || resolveRes.ok === false) {
      setError(String(resolveRes.error ?? "Recherche impossible"));
      setResolved(null);
      return;
    }

    setResolved(resolveRes.resolved as Resolved);
    setPartnerLabel((resolveRes.partner as { label?: string } | undefined)?.label ?? null);
    setLoyaltyBenefits((resolveRes.loyalty_benefits as LoyaltyBenefit[]) ?? []);
    setAudit(
      auditHttp.ok && auditRes.ok !== false
        ? ((auditRes.audit as Array<Record<string, unknown>>) ?? [])
        : []
    );
  }, [partnerType, partnerUserId, service]);

  const createOverride = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canEdit) return;
      setError(null);
      setNotice(null);

      const http = await adminFetch("/api/admin/commission-engine/overrides", {
        method: "POST",
        body: JSON.stringify({
          partner_type: partnerType,
          partner_user_id: partnerUserId.trim(),
          service,
          rate_pct: Number(ratePct),
          fixed_fee_cents: Number(fixedFee),
          status: overrideStatus,
          reason,
        }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;

      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Création impossible"));
        return;
      }
      setNotice("Commission personnalisée enregistrée.");
      setReason("");
      await lookup();
    },
    [canEdit, partnerType, partnerUserId, service, ratePct, fixedFee, overrideStatus, reason, lookup]
  );

  return (
    <div className="space-y-6">
      <section className={CARD}>
        <h2 className="text-lg font-semibold">Rechercher un partenaire</h2>
        <p className="mt-1 text-sm text-slate-600">
          Consulter la commission actuelle et la règle gagnante (fidélité → override → contrat →
          campagne → tarifs).
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Type
            <select
              className={INPUT}
              value={partnerType}
              onChange={(e) => {
                const v = e.target.value as "restaurant" | "seller";
                setPartnerType(v);
                setService(v === "restaurant" ? "food" : "marketplace");
              }}
            >
              <option value="restaurant">Restaurant</option>
              <option value="seller">Vendeur Marketplace</option>
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            Partner user ID
            <input
              className={INPUT}
              value={partnerUserId}
              onChange={(e) => setPartnerUserId(e.target.value)}
              placeholder="uuid du restaurant ou vendeur"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => void lookup()}
          disabled={!partnerUserId.trim() || loading}
          className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {loading ? "Chargement…" : "Consulter"}
        </button>
      </section>

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

      {resolved && (
        <section className={CARD}>
          <h2 className="text-lg font-semibold">
            Commission actuelle{partnerLabel ? ` — ${partnerLabel}` : ""}
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="text-xs uppercase text-slate-500">Taux plateforme</div>
              <div className="text-2xl font-bold">{resolved.rate_pct}%</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Frais fixes</div>
              <div className="text-2xl font-bold">{resolved.fixed_fee_cents}¢</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Crédit frais</div>
              <div className="text-2xl font-bold">{resolved.fee_credit_cents}¢</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Règle</div>
              <div className="text-sm font-semibold">{resolved.rule_type}</div>
              <div className="text-xs text-slate-500">{resolved.rule_label}</div>
            </div>
          </div>
          {resolved.base_rate_pct != null && resolved.rule_type === "loyalty_benefit" && (
            <p className="mt-3 text-sm text-slate-600">
              Base avant fidélité : {resolved.base_rate_pct}%
            </p>
          )}
          {loyaltyBenefits.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">Avantages fidélité actifs</h3>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {loyaltyBenefits.map((b) => (
                  <li key={b.id}>
                    {b.benefit_type} · valeur {b.benefit_value} · {b.status}
                    {b.expires_at
                      ? ` · expire ${new Date(b.expires_at).toLocaleDateString("fr-FR")}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {canEdit && partnerUserId.trim() && (
        <section className={CARD}>
          <h2 className="text-lg font-semibold">Créer une commission personnalisée</h2>
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => void createOverride(e)}>
            <label className="text-sm">
              Taux plateforme (%)
              <input className={INPUT} value={ratePct} onChange={(e) => setRatePct(e.target.value)} />
            </label>
            <label className="text-sm">
              Frais fixes (cents)
              <input
                className={INPUT}
                value={fixedFee}
                onChange={(e) => setFixedFee(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Statut
              <select
                className={INPUT}
                value={overrideStatus}
                onChange={(e) => setOverrideStatus(e.target.value)}
              >
                <option value="draft">Brouillon</option>
                <option value="scheduled">Programmé</option>
                <option value="active">Actif</option>
                <option value="suspended">Suspendu</option>
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              Motif (obligatoire)
              <input
                className={INPUT}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-medium text-white sm:col-span-2"
            >
              Enregistrer
            </button>
          </form>
        </section>
      )}

      {audit.length > 0 && (
        <section className={CARD}>
          <h2 className="text-lg font-semibold">Historique</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {audit.map((row) => (
              <li key={String(row.id)} className="rounded-lg border border-slate-100 px-3 py-2">
                <span className="font-medium">{String(row.action)}</span>
                <span className="text-slate-500">
                  {" "}
                  · {row.created_at ? new Date(String(row.created_at)).toLocaleString("fr-FR") : ""}
                </span>
                {row.reason ? <div className="text-slate-600">Motif : {String(row.reason)}</div> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function CommissionEngineAdminPage() {
  return (
    <AdminGate requiredPermission="commissions.read">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">Moteur de commissions</h1>
        <p className="mt-1 text-sm text-slate-600">
          Contrats, commissions personnalisées et résolution unique Food / Marketplace.
        </p>
        <div className="mt-6">
          <CommissionEngineInner />
        </div>
      </div>
    </AdminGate>
  );
}
