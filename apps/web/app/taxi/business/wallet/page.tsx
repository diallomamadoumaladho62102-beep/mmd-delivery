"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type Summary = {
  balance_cents?: number;
  available_cents?: number;
  currency?: string;
  can_cashout?: boolean;
  business_account_id?: string;
  role?: string;
  account?: { name?: string } | null;
  connect?: {
    stripe_onboarding_status?: string | null;
    stripe_payouts_enabled?: boolean;
  };
};

type Item = {
  id: string;
  direction: string;
  amount_cents: number;
  currency: string;
  entry_type: string;
  status: string;
  description: string | null;
  created_at: string;
};

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format((Number(cents) || 0) / 100);
}

async function api(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("login_required");
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
  return json;
}

export default function BusinessWalletPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [topupCents, setTopupCents] = useState("5000");
  const [cashoutCents, setCashoutCents] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.user) {
        router.replace("/login");
        return;
      }
      const [sum, hist] = await Promise.all([
        api("/api/taxi/business/wallet/summary"),
        api("/api/taxi/business/wallet/history?limit=50"),
      ]);
      setSummary(sum as Summary);
      setItems(((hist as { items?: Item[] }).items ?? []) as Item[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    }
  }, [router]);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function onTopup(e: FormEvent) {
    e.preventDefault();
    if (!summary?.business_account_id) return;
    setBusy(true);
    try {
      const out = await api("/api/stripe/client/create-business-wallet-topup-session", {
        method: "POST",
        body: JSON.stringify({
          business_account_id: summary.business_account_id,
          amount_cents: Math.round(Number(topupCents)),
        }),
      });
      const url = String((out as { url?: string }).url ?? "");
      if (url) window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "topup_failed");
    } finally {
      setBusy(false);
    }
  }

  async function onCashout(e: FormEvent) {
    e.preventDefault();
    if (!summary?.business_account_id) return;
    setBusy(true);
    try {
      await api("/api/taxi/business/wallet/summary", {
        method: "POST",
        body: JSON.stringify({
          action: "cashout",
          business_account_id: summary.business_account_id,
          amount_cents: Math.round(Number(cashoutCents)),
        }),
      });
      setCashoutCents("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "cashout_failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 text-slate-200">
        Loading business wallet…
      </main>
    );
  }

  const currency = summary?.currency ?? "USD";

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-slate-100">
      <h1 className="text-3xl font-bold tracking-tight">Business Wallet</h1>
      <p className="mt-2 text-slate-400">
        {summary?.account?.name ?? "Corporate prepaid balance"} · role{" "}
        {summary?.role ?? "—"}
      </p>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">
          {error}
        </div>
      ) : null}

      {!summary ? (
        <div className="mt-8 rounded-xl border border-slate-700 p-6 text-slate-400">
          No business membership found for this account.
        </div>
      ) : (
        <>
          <section className="mt-8 rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Available balance
            </p>
            <p className="mt-2 text-4xl font-black">
              {money(Number(summary.balance_cents ?? summary.available_cents ?? 0), currency)}
            </p>
            <p className="mt-3 text-sm text-slate-400">
              Connect:{" "}
              {summary.connect?.stripe_payouts_enabled
                ? "ready for cash-out"
                : summary.connect?.stripe_onboarding_status ?? "setup required"}
            </p>
          </section>

          <section className="mt-6 grid gap-4 md:grid-cols-2">
            <form
              onSubmit={onTopup}
              className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5"
            >
              <h2 className="font-bold">Top up</h2>
              <input
                className="mt-3 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2"
                value={topupCents}
                onChange={(e) => setTopupCents(e.target.value)}
                placeholder="Amount in cents"
              />
              <button
                disabled={busy}
                className="mt-3 w-full rounded-xl bg-amber-500 px-4 py-2 font-bold text-slate-950 disabled:opacity-60"
              >
                Top up with Stripe
              </button>
            </form>

            <form
              onSubmit={onCashout}
              className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5"
            >
              <h2 className="font-bold">Cash out</h2>
              <input
                className="mt-3 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2"
                value={cashoutCents}
                onChange={(e) => setCashoutCents(e.target.value)}
                placeholder="Amount in cents"
              />
              <button
                disabled={busy || !summary.can_cashout}
                className="mt-3 w-full rounded-xl border border-slate-500 px-4 py-2 font-bold disabled:opacity-60"
              >
                {summary.can_cashout ? "Transfer to Connect" : "Cash-out unavailable"}
              </button>
            </form>
          </section>

          <section className="mt-8">
            <h2 className="text-xl font-bold">History</h2>
            {items.length === 0 ? (
              <p className="mt-4 text-slate-400">No transactions yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-800">
                {items.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-4 py-3">
                    <div>
                      <p className="font-semibold capitalize">
                        {item.entry_type} · {item.direction}
                      </p>
                      <p className="text-sm text-slate-400">
                        {new Date(item.created_at).toLocaleString()} · {item.status}
                      </p>
                      {item.description ? (
                        <p className="text-sm text-slate-500">{item.description}</p>
                      ) : null}
                    </div>
                    <p
                      className={
                        item.direction === "credit" ? "font-bold text-emerald-400" : "font-bold text-red-300"
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
        </>
      )}
    </main>
  );
}
