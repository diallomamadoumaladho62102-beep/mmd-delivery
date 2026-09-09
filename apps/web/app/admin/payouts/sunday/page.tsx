"use client";

import { useAdminT } from "@/i18n/useAdminT";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { canAccessPayouts } from "@/lib/adminAccess";
import { supabase } from "@/lib/supabaseBrowser";
import type { UserRole } from "@/lib/roles";

type EligibilityItem = {
  role: "driver" | "restaurant" | "seller";
  user_id: string;
  display_name: string | null;
  stripe_account_id: string | null;
  connect_status: string;
  connect_status_label: string;
  eligible: boolean;
  reason: string | null;
  block_label: string;
  available_cents: number | null;
  pending_cents: number | null;
  last_payout_id: string | null;
  last_payout_status: string | null;
  last_stripe_payout_id: string | null;
  last_payout_amount_cents: number | null;
  last_payout_error: string | null;
  last_payout_at: string | null;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  timezone?: string;
  local_weekday?: string;
  local_hour?: number;
  local_date?: string;
  in_sunday_window?: boolean;
  live_balances?: boolean;
  summary?: {
    total: number;
    eligible: number;
    missing_stripe_account: number;
    stripe_connect_not_ready: number;
    pending_funds: number;
    zero_available: number;
    last_processing?: number;
    last_paid?: number;
    last_failed?: number;
  };
  items?: EligibilityItem[];
};

function cents(value: number | null): string {
  if (value == null) return "—";
  return `$${(value / 100).toFixed(2)}`;
}

