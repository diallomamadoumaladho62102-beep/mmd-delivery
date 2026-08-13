"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { businessApi } from "@/components/business/businessApi";
import {
  BusinessEmptyCard,
  BusinessErrorBanner,
  BusinessLoadingState,
} from "@/components/business/BusinessShell";
import {
  bizCard,
  bizGlassStrong,
  money,
} from "@/components/business/businessUi";

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

export default function BusinessWalletPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [topupCents, setTopupCents] = useState("5000");
  const [cashoutCents, setCashoutCents] = useState("");
  const [busy, setBusy] = useState(false);
  const [showTopup, setShowTopup] = useState(false);
  const [showCashout, setShowCashout] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      router.replace("/login");
      return;
    }
    const [sum, hist] = await Promise.all([
      businessApi("/api/taxi/business/wallet/summary"),
      businessApi("/api/taxi/business/wallet/history?limit=50"),
    ]);
    setSummary(sum as Summary);
    setItems(((hist as { items?: Item[] }).items ?? []) as Item[]);
  }, [router]);

  useEffect(() => {
    void refresh()
      .catch((e) => setError(e instanceof Error ? e.message : "load_failed"))
      .finally(() => setLoading(false));
  }, [refresh]);

  async function onTopup(e: FormEvent) {
    e.preventDefault();
    if (!summary?.business_account_id) return;
    setBusy(true);
    try {
      const out = await businessApi(
        "/api/stripe/client/create-business-wallet-topup-session",
        {
          method: "POST",
          body: JSON.stringify({
            business_account_id: summary.business_account_id,
            amount_cents: Math.round(Number(topupCents)),
          }),
        }
      );
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
      await businessApi("/api/taxi/business/wallet/summary", {
        method: "POST",
        body: JSON.stringify({
          action: "cashout",
          business_account_id: summary.business_account_id,
          amount_cents: Math.round(Number(cashoutCents)),
        }),
      });
      setCashoutCents("");
      setShowCashout(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "cashout_failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <BusinessLoadingState
        title="Loading business wallet..."
        subtitle="Please wait"
      />
    );
  }

  if (error && !summary) {
    return (
      <div className="flex flex-col gap-4">
        <BusinessErrorBanner message={error} />
        <BusinessEmptyCard
          title="Wallet unavailable"
          description="We couldn’t load your business wallet. Retry after checking your membership."
          actionLabel="Retry"
          onAction={() => {
            setLoading(true);
            void refresh()
              .catch((e) =>
                setError(e instanceof Error ? e.message : "load_failed")
              )
              .finally(() => setLoading(false));
          }}
        />
      </div>
    );
  }

  if (!summary) {
    return (
      <BusinessEmptyCard
        title="No business wallet"
        description="No business membership found for this account."
        actionLabel="Back to Dashboard"
        href="/business"
      />
    );
  }

  const currency = summary.currency ?? "USD";
  const balance = Number(summary.available_cents ?? summary.balance_cents ?? 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[30px] font-bold text-white">Business Wallet</h1>
        <p className="mt-1.5 text-sm text-white/70">
          {summary.account?.name ?? "Corporate prepaid balance"} ·{" "}
          {summary.role ?? "—"}
        </p>
      </div>

      {error ? <BusinessErrorBanner message={error} /> : null}

      <section className={`${bizGlassStrong} flex flex-col gap-2.5 rounded-3xl p-6`}>
        <p className="text-[44px] font-extrabold leading-none text-white">
          {money(balance, currency)}
        </p>
        <p className="text-sm text-[#22C55E]">Available balance</p>
        <p className="text-xs text-white/60">
          Connect:{" "}
          {summary.connect?.stripe_payouts_enabled
            ? "ready for cash-out"
            : summary.connect?.stripe_onboarding_status ?? "setup required"}
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            setShowTopup((v) => !v);
            setShowCashout(false);
          }}
          className="rounded-[14px] bg-[#22C55E] px-[18px] py-3 text-sm font-extrabold text-white"
        >
          Top Up
        </button>
        <button
          type="button"
          onClick={() => {
            setShowCashout((v) => !v);
            setShowTopup(false);
          }}
          className="rounded-[14px] border border-white/[0.15] bg-white/[0.08] px-[18px] py-3 text-sm font-extrabold text-white"
        >
          Cash Out
        </button>
      </div>

      {showTopup ? (
        <form onSubmit={onTopup} className={`${bizCard} flex flex-col gap-3 p-5`}>
          <label className="text-sm font-bold text-white">
            Amount (cents)
            <input
              className="mt-2 w-full rounded-xl border border-white/20 bg-white/[0.06] px-3 py-2 text-white"
              value={topupCents}
              onChange={(e) => setTopupCents(e.target.value)}
            />
          </label>
          <button
            disabled={busy}
            className="rounded-xl bg-[#22C55E] px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
          >
            {busy ? "Redirecting…" : "Top up with Stripe"}
          </button>
        </form>
      ) : null}

      {showCashout ? (
        <form
          onSubmit={onCashout}
          className={`${bizCard} flex flex-col gap-3 p-5`}
        >
          <label className="text-sm font-bold text-white">
            Amount (cents)
            <input
              className="mt-2 w-full rounded-xl border border-white/20 bg-white/[0.06] px-3 py-2 text-white"
              value={cashoutCents}
              onChange={(e) => setCashoutCents(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !summary.can_cashout}
            className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
          >
            {summary.can_cashout
              ? busy
                ? "Processing…"
                : "Transfer to Connect"
              : "Cash-out unavailable"}
          </button>
        </form>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-extrabold text-white">Recent activity</h2>
        {items.length === 0 ? (
          <p className="text-sm text-white/60">No transactions yet.</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={`${bizGlassStrong} flex items-center justify-between gap-4 rounded-[20px] px-4 py-3.5`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold capitalize text-white">
                  {item.entry_type} · {item.status}
                </p>
                <p className="text-xs text-white/70">
                  {new Date(item.created_at).toLocaleString()}
                </p>
              </div>
              <p
                className={`shrink-0 text-sm font-extrabold ${
                  item.direction === "credit"
                    ? "text-[#22C55E]"
                    : "text-[#EF4444]"
                }`}
              >
                {item.direction === "credit" ? "+" : "−"}
                {money(item.amount_cents, item.currency)}
              </p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
