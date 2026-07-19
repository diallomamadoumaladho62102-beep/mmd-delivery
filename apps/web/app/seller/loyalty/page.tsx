"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";

type Summary = {
  enabled: boolean;
  account_status: "active" | "suspended";
  points_balance: number;
  lifetime_points: number;
  tier_code: string;
  tier_label: string;
  next_tier: { code: string; label: string; min_points: number } | null;
  completed_sales: number;
  revenue_cents: number;
  currency: string;
  active_benefits_count: number;
  referral_code: string | null;
  referral_link: string | null;
};

type Reward = {
  id: string;
  name: string;
  description: string | null;
  points_cost: number;
  benefit_type: string;
  benefit_value: number;
  benefit_currency: string;
  duration_days: number | null;
};

type ActiveBenefit = {
  id: string;
  benefit_type: string;
  benefit_value: number;
  benefit_currency: string;
  starts_at: string;
  expires_at: string | null;
  status: string;
};

const BENEFIT_LABELS: Record<string, string> = {
  marketplace_fee_credit: "Crédit sur frais Marketplace",
  commission_discount: "Réduction de commission",
  priority_placement: "Placement prioritaire",
  sponsored_product: "Produit sponsorisé",
  recommended_badge: "Badge vendeur recommandé",
  ad_credit: "Crédit publicitaire",
  free_promotion: "Promotion gratuite",
  advanced_tools: "Outils avancés",
  extra_visibility: "Visibilité supplémentaire",
  custom: "Avantage",
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
    throw new Error(json?.error ?? "Action temporairement impossible. Veuillez réessayer.");
  }
  return json;
}

export default function SellerLoyaltyPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [benefits, setBenefits] = useState<ActiveBenefit[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [summaryRes, rewardsRes] = await Promise.all([
        authFetch("/api/seller/loyalty/summary"),
        authFetch("/api/seller/loyalty/rewards"),
      ]);
      setSummary(summaryRes.summary as Summary);
      setRewards((rewardsRes.rewards ?? []) as Reward[]);
      setBenefits((rewardsRes.active_benefits ?? []) as ActiveBenefit[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const redeem = useCallback(
    async (reward: Reward) => {
      if (redeeming) return;
      const ok = window.confirm(
        `Échanger ${reward.points_cost} points contre « ${reward.name} » ? Cette action est définitive.`
      );
      if (!ok) return;
      setRedeeming(reward.id);
      try {
        const key = `redeem-${reward.id}-${Date.now()}`;
        const res = await authFetch("/api/seller/loyalty/redeem", {
          method: "POST",
          body: JSON.stringify({ reward_id: reward.id, idempotency_key: key }),
        });
        if (res.summary) setSummary(res.summary as Summary);
        await load();
        window.alert("Échange réussi. Votre avantage est actif.");
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Échange impossible.");
      } finally {
        setRedeeming(null);
      }
    },
    [redeeming, load]
  );

  const copyLink = useCallback(() => {
    if (!summary?.referral_link) return;
    void navigator.clipboard.writeText(summary.referral_link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [summary?.referral_link]);

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-sm text-gray-500">Chargement du programme de fidélité…</p>
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

  if (!summary?.enabled) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">Fidélité Vendeur</h1>
        <p className="mt-4 text-sm text-gray-600">
          Le programme de fidélité vendeur n&apos;est pas encore activé pour votre compte.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Fidélité Vendeur</h1>
        <Link href="/seller" className="text-sm text-gray-500 hover:underline">
          ← Tableau de bord
        </Link>
      </div>

      {summary.account_status === "suspended" && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Votre compte de fidélité est temporairement suspendu. Contactez le support MMD.
        </div>
      )}

      <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-xs uppercase text-gray-500">Points</div>
          <div className="mt-1 text-2xl font-bold">{summary.points_balance}</div>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-xs uppercase text-gray-500">Niveau</div>
          <div className="mt-1 text-2xl font-bold">{summary.tier_label}</div>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-xs uppercase text-gray-500">Ventes</div>
          <div className="mt-1 text-2xl font-bold">{summary.completed_sales}</div>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-xs uppercase text-gray-500">Avantages actifs</div>
          <div className="mt-1 text-2xl font-bold">{summary.active_benefits_count}</div>
        </div>
      </section>

      {summary.next_tier && (
        <p className="mt-4 text-sm text-gray-600">
          Prochain niveau : <strong>{summary.next_tier.label}</strong> — encore{" "}
          {Math.max(0, summary.next_tier.min_points - summary.lifetime_points)} points cumulés.
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Récompenses disponibles</h2>
        {rewards.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Aucune récompense disponible pour le moment.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {rewards.map((r) => {
              const affordable =
                summary.points_balance >= r.points_cost && summary.account_status === "active";
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-gray-200 p-4"
                >
                  <div className="pr-4">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-gray-500">
                      {BENEFIT_LABELS[r.benefit_type] ?? r.benefit_type}
                      {r.duration_days ? ` · ${r.duration_days} jours` : ""}
                    </div>
                    {r.description && <p className="mt-1 text-sm text-gray-600">{r.description}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-sm font-semibold">{r.points_cost} pts</span>
                    <button
                      disabled={!affordable || redeeming === r.id}
                      onClick={() => void redeem(r)}
                      className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {redeeming === r.id ? "…" : "Échanger"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {benefits.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Avantages actifs</h2>
          <ul className="mt-3 space-y-2">
            {benefits.map((b) => (
              <li key={b.id} className="rounded-lg border border-gray-200 p-3 text-sm">
                <span className="font-medium">{BENEFIT_LABELS[b.benefit_type] ?? b.benefit_type}</span>
                {b.expires_at && (
                  <span className="text-gray-500">
                    {" "}
                    · expire le {new Date(b.expires_at).toLocaleDateString("fr-FR")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Parrainage</h2>
        {summary.referral_code ? (
          <div className="mt-3 rounded-xl border border-gray-200 p-4">
            <div className="text-sm text-gray-600">Votre code vendeur</div>
            <div className="mt-1 text-xl font-bold tracking-wider">{summary.referral_code}</div>
            {summary.referral_link && (
              <button
                onClick={copyLink}
                className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium"
              >
                {copied ? "Lien copié !" : "Copier le lien de parrainage"}
              </button>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-500">Code de parrainage indisponible pour le moment.</p>
        )}
      </section>
    </main>
  );
}
