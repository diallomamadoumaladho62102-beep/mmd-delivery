"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type Summary = {
  balance_cents?: number;
  available_cents?: number;
  awaiting_transfer_cents?: number;
  pending_cents?: number;
  paid_out_cents?: number;
  platform_fees_cents?: number;
  refunded_cents?: number;
  currency?: string;
  note?: string | null;
};

type Activity = {
  id: string;
  kind: string;
  status: string;
  amount_cents: number;
  currency: string;
  direction: string;
  title: string;
  subtitle: string | null;
  stripe_transfer_id: string | null;
  stripe_refund_id: string | null;
  created_at: string;
};

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format((Number(cents) || 0) / 100);
}

export default function SellerWalletPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<Activity[]>([]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.replace("/login");
        return;
      }
      const [sumRes, actRes] = await Promise.all([
        fetch("/api/wallet/summary?account_type=seller&country_code=US", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/wallet/seller-activity?limit=50", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const sumJson = await sumRes.json().catch(() => ({}));
      const actJson = await actRes.json().catch(() => ({}));
      if (!sumRes.ok) throw new Error(String(sumJson.error ?? "summary_failed"));
      if (!actRes.ok) throw new Error(String(actJson.error ?? "activity_failed"));
      setSummary(sumJson as Summary);
      setItems((actJson.items ?? []) as Activity[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    }
  }, [router]);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 text-slate-200">
        Loading seller wallet…
      </main>
    );
  }

  const currency = summary?.currency ?? "USD";

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-slate-100">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Seller Wallet</h1>
          <p className="mt-2 text-slate-400">
            Marketplace earnings, commissions, transfers and refunds
          </p>
        </div>
        <Link href="/seller" className="text-sky-300 hover:underline">
          Back to seller
        </Link>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">
          {error}
        </div>
      ) : null}

      <section className="mt-8 rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Awaiting transfer
        </p>
        <p className="mt-2 text-4xl font-black">
          {money(
            Number(summary?.awaiting_transfer_cents ?? summary?.pending_cents ?? 0),
            currency
          )}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-slate-400">Paid out</p>
            <p className="font-bold">
              {money(Number(summary?.paid_out_cents ?? summary?.available_cents ?? 0), currency)}
            </p>
          </div>
          <div>
            <p className="text-slate-400">Commissions</p>
            <p className="font-bold">{money(Number(summary?.platform_fees_cents ?? 0), currency)}</p>
          </div>
          <div>
            <p className="text-slate-400">Refunds</p>
            <p className="font-bold">{money(Number(summary?.refunded_cents ?? 0), currency)}</p>
          </div>
        </div>
        {summary?.note ? (
          <p className="mt-4 text-sm text-slate-400">{summary.note}</p>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold">Activity</h2>
        {items.length === 0 ? (
          <p className="mt-4 text-slate-400">No payouts or refunds yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-800">
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-sm text-slate-400">
                    {new Date(item.created_at).toLocaleString()} · {item.status}
                  </p>
                  {item.subtitle ? (
                    <p className="text-sm text-slate-500">{item.subtitle}</p>
                  ) : null}
                  {item.stripe_transfer_id ? (
                    <p className="text-xs text-slate-500">SCT {item.stripe_transfer_id}</p>
                  ) : null}
                  {item.stripe_refund_id ? (
                    <p className="text-xs text-slate-500">Refund {item.stripe_refund_id}</p>
                  ) : null}
                </div>
                <p
                  className={
                    item.direction === "credit"
                      ? "font-bold text-emerald-400"
                      : "font-bold text-red-300"
                  }
                >
                  {item.direction === "credit" ? "+" : "−"}
                  {money(item.amount_cents, item.currency)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
