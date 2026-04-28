"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { canAccessPayouts } from "@/lib/adminAccess";

type DashboardStatus =
  | "completed"
  | "partial"
  | "failed"
  | "unpaid"
  | "paid_no_payout"
  | "data_mismatch";

type DashboardItem = {
  order_id: string;
  created_at: string;
  order_status: string;
  payment_status: string;
  restaurant_name: string | null;
  currency: string | null;
  total: number | null;
  total_cents: number | null;
  paid_at: string | null;
  picked_up_at: string | null;
  delivered_confirmed_at: string | null;

  restaurant_paid_out: boolean;
  restaurant_paid_out_at: string | null;
  restaurant_transfer_id: string | null;

  driver_paid_out: boolean;
  driver_paid_out_at: string | null;
  driver_transfer_id: string | null;

  restaurant_payout_status: string | null;
  restaurant_amount_cents: number | null;
  restaurant_destination_account_id: string | null;
  restaurant_source_charge_id: string | null;
  restaurant_payout_transfer_id: string | null;
  restaurant_failure_code: string | null;
  restaurant_failure_message: string | null;
  restaurant_last_error: string | null;
  restaurant_succeeded_at: string | null;
  restaurant_failed_at: string | null;

  driver_payout_status: string | null;
  driver_amount_cents: number | null;
  driver_destination_account_id: string | null;
  driver_source_charge_id: string | null;
  driver_payout_transfer_id: string | null;
  driver_failure_code: string | null;
  driver_failure_message: string | null;
  driver_last_error: string | null;
  driver_succeeded_at: string | null;
  driver_failed_at: string | null;

  dashboard_status: DashboardStatus;
};

type Summary = {
  total_orders: number;
  paid_orders: number;
  restaurant_paid_out_orders: number;
  driver_paid_out_orders: number;
  orders_with_failed_payouts: number;
  completed_orders: number;
  partial_orders: number;
  unpaid_orders: number;
  mismatch_orders: number;
  paid_no_payout_orders: number;
};

type ApiResponse = {
  ok: boolean;
  items: DashboardItem[];
  summary: Summary;
  error?: string;
  processed?: number;
  skipped?: number;
  failed?: number;
  data?: {
    processed?: number;
    skipped?: number;
    failed?: number;
    error?: string;
  };
};

type DashboardFilter =
  | "all"
  | "completed"
  | "partial"
  | "failed"
  | "unpaid"
  | "paid_no_payout"
  | "data_mismatch";

type PaymentFilter = "all" | "paid" | "unpaid";

type SortOption =
  | "newest"
  | "oldest"
  | "amount_desc"
  | "amount_asc"
  | "restaurant_asc"
  | "restaurant_desc";

function getTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatMoney(value: number | null | undefined, currency = "USD") {
  if (value == null) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value);
}