export default function AdminSundayPayoutEligibilityPage() {
  const { t } = useAdminT();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [role, setRole] = useState<"all" | "driver" | "restaurant" | "seller">(
    "restaurant",
  );
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (liveBalances: boolean) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (role !== "all") params.set("role", role);
    if (liveBalances) params.set("live_balances", "1");
    const res = await adminFetch(
      `/api/admin/payouts/sunday-eligibility?${params.toString()}`,
    );
    const body = (await res.json().catch(() => ({}))) as ApiResponse;
    if (!res.ok || body.ok === false) {
      setError(body.error ?? `HTTP ${res.status}`);
      setData(null);
    } else {
      setData(body);
    }
    setLive(liveBalances);
    setLoading(false);
  }, [role]);

  useEffect(() => {
    void (async () => {
      const { data: session } = await supabase.auth.getUser();
      const { data: profile } = session.user
        ? await supabase
            .from("profiles")
            .select("role")
            .eq("id", session.user.id)
            .maybeSingle()
        : { data: null };
      const ok = canAccessPayouts(
        ((profile as { role?: UserRole | null } | null)?.role ?? null) as UserRole | null,
      );
      setAllowed(ok);
      if (ok) await load(false);
      else setLoading(false);
    })();
  }, [load]);

  const blocked = useMemo(
    () => (data?.items ?? []).filter((row) => !row.eligible),
    [data],
  );

  if (!allowed && !loading) {
    return <p className="p-6 text-slate-300">{t("Access denied")}</p>;
  }

  return (
    <div className="max-w-full overflow-x-hidden p-6 text-slate-100">
      <Link href="/admin/payouts" className="text-sm text-sky-300">
        {t("← Payouts")}
      </Link>
      <h1 className="mt-4 text-3xl font-black">{t("Sunday payout eligibility")}</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-300">
        {t(
          "Sunday 04:00 America/New_York Connect → bank. Missing Stripe Connect is PAYOUT BLOCKED, never shown as $0 paid.",
        )}
      </p>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {(["restaurant", "driver", "seller", "all"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRole(value)}
            className={`rounded-full px-4 py-2 ${
              role === value ? "bg-white text-slate-950" : "bg-white/10"
            }`}
          >
            {t(
              value === "restaurant"
                ? "Restaurant"
                : value === "driver"
                  ? "Driver"
                  : value === "seller"
                    ? "Seller"
                    : "All",
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load(false)}
          className="rounded-full bg-white/10 px-4 py-2"
        >
          {t("Refresh")}
        </button>
        <button
          type="button"
          onClick={() => void load(true)}
          className="rounded-full bg-emerald-600 px-4 py-2 font-bold"
        >
          {t("Load Stripe balances")}
        </button>
      </div>

      {data ? (
        <p className="mt-4 text-sm text-slate-400">
          {t("Timezone")} {data.timezone} · {data.local_date} {data.local_weekday}{" "}
          {String(data.local_hour).padStart(2, "0")}:00 ·{" "}
          {data.in_sunday_window ? t("Window open") : t("Window closed")}
          {live ? ` · ${t("Live Stripe balances")}` : ""}
        </p>
      ) : null}

      {error ? <p className="mt-4 text-rose-300">{error}</p> : null}
      {loading ? <p className="mt-4">{t("Loading…")}</p> : null}

      {data?.summary ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t("Eligible")} value={data.summary.eligible} />
          <Stat
            label={t("Stripe Connect missing")}
            value={data.summary.missing_stripe_account}
            tone="rose"
          />
          <Stat
            label={t("Connect not ready")}
            value={data.summary.stripe_connect_not_ready}
            tone="amber"
          />
          <Stat
            label={t("Pending Stripe funds")}
            value={data.summary.pending_funds}
            tone="amber"
          />
          <Stat label={t("Processing")} value={data.summary.last_processing ?? 0} tone="amber" />
          <Stat label={t("Paid")} value={data.summary.last_paid ?? 0} />
          <Stat label={t("Failed")} value={data.summary.last_failed ?? 0} tone="rose" />
        </div>
      ) : null}

      <div className="mt-8 max-w-full overflow-x-auto rounded-2xl ring-1 ring-white/10">
        <table className="min-w-[720px] w-full text-left text-sm">
          <thead className="bg-white/5 text-slate-300">
            <tr>
              <th className="px-3 py-2">{t("Role")}</th>
              <th className="px-3 py-2">{t("Name")}</th>
              <th className="px-3 py-2">{t("Connect")}</th>
              <th className="px-3 py-2">{t("Eligible")}</th>
              <th className="px-3 py-2">{t("Reason")}</th>
              <th className="px-3 py-2">{t("Available")}</th>
              <th className="px-3 py-2">{t("Pending")}</th>
              <th className="px-3 py-2">{t("Status")}</th>
              <th className="px-3 py-2">{t("Stripe ID")}</th>
              <th className="px-3 py-2">{t("Error")}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((row) => (
              <tr
                key={`${row.role}:${row.user_id}`}
                className="border-t border-white/10"
              >
                <td className="px-3 py-2">
                  {t(
                    row.role === "restaurant"
                      ? "Restaurant"
                      : row.role === "seller"
                        ? "Seller"
                        : "Driver",
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.display_name || row.user_id.slice(0, 8)}
                </td>
                <td className="px-3 py-2">{t(row.connect_status_label)}</td>
                <td className="px-3 py-2">
                  {row.eligible ? t("Yes") : t("No")}
                </td>
                <td className="max-w-[14rem] break-words px-3 py-2 text-amber-200">
                  {t(row.block_label)}
                </td>
                <td className="px-3 py-2">{cents(row.available_cents)}</td>
                <td className="px-3 py-2">{cents(row.pending_cents)}</td>
                <td className="px-3 py-2">
                  {row.last_payout_status
                    ? t(row.last_payout_status)
                    : "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.last_stripe_payout_id ?? "—"}
                </td>
                <td className="px-3 py-2 text-rose-300">
                  {row.last_payout_error ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {blocked.length === 0 && data && !loading ? (
        <p className="mt-4 text-slate-400">{t("No blocked beneficiaries in this view.")}</p>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "rose" | "amber";
}) {
  const color =
    tone === "rose"
      ? "text-rose-300"
      : tone === "amber"
        ? "text-amber-300"
        : "text-white";
  return (
    <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-black ${color}`}>{value}</div>
    </div>
  );
}
