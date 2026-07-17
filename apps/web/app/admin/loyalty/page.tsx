"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageLoyalty } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type LoyaltySettingsRow = {
  enabled: boolean;
  points_per_delivery: number;
  points_per_ride: number;
  conversion_points: number;
  conversion_credit_cents: number;
  credit_validity_months: number;
  referral_points_client: number;
  referral_points_driver: number;
  currency: string;
};

type CampaignRow = {
  id: string;
  name: string;
  audience: string;
  vertical: string;
  bonus_type: string;
  bonus_points: number;
  multiplier: number;
  max_uses: number | null;
  uses_count: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

type AdjustSummary = {
  points_balance: number;
  lifetime_points: number;
  tier_label: string;
  credit_cents: number;
  currency: string;
};

const INPUT_CLASS =
  "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const CARD_CLASS = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

function LoyaltyAdminInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [settings, setSettings] = useState<LoyaltySettingsRow | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);

  const [adjustUserId, setAdjustUserId] = useState("");
  const [adjustSummary, setAdjustSummary] = useState<AdjustSummary | null>(null);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustCredit, setAdjustCredit] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const [newCampaign, setNewCampaign] = useState({
    name: "",
    audience: "client",
    vertical: "any",
    bonus_type: "flat",
    bonus_points: "5",
    multiplier: "2",
    max_uses: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageLoyalty(session?.role ?? null));

    const [configRes, campaignsRes] = await Promise.all([
      adminFetch("/api/admin/loyalty/config"),
      adminFetch("/api/admin/loyalty/campaigns"),
    ]);
    const configBody = await configRes.json().catch(() => ({}));
    const campaignsBody = await campaignsRes.json().catch(() => ({}));

    if (!configRes.ok || !configBody.ok) {
      setError(configBody.error ?? "Échec chargement configuration");
      setLoading(false);
      return;
    }

    setSettings(configBody.settings as LoyaltySettingsRow);
    setCampaigns((campaignsBody.campaigns ?? []) as CampaignRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!settings) return;
      setNotice(null);
      setError(null);
      const res = await adminFetch("/api/admin/loyalty/config", {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Échec sauvegarde");
        return;
      }
      setSettings(body.settings as LoyaltySettingsRow);
      setNotice("Configuration enregistrée.");
    },
    [settings]
  );

  const createCampaign = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setNotice(null);
      setError(null);
      const payload: Record<string, unknown> = {
        name: newCampaign.name,
        audience: newCampaign.audience,
        vertical: newCampaign.vertical,
        bonus_type: newCampaign.bonus_type,
        bonus_points: Number(newCampaign.bonus_points) || 0,
        multiplier: Number(newCampaign.multiplier) || 1,
        max_uses: newCampaign.max_uses ? Number(newCampaign.max_uses) : null,
      };
      const res = await adminFetch("/api/admin/loyalty/campaigns", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Échec création campagne");
        return;
      }
      setNewCampaign((c) => ({ ...c, name: "" }));
      setNotice("Campagne créée.");
      void load();
    },
    [newCampaign, load]
  );

  const toggleCampaign = useCallback(
    async (campaign: CampaignRow) => {
      const res = await adminFetch("/api/admin/loyalty/campaigns", {
        method: "PATCH",
        body: JSON.stringify({ id: campaign.id, active: !campaign.active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Échec mise à jour campagne");
        return;
      }
      void load();
    },
    [load]
  );

  const lookupUser = useCallback(async () => {
    setError(null);
    setAdjustSummary(null);
    const id = adjustUserId.trim();
    if (!id) return;
    const res = await adminFetch(
      `/api/admin/loyalty/adjust?userId=${encodeURIComponent(id)}`
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Utilisateur introuvable");
      return;
    }
    setAdjustSummary(body.summary as AdjustSummary);
  }, [adjustUserId]);

  const submitAdjust = useCallback(
    async (kind: "points" | "credit") => {
      setNotice(null);
      setError(null);
      const id = adjustUserId.trim();
      if (!id) {
        setError("Renseignez un user_id");
        return;
      }
      const payload: Record<string, unknown> = { user_id: id, kind, reason: adjustReason };
      if (kind === "points") {
        payload.delta_points = Number(adjustPoints) || 0;
      } else {
        payload.delta_cents = Number(adjustCredit) || 0;
      }
      const res = await adminFetch("/api/admin/loyalty/adjust", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Échec ajustement");
        return;
      }
      setAdjustSummary(body.summary as AdjustSummary);
      setAdjustPoints("");
      setAdjustCredit("");
      setNotice("Ajustement appliqué (journalisé dans l'audit admin).");
    },
    [adjustUserId, adjustPoints, adjustCredit, adjustReason]
  );

  const updateSetting = (key: keyof LoyaltySettingsRow, value: number | boolean) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  };

  if (loading) {
    return <div className="p-6 text-slate-600">Chargement…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Fidélité MMD</h1>
          <p className="text-sm text-slate-600">
            Programme unifié Delivery + Taxi — points, Crédit MMD, campagnes et parrainage.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        {settings && (
          <form className={CARD_CLASS} onSubmit={saveSettings}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Configuration</h2>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  disabled={!canEdit}
                  onChange={(e) => updateSetting("enabled", e.target.checked)}
                />
                Programme actif
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-sm text-slate-700">
                Points / livraison
                <input
                  type="number"
                  min={0}
                  className={INPUT_CLASS}
                  value={settings.points_per_delivery}
                  disabled={!canEdit}
                  onChange={(e) => updateSetting("points_per_delivery", Number(e.target.value))}
                />
              </label>
              <label className="text-sm text-slate-700">
                Points / course taxi
                <input
                  type="number"
                  min={0}
                  className={INPUT_CLASS}
                  value={settings.points_per_ride}
                  disabled={!canEdit}
                  onChange={(e) => updateSetting("points_per_ride", Number(e.target.value))}
                />
              </label>
              <label className="text-sm text-slate-700">
                Points pour conversion
                <input
                  type="number"
                  min={1}
                  className={INPUT_CLASS}
                  value={settings.conversion_points}
                  disabled={!canEdit}
                  onChange={(e) => updateSetting("conversion_points", Number(e.target.value))}
                />
              </label>
              <label className="text-sm text-slate-700">
                Crédit MMD par conversion (cents)
                <input
                  type="number"
                  min={1}
                  className={INPUT_CLASS}
                  value={settings.conversion_credit_cents}
                  disabled={!canEdit}
                  onChange={(e) =>
                    updateSetting("conversion_credit_cents", Number(e.target.value))
                  }
                />
              </label>
              <label className="text-sm text-slate-700">
                Validité du Crédit MMD
                <select
                  className={INPUT_CLASS}
                  value={settings.credit_validity_months}
                  disabled={!canEdit}
                  onChange={(e) =>
                    updateSetting("credit_validity_months", Number(e.target.value))
                  }
                >
                  <option value={0}>Aucune expiration</option>
                  <option value={6}>6 mois</option>
                  <option value={12}>12 mois</option>
                </select>
              </label>
              <label className="text-sm text-slate-700">
                Points parrainage (client)
                <input
                  type="number"
                  min={0}
                  className={INPUT_CLASS}
                  value={settings.referral_points_client}
                  disabled={!canEdit}
                  onChange={(e) =>
                    updateSetting("referral_points_client", Number(e.target.value))
                  }
                />
              </label>
              <label className="text-sm text-slate-700">
                Points parrainage (chauffeur)
                <input
                  type="number"
                  min={0}
                  className={INPUT_CLASS}
                  value={settings.referral_points_driver}
                  disabled={!canEdit}
                  onChange={(e) =>
                    updateSetting("referral_points_driver", Number(e.target.value))
                  }
                />
              </label>
            </div>

            {canEdit && (
              <button
                type="submit"
                className="mt-4 rounded-xl bg-mmd-accent-strong px-4 py-2 text-sm font-semibold text-white"
              >
                Enregistrer la configuration
              </button>
            )}
          </form>
        )}

        <div className={CARD_CLASS}>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Campagnes & bonus</h2>

          {canEdit && (
            <form
              className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
              onSubmit={createCampaign}
            >
              <label className="text-sm text-slate-700 lg:col-span-2">
                Nom
                <input
                  className={INPUT_CLASS}
                  value={newCampaign.name}
                  onChange={(e) => setNewCampaign((c) => ({ ...c, name: e.target.value }))}
                  required
                />
              </label>
              <label className="text-sm text-slate-700">
                Audience
                <select
                  className={INPUT_CLASS}
                  value={newCampaign.audience}
                  onChange={(e) => setNewCampaign((c) => ({ ...c, audience: e.target.value }))}
                >
                  <option value="client">Client</option>
                  <option value="driver">Chauffeur</option>
                  <option value="both">Les deux</option>
                </select>
              </label>
              <label className="text-sm text-slate-700">
                Service
                <select
                  className={INPUT_CLASS}
                  value={newCampaign.vertical}
                  onChange={(e) => setNewCampaign((c) => ({ ...c, vertical: e.target.value }))}
                >
                  <option value="any">Tous</option>
                  <option value="food">Food</option>
                  <option value="taxi">Taxi</option>
                  <option value="marketplace">Marketplace</option>
                  <option value="delivery">Delivery</option>
                </select>
              </label>
              <label className="text-sm text-slate-700">
                Type
                <select
                  className={INPUT_CLASS}
                  value={newCampaign.bonus_type}
                  onChange={(e) => setNewCampaign((c) => ({ ...c, bonus_type: e.target.value }))}
                >
                  <option value="flat">Bonus fixe</option>
                  <option value="multiplier">Multiplicateur</option>
                </select>
              </label>
              <label className="text-sm text-slate-700">
                Bonus points
                <input
                  type="number"
                  min={0}
                  className={INPUT_CLASS}
                  value={newCampaign.bonus_points}
                  onChange={(e) =>
                    setNewCampaign((c) => ({ ...c, bonus_points: e.target.value }))
                  }
                />
              </label>
              <label className="text-sm text-slate-700">
                Multiplicateur
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  className={INPUT_CLASS}
                  value={newCampaign.multiplier}
                  onChange={(e) => setNewCampaign((c) => ({ ...c, multiplier: e.target.value }))}
                />
              </label>
              <label className="text-sm text-slate-700">
                Utilisations max (vide = illimité)
                <input
                  type="number"
                  min={0}
                  className={INPUT_CLASS}
                  value={newCampaign.max_uses}
                  onChange={(e) => setNewCampaign((c) => ({ ...c, max_uses: e.target.value }))}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="rounded-xl bg-mmd-accent-strong px-4 py-2 text-sm font-semibold text-white"
                >
                  Créer la campagne
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Nom</th>
                  <th className="px-3 py-2">Audience</th>
                  <th className="px-3 py-2">Service</th>
                  <th className="px-3 py-2">Bonus</th>
                  <th className="px-3 py-2">Usages</th>
                  <th className="px-3 py-2">Statut</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {campaigns.length === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={7}>
                      Aucune campagne.
                    </td>
                  </tr>
                )}
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{c.name}</td>
                    <td className="px-3 py-2">{c.audience}</td>
                    <td className="px-3 py-2">{c.vertical}</td>
                    <td className="px-3 py-2">
                      {c.bonus_type === "flat"
                        ? `+${c.bonus_points} pts`
                        : `x${c.multiplier}`}
                    </td>
                    <td className="px-3 py-2">
                      {c.uses_count}
                      {c.max_uses != null ? ` / ${c.max_uses}` : ""}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          c.active
                            ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"
                            : "rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
                        }
                      >
                        {c.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && (
                        <button
                          type="button"
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                          onClick={() => toggleCampaign(c)}
                        >
                          {c.active ? "Désactiver" : "Activer"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={CARD_CLASS}>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            Ajustement compte utilisateur
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-700">
              user_id
              <input
                className={`${INPUT_CLASS} w-80`}
                value={adjustUserId}
                onChange={(e) => setAdjustUserId(e.target.value)}
                placeholder="UUID de l'utilisateur"
              />
            </label>
            <button
              type="button"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm"
              onClick={lookupUser}
            >
              Consulter
            </button>
          </div>

          {adjustSummary && (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <div className="text-xs text-slate-500">Points</div>
                <div className="text-lg font-semibold">{adjustSummary.points_balance}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Cumul</div>
                <div className="text-lg font-semibold">{adjustSummary.lifetime_points}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Niveau</div>
                <div className="text-lg font-semibold">{adjustSummary.tier_label}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Crédit MMD</div>
                <div className="text-lg font-semibold">
                  {(adjustSummary.credit_cents / 100).toFixed(2)} {adjustSummary.currency}
                </div>
              </div>
            </div>
          )}

          {canEdit && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="text-sm text-slate-700">
                Ajuster points (+/-)
                <input
                  type="number"
                  className={INPUT_CLASS}
                  value={adjustPoints}
                  onChange={(e) => setAdjustPoints(e.target.value)}
                />
                <button
                  type="button"
                  className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white"
                  onClick={() => submitAdjust("points")}
                >
                  Appliquer points
                </button>
              </label>
              <label className="text-sm text-slate-700">
                Ajuster crédit (cents, +/-)
                <input
                  type="number"
                  className={INPUT_CLASS}
                  value={adjustCredit}
                  onChange={(e) => setAdjustCredit(e.target.value)}
                />
                <button
                  type="button"
                  className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white"
                  onClick={() => submitAdjust("credit")}
                >
                  Appliquer crédit
                </button>
              </label>
              <label className="text-sm text-slate-700">
                Motif (audit)
                <input
                  className={INPUT_CLASS}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="Raison de l'ajustement"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminLoyaltyPage() {
  return (
    <AdminGate requiredPermission="loyalty.read">
      <LoyaltyAdminInner />
    </AdminGate>
  );
}
