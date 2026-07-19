"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";

type Offer = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  campaign_type: string;
  services: string[];
  ends_at: string | null;
  discount_percent: number | null;
  requires_code: boolean;
};

type Coupon = {
  id: string;
  status: string;
  expires_at: string | null;
  value_cents: number | null;
  value_percent: number | null;
  marketing_campaigns?: { name?: string; description?: string } | null;
};

async function authFetch(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expirée.");
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
    throw new Error(json?.error ?? "Action impossible.");
  }
  return json;
}

export default function MarketingPortalPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [code, setCode] = useState("");
  const [validateMsg, setValidateMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await authFetch("/api/marketing/summary?service=food&subtotal_cents=2500&delivery_fee_cents=500");
      setOffers((res.offers as Offer[]) ?? []);
      setCoupons((res.coupons as Coupon[]) ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const validate = useCallback(async () => {
    setValidateMsg(null);
    try {
      const res = await authFetch("/api/marketing/actions", {
        method: "POST",
        body: JSON.stringify({
          action: "validate_code",
          service: "food",
          promo_code: code,
          subtotal_cents: 2500,
          delivery_fee_cents: 500,
        }),
      });
      const disc = Number(res.resolve?.order_discount_cents ?? 0);
      const fee = Number(res.resolve?.delivery_fee_discount_cents ?? 0);
      setValidateMsg(
        disc + fee > 0
          ? `Code accepté : −${(disc / 100).toFixed(2)} $ panier, −${(fee / 100).toFixed(2)} $ livraison`
          : "Code accepté sans réduction calculable pour ce montant."
      );
    } catch (e) {
      setValidateMsg(e instanceof Error ? e.message : "Code refusé.");
    }
  }, [code]);

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-slate-500">Chargement des promotions…</p>
      </main>
    );
  }

  if (err) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
        <button onClick={() => void load()} className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
          Réessayer
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold text-slate-900">Promotions & coupons</h1>
      <p className="mt-2 text-sm text-slate-600">
        Offres automatiques, codes promo et portefeuille de coupons — cumulables avec MMD+ et le Crédit MMD selon
        les règles configurées.
      </p>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Saisir un code</h2>
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="CODEPROMO"
          />
          <button
            onClick={() => void validate()}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Vérifier
          </button>
        </div>
        {validateMsg && <p className="mt-2 text-sm text-slate-600">{validateMsg}</p>}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Mes coupons</h2>
        {coupons.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Aucun coupon disponible.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {coupons.map((c) => (
              <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <strong>{c.marketing_campaigns?.name ?? "Coupon"}</strong>
                <div className="text-slate-500">
                  {c.value_percent != null ? `${c.value_percent}%` : ""}
                  {c.value_cents != null ? ` ${(c.value_cents / 100).toFixed(2)} $` : ""}
                  {c.expires_at ? ` · expire ${new Date(c.expires_at).toLocaleDateString("fr-FR")}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Offres disponibles</h2>
        {offers.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Aucune offre visible pour le moment.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {offers.map((o) => (
              <li key={o.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <strong>{o.name}</strong>
                <div className="text-slate-500">
                  {o.description} · {(o.services ?? []).join(", ")}
                  {o.requires_code ? " · code requis" : " · auto"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-sm text-slate-500">
        <Link href="/client" className="underline">
          Retour client
        </Link>
      </p>
    </main>
  );
}