function formatMoneyFromCents(
  cents: number | null | undefined,
  currency = "USD"
) {
  if (cents == null) return "—";
  return formatMoney(cents / 100, currency);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function truncateMiddle(
  value: string | null | undefined,
  start = 8,
  end = 6
) {
  if (!value) return "—";
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function getStatusBadgeClass(status: DashboardStatus) {
  switch (status) {
    case "completed":
      return "border-green-200 bg-green-100 text-green-800";
    case "partial":
      return "border-amber-200 bg-amber-100 text-amber-800";
    case "failed":
      return "border-red-200 bg-red-100 text-red-800";
    case "data_mismatch":
      return "border-rose-200 bg-rose-100 text-rose-800";
    case "paid_no_payout":
      return "border-blue-200 bg-blue-100 text-blue-800";
    case "unpaid":
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getPayoutBadgeClass(status: string | null) {
  switch (status) {
    case "succeeded":
      return "border-green-200 bg-green-100 text-green-800";
    case "failed":
      return "border-red-200 bg-red-100 text-red-800";
    case "pending":
      return "border-amber-200 bg-amber-100 text-amber-800";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function labelForDashboardStatus(status: DashboardStatus) {
  switch (status) {
    case "completed":
      return "Completed";
    case "partial":
      return "Partial";
    case "failed":
      return "Failed";
    case "data_mismatch":
      return "Data mismatch";
    case "paid_no_payout":
      return "Paid / no payout";
    case "unpaid":
    default:
      return "Unpaid";
  }
}

function getLastActivity(item: DashboardItem): string | null {
  const candidates = [
    item.driver_succeeded_at,
    item.restaurant_succeeded_at,
    item.driver_failed_at,
    item.restaurant_failed_at,
    item.driver_paid_out_at,
    item.restaurant_paid_out_at,
    item.delivered_confirmed_at,
    item.picked_up_at,
    item.paid_at,
    item.created_at,
  ].filter(Boolean) as string[];

  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => getTimestamp(b) - getTimestamp(a))[0];
}

function dashboardFilterLabel(value: DashboardFilter) {
  switch (value) {
    case "all":
      return "All";
    case "completed":
      return "Completed";
    case "partial":
      return "Partial";
    case "failed":
      return "Failed";
    case "unpaid":
      return "Unpaid";
    case "paid_no_payout":
      return "Paid / no payout";
    case "data_mismatch":
      return "Data mismatch";
    default:
      return value;
  }
}

function buildStripeTransferUrl(transferId: string | null | undefined) {
  if (!transferId) return null;
  return `https://dashboard.stripe.com/transfers/${transferId}`;
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

function escapeCsv(value: unknown) {
  const str = value == null ? "" : String(value);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

function toCsv(items: DashboardItem[]) {
  const headers = [
    "order_id",
    "created_at",
    "last_activity",
    "restaurant_name",
    "order_status",
    "payment_status",
    "dashboard_status",
    "currency",
    "total",
    "total_cents",
    "restaurant_paid_out",
    "restaurant_payout_status",
    "restaurant_amount_cents",
    "restaurant_transfer_id",
    "driver_paid_out",
    "driver_payout_status",
    "driver_amount_cents",
    "driver_transfer_id",
    "paid_at",
    "picked_up_at",
    "delivered_confirmed_at",
    "restaurant_succeeded_at",
    "driver_succeeded_at",
    "restaurant_failed_at",
    "driver_failed_at",
    "restaurant_failure_message",
    "driver_failure_message",
  ];

  const rows = items.map((item) => [
    item.order_id,
    item.created_at,
    getLastActivity(item),
    item.restaurant_name,
    item.order_status,
    item.payment_status,
    item.dashboard_status,
    item.currency,
    item.total,
    item.total_cents,
    item.restaurant_paid_out,
    item.restaurant_payout_status,
    item.restaurant_amount_cents,
    item.restaurant_payout_transfer_id || item.restaurant_transfer_id,
    item.driver_paid_out,
    item.driver_payout_status,
    item.driver_amount_cents,
    item.driver_payout_transfer_id || item.driver_transfer_id,
    item.paid_at,
    item.picked_up_at,
    item.delivered_confirmed_at,
    item.restaurant_succeeded_at,
    item.driver_succeeded_at,
    item.restaurant_failed_at,
    item.driver_failed_at,
    item.restaurant_failure_message || item.restaurant_last_error,
    item.driver_failure_message || item.driver_last_error,
  ]);

  return [
    "\ufeff" + headers.map(escapeCsv).join(","),
    ...rows.map((row) => row.map(escapeCsv).join(",")),
  ].join("\n");
}

async function getRequiredSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    throw new Error(error.message);
  }

  if (session?.user && session.access_token) {
    return session;
  }

  const {
    data: { session: refreshedSession },
    error: refreshError,
  } = await supabase.auth.refreshSession();

  if (refreshError) {
    throw new Error(refreshError.message);
  }

  if (!refreshedSession?.user || !refreshedSession.access_token) {
    throw new Error("User not logged in");
  }

  return refreshedSession;
}

async function getRequiredAccessToken(): Promise<string> {
  const session = await getRequiredSession();
  return session.access_token;
}

function StatCard({
  title,
  value,
  tone = "default",
}: {
  title: string;
  value: number;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "border-green-200 bg-green-50"
      : tone === "warning"
      ? "border-amber-200 bg-amber-50"
      : tone === "danger"
      ? "border-red-200 bg-red-50"
      : "border-slate-200 bg-white";

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${toneClass}`}>
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </div>
    </div>
  );
}

function FilterPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );
}

function ActionButton({
  label,
  onClick,
  variant = "secondary",
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const variantClass =
    variant === "primary"
      ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
      : variant === "danger"
      ? "border-red-700 bg-red-700 text-white hover:bg-red-800"
      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-11 w-full items-center justify-center rounded-xl border px-4 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto ${variantClass}`}
    >
      {label}
    </button>
  );
}

export default function AdminPayoutsPage() {
  const router = useRouter();
  const copyTimeoutRef = useRef<number | null>(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [processingPayouts, setProcessingPayouts] = useState(false);

  const [search, setSearch] = useState("");
  const [dashboardFilter, setDashboardFilter] =
    useState<DashboardFilter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("newest");

  const loadPage = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      try {
        if (mode === "initial") {
          setLoading(true);
        } else {
          setRefreshing(true);
        }

        setError(null);

        const session = await getRequiredSession();
        const user = session.user;
        const accessToken = session.access_token;

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, role")
          .eq("id", user.id)
          .maybeSingle();

        if (profileError) {
          throw new Error(profileError.message);
        }

        if (!profile || !canAccessPayouts(profile.role)) {
          setIsAdmin(false);
          setAuthChecked(true);
          setError("Access restricted to administrators.");
          return;
        }

        setIsAdmin(true);
        setAuthChecked(true);

        const response = await fetch("/api/admin/payouts", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const json = (await response.json()) as ApiResponse;

        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Failed to load admin payouts");
        }

        setData(json);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";

        if (message === "User not logged in") {
          setIsAdmin(false);
          setAuthChecked(true);
          router.push("/auth/login");
          return;
        }

        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  useEffect(() => {
    void loadPage("initial");

    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, [loadPage]);

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);

      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }

      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(null);
      }, 1200);
    } catch {
      // ignore
    }
  }

  function resetFilters() {
    setSearch("");
    setDashboardFilter("all");
    setPaymentFilter("all");
    setSortBy("newest");
  }

  const items = useMemo(() => data?.items ?? [], [data]);
  const summary = data?.summary;

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();

    const result = items.filter((item) => {
      const matchesSearch =
        q.length === 0 ||
        item.order_id.toLowerCase().includes(q) ||
        (item.restaurant_name ?? "").toLowerCase().includes(q) ||
        (item.restaurant_transfer_id ?? "").toLowerCase().includes(q) ||
        (item.driver_transfer_id ?? "").toLowerCase().includes(q) ||
        (item.restaurant_payout_transfer_id ?? "").toLowerCase().includes(q) ||
        (item.driver_payout_transfer_id ?? "").toLowerCase().includes(q);

      const matchesDashboard =
        dashboardFilter === "all" || item.dashboard_status === dashboardFilter;

      const matchesPayment =
        paymentFilter === "all" || item.payment_status === paymentFilter;

      return matchesSearch && matchesDashboard && matchesPayment;
    });

    return [...result].sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return getTimestamp(a.created_at) - getTimestamp(b.created_at);
        case "amount_desc":
          return (b.total ?? 0) - (a.total ?? 0);
        case "amount_asc":
          return (a.total ?? 0) - (b.total ?? 0);
        case "restaurant_asc":
          return (a.restaurant_name ?? "").localeCompare(
            b.restaurant_name ?? ""
          );
        case "restaurant_desc":
          return (b.restaurant_name ?? "").localeCompare(
            a.restaurant_name ?? ""
          );
        case "newest":
        default:
          return getTimestamp(b.created_at) - getTimestamp(a.created_at);
      }
    });
  }, [items, search, dashboardFilter, paymentFilter, sortBy]);

  async function runPayoutProcessor() {
    try {
      setProcessingPayouts(true);

      const accessToken = await getRequiredAccessToken();

      const response = await fetch("/api/admin/process-payouts", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const json = (await response.json()) as ApiResponse;

      if (!response.ok || !json.ok) {
        throw new Error(
          json.error || json.data?.error || "Failed to process payouts"
        );
      }

      const processed = json.processed ?? json.data?.processed ?? 0;
      const skipped = json.skipped ?? json.data?.skipped ?? 0;
      const failed = json.failed ?? json.data?.failed ?? 0;

      alert(
        `Payouts processed: ${processed}\nSkipped: ${skipped}\nFailed: ${failed}`
      );

      await loadPage("refresh");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to process payouts");
    } finally {
      setProcessingPayouts(false);
    }
  }

  function exportCsv() {
    const csv = toCsv(filteredItems);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

    downloadTextFile(
      `admin-payouts-${stamp}.csv`,
      csv,
      "text/csv;charset=utf-8;"
    );
  }

  const filteredSummary = useMemo(() => {
    return {
      total: filteredItems.length,
      paid: filteredItems.filter((x) => x.payment_status === "paid").length,
      completed: filteredItems.filter(
        (x) => x.dashboard_status === "completed"
      ).length,
      partial: filteredItems.filter((x) => x.dashboard_status === "partial")
        .length,
      failed: filteredItems.filter((x) => x.dashboard_status === "failed")
        .length,
      unpaid: filteredItems.filter((x) => x.dashboard_status === "unpaid")
        .length,
    };
  }, [filteredItems]);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-5">
            <div>
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                MMD Delivery · Admin Finance Ops
              </div>

              <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Admin Payouts Dashboard
              </h1>

              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Paid orders, restaurant payouts, driver payouts, Stripe transfer
                IDs, payout health, filtering, export and quick operations in
                one place.
              </p>
            </div>

            <div className="w-full rounded-2xl border border-slate-100 bg-white/70 p-5 flex flex-col justify-center">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-semibold text-slate-900">
                  Quick actions
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Link href="/admin/payouts/reconciliation" className="inline-flex min-h-[54px] w-full items-center justify-center rounded-xl border-2 border-slate-300 bg-white px-4 text-base font-bold text-slate-700 shadow-sm transition hover:bg-slate-100">
                    Reconciliation
                  </Link>

                  <Link href="/admin/payouts/audit" className="inline-flex min-h-[54px] w-full items-center justify-center rounded-xl border-2 border-slate-300 bg-white px-4 text-base font-bold text-slate-700 shadow-sm transition hover:bg-slate-100">
                    Audit Logs
                  </Link>

                  <button type="button" onClick={resetFilters} style={{ minHeight: "54px", width: "100%", borderRadius: "12px", backgroundColor: "#ffffff", color: "#334155", border: "2px solid #cbd5e1", fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
                    Reset filters
                  </button>

                  <button type="button" onClick={exportCsv} disabled={filteredItems.length === 0} style={{ minHeight: "54px", width: "100%", borderRadius: "12px", backgroundColor: "#ffffff", color: "#334155", border: "2px solid #cbd5e1", fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", opacity: filteredItems.length === 0 ? 0.6 : 1 }}>
                    Export CSV
                  </button>

                  <button type="button" onClick={() => void runPayoutProcessor()} disabled={processingPayouts || refreshing} style={{ minHeight: "54px", width: "100%", borderRadius: "12px", backgroundColor: "#111827", color: "#ffffff", border: "2px solid #000000", fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.12)", opacity: processingPayouts || refreshing ? 0.6 : 1 }}>
                    {processingPayouts ? "Processing..." : "Run payouts"}
                  </button>

                  <button type="button" onClick={() => void loadPage("refresh")} disabled={refreshing} style={{ minHeight: "54px", width: "100%", borderRadius: "12px", backgroundColor: "#2563eb", color: "#ffffff", border: "2px solid #1e3a8a", fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.12)", opacity: refreshing ? 0.6 : 1 }}>
                    {refreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {loading || !authChecked ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-sm text-slate-500">Loading payouts...</div>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
            <div className="text-sm font-medium text-red-800">
              Failed to load admin payouts
            </div>
            <div className="mt-2 text-sm text-red-700">{error}</div>
          </div>
        ) : !isAdmin ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <div className="text-sm font-medium text-amber-800">
              Access restricted
            </div>
            <div className="mt-2 text-sm text-amber-700">
              This page is reserved for administrators.
            </div>
          </div>
        ) : (
          <>
            <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard title="Total orders" value={summary?.total_orders ?? 0} />
              <StatCard
                title="Paid orders"
                value={summary?.paid_orders ?? 0}
                tone="success"
              />
              <StatCard
                title="Completed payouts"
                value={summary?.completed_orders ?? 0}
                tone="success"
              />
              <StatCard
                title="Partial payouts"
                value={summary?.partial_orders ?? 0}
                tone="warning"
              />
              <StatCard
                title="Failed payouts"
                value={summary?.orders_with_failed_payouts ?? 0}
                tone="danger"
              />
            </section>

            <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Restaurant paid out"
                value={summary?.restaurant_paid_out_orders ?? 0}
              />
              <StatCard
                title="Driver paid out"
                value={summary?.driver_paid_out_orders ?? 0}
              />
              <StatCard
                title="Unpaid"
                value={summary?.unpaid_orders ?? 0}
                tone="warning"
              />
              <StatCard
                title="Data mismatch"
                value={summary?.mismatch_orders ?? 0}
                tone="danger"
              />
            </section>

            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <label
                    htmlFor="payout-search"
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    Search
                  </label>
                  <input
                    id="payout-search"
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by order ID, restaurant name, or transfer ID..."
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Payment status
                  </label>
                  <select
                    value={paymentFilter}
                    onChange={(e) =>
                      setPaymentFilter(e.target.value as PaymentFilter)
                    }
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="all">All</option>
                    <option value="paid">Paid</option>
                    <option value="unpaid">Unpaid</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Sort
                  </label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="amount_desc">Amount high to low</option>
                    <option value="amount_asc">Amount low to high</option>
                    <option value="restaurant_asc">Restaurant A → Z</option>
                    <option value="restaurant_desc">Restaurant Z → A</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(
                  [
                    "all",
                    "completed",
                    "partial",
                    "failed",
                    "unpaid",
                    "paid_no_payout",
                    "data_mismatch",
                  ] as DashboardFilter[]
                ).map((value) => (
                  <FilterPill
                    key={value}
                    active={dashboardFilter === value}
                    label={dashboardFilterLabel(value)}
                    onClick={() => setDashboardFilter(value)}
                  />
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  Showing{" "}
                  <span className="font-semibold text-slate-900">
                    {filteredSummary.total}
                  </span>{" "}
                  result{filteredSummary.total > 1 ? "s" : ""}
                </div>

                <div className="flex flex-wrap gap-4">
                  <span>
                    Paid:{" "}
                    <span className="font-semibold text-slate-900">
                      {filteredSummary.paid}
                    </span>
                  </span>
                  <span>
                    Completed:{" "}
                    <span className="font-semibold text-slate-900">
                      {filteredSummary.completed}
                    </span>
                  </span>
                  <span>
                    Partial:{" "}
                    <span className="font-semibold text-slate-900">
                      {filteredSummary.partial}
                    </span>
                  </span>
                  <span>
                    Failed:{" "}
                    <span className="font-semibold text-slate-900">
                      {filteredSummary.failed}
                    </span>
                  </span>
                  <span>
                    Unpaid:{" "}
                    <span className="font-semibold text-slate-900">
                      {filteredSummary.unpaid}
                    </span>
                  </span>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Orders and payouts
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Search, filter, sort, export and inspect payout health order by
                  order.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[1780px] divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 font-medium">Order</th>
                      <th className="px-4 py-3 font-medium">Created</th>
                      <th className="px-4 py-3 font-medium">Last activity</th>
                      <th className="px-4 py-3 font-medium">Restaurant</th>
                      <th className="px-4 py-3 font-medium">Order status</th>
                      <th className="px-4 py-3 font-medium">Payment</th>
                      <th className="px-4 py-3 font-medium">Total</th>
                      <th className="px-4 py-3 font-medium">Dashboard</th>
                      <th className="px-4 py-3 font-medium">
                        Restaurant payout
                      </th>
                      <th className="px-4 py-3 font-medium">
                        Restaurant transfer
                      </th>
                      <th className="px-4 py-3 font-medium">Driver payout</th>
                      <th className="px-4 py-3 font-medium">Driver transfer</th>
                      <th className="px-4 py-3 font-medium">Errors</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200 bg-white">
                    {filteredItems.length === 0 ? (
                      <tr>
                        <td
                          colSpan={13}
                          className="px-4 py-12 text-center text-sm text-slate-500"
                        >
                          No results match the current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredItems.map((item) => {
                        const hasError =
                          !!item.restaurant_failure_message ||
                          !!item.restaurant_last_error ||
                          !!item.driver_failure_message ||
                          !!item.driver_last_error;

                        const restaurantTransferId =
                          item.restaurant_payout_transfer_id ||
                          item.restaurant_transfer_id;

                        const driverTransferId =
                          item.driver_payout_transfer_id ||
                          item.driver_transfer_id;

                        const restaurantStripeUrl =
                          buildStripeTransferUrl(restaurantTransferId);
                        const driverStripeUrl =
                          buildStripeTransferUrl(driverTransferId);

                        return (
                          <tr
                            key={item.order_id}
                            className="align-top transition hover:bg-slate-50"
                          >
                            <td className="px-4 py-4">
                              <div className="font-medium text-slate-900">
                                {truncateMiddle(item.order_id, 10, 8)}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-3">
                                <button
                                  type="button"
                                  onClick={() => void copyText(item.order_id)}
                                  className="text-xs font-medium text-blue-600 hover:text-blue-800"
                                >
                                  {copied === item.order_id ? "Copied" : "Copy ID"}
                                </button>
                                <Link
                                  href={`/admin/payouts/${item.order_id}`}
                                  className="text-xs font-medium text-slate-700 hover:text-slate-900"
                                >
                                  Open order
                                </Link>
                              </div>
                            </td>

                            <td className="px-4 py-4 text-slate-700">
                              {formatDate(item.created_at)}
                            </td>

                            <td className="px-4 py-4 text-slate-700">
                              {formatDate(getLastActivity(item))}
                            </td>

                            <td className="px-4 py-4">
                              <div className="font-medium text-slate-900">
                                {item.restaurant_name || "—"}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Paid at: {formatDate(item.paid_at)}
                              </div>
                            </td>

                            <td className="px-4 py-4">
                              <div className="text-slate-900">
                                {item.order_status}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Delivered:{" "}
                                {formatDate(item.delivered_confirmed_at)}
                              </div>
                            </td>

                            <td className="px-4 py-4">
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                                  item.payment_status === "paid"
                                    ? "border-green-200 bg-green-100 text-green-800"
                                    : "border-slate-200 bg-slate-100 text-slate-700"
                                }`}
                              >
                                {item.payment_status}
                              </span>
                            </td>

                            <td className="px-4 py-4 text-slate-900">
                              {formatMoney(item.total, item.currency || "USD")}
                            </td>

                            <td className="px-4 py-4">
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(
                                  item.dashboard_status
                                )}`}
                              >
                                {labelForDashboardStatus(item.dashboard_status)}
                              </span>
                            </td>

                            <td className="px-4 py-4">
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getPayoutBadgeClass(
                                  item.restaurant_payout_status
                                )}`}
                              >
                                {item.restaurant_payout_status || "none"}
                              </span>
                              <div className="mt-2 text-slate-900">
                                {formatMoneyFromCents(
                                  item.restaurant_amount_cents,
                                  item.currency || "USD"
                                )}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Paid out:{" "}
                                {item.restaurant_paid_out ? "true" : "false"}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                At: {formatDate(item.restaurant_succeeded_at)}
                              </div>
                            </td>

                            <td className="px-4 py-4">
                              <div
                                className="font-mono text-xs text-slate-900"
                                title={restaurantTransferId || ""}
                              >
                                {truncateMiddle(restaurantTransferId, 10, 8)}
                              </div>

                              <div className="mt-2 flex flex-wrap gap-3">
                                {restaurantTransferId && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void copyText(restaurantTransferId)
                                    }
                                    className="text-xs font-medium text-blue-600 hover:text-blue-800"
                                  >
                                    {copied === restaurantTransferId
                                      ? "Copied"
                                      : "Copy transfer"}
                                  </button>
                                )}

                                {restaurantStripeUrl && (
                                  <a
                                    href={restaurantStripeUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs font-medium text-slate-700 hover:text-slate-900"
                                  >
                                    Open Stripe
                                  </a>
                                )}
                              </div>
                            </td>

                            <td className="px-4 py-4">
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getPayoutBadgeClass(
                                  item.driver_payout_status
                                )}`}
                              >
                                {item.driver_payout_status || "none"}
                              </span>
                              <div className="mt-2 text-slate-900">
                                {formatMoneyFromCents(
                                  item.driver_amount_cents,
                                  item.currency || "USD"
                                )}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Paid out: {item.driver_paid_out ? "true" : "false"}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                At: {formatDate(item.driver_succeeded_at)}
                              </div>
                            </td>

                            <td className="px-4 py-4">
                              <div
                                className="font-mono text-xs text-slate-900"
                                title={driverTransferId || ""}
                              >
                                {truncateMiddle(driverTransferId, 10, 8)}
                              </div>

                              <div className="mt-2 flex flex-wrap gap-3">
                                {driverTransferId && (
                                  <button
                                    type="button"
                                    onClick={() => void copyText(driverTransferId)}
                                    className="text-xs font-medium text-blue-600 hover:text-blue-800"
                                  >
                                    {copied === driverTransferId
                                      ? "Copied"
                                      : "Copy transfer"}
                                  </button>
                                )}

                                {driverStripeUrl && (
                                  <a
                                    href={driverStripeUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs font-medium text-slate-700 hover:text-slate-900"
                                  >
                                    Open Stripe
                                  </a>
                                )}
                              </div>
                            </td>

                            <td className="px-4 py-4">
                              {hasError ? (
                                <div className="space-y-2 text-xs">
                                  {item.restaurant_failure_message && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">
                                      <span className="font-semibold">
                                        Restaurant:
                                      </span>{" "}
                                      {item.restaurant_failure_message}
                                    </div>
                                  )}

                                  {item.restaurant_last_error && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">
                                      <span className="font-semibold">
                                        Restaurant last error:
                                      </span>{" "}
                                      {item.restaurant_last_error}
                                    </div>
                                  )}

                                  {item.driver_failure_message && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">
                                      <span className="font-semibold">
                                        Driver:
                                      </span>{" "}
                                      {item.driver_failure_message}
                                    </div>
                                  )}

                                  {item.driver_last_error && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">
                                      <span className="font-semibold">
                                        Driver last error:
                                      </span>{" "}
                                      {item.driver_last_error}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}