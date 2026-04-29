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
      return "bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 backdrop-blur";
    case "partial":
      return "bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 backdrop-blur";
    case "failed":
      return "bg-red-500/10 text-red-600 ring-1 ring-red-500/20 backdrop-blur";
    case "data_mismatch":
      return "bg-rose-500/10 text-rose-600 ring-1 ring-rose-500/20 backdrop-blur";
    case "paid_no_payout":
      return "bg-blue-500/10 text-blue-600 ring-1 ring-blue-500/20 backdrop-blur";
    case "unpaid":
    default:
      return "bg-slate-200/60 text-slate-700 ring-1 ring-slate-300 backdrop-blur";
  }
}

function getPayoutBadgeClass(status: string | null) {
  switch (status) {
    case "succeeded":
      return "bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 backdrop-blur";
    case "failed":
      return "bg-red-500/10 text-red-600 ring-1 ring-red-500/20 backdrop-blur";
    case "pending":
      return "bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 backdrop-blur";
    default:
      return "bg-slate-200/60 text-slate-700 ring-1 ring-slate-300 backdrop-blur";
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

function getDisplayDashboardStatus(item: DashboardItem): DashboardStatus {
  const hasRestaurant = Boolean(item.restaurant_name);

  if (!hasRestaurant) {
    if (item.driver_paid_out) return "completed";
    if (item.payment_status === "paid") return "paid_no_payout";
    return "unpaid";
  }

  return item.dashboard_status;
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
      ? "bg-emerald-50 text-emerald-900 ring-emerald-100"
      : tone === "warning"
      ? "bg-amber-50 text-amber-900 ring-amber-100"
      : tone === "danger"
      ? "bg-red-50 text-red-900 ring-red-100"
      : "bg-white text-slate-900 ring-slate-200";

  const icon =
    tone === "success"
      ? "✓"
      : tone === "warning"
      ? "!"
      : tone === "danger"
      ? "×"
      : "•";

  return (
    <div
      className={`min-h-[132px] rounded-3xl p-6 shadow-sm ring-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="text-left">
          <div className="text-sm font-semibold text-slate-500">{title}</div>
          <div className="mt-3 text-4xl font-black tracking-tight">{value}</div>
        </div>

        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/80 text-lg font-black shadow-sm">
          {icon}
        </div>
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
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
        active
          ? "bg-slate-950 text-white shadow-sm"
          : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
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
  variant?: "primary" | "secondary" | "danger" | "blue";
  disabled?: boolean;
}) {
  const variantClass =
    variant === "primary"
      ? "bg-slate-950 text-white hover:bg-slate-800"
      : variant === "blue"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : variant === "danger"
      ? "bg-red-600 text-white hover:bg-red-700"
      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[54px] w-full items-center justify-center rounded-2xl px-5 text-sm font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${variantClass}`}
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
        dashboardFilter === "all" ||
        getDisplayDashboardStatus(item) === dashboardFilter;

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

      const response = await fetch(
        "/api/admin/process-payouts?force=true&limit=100",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

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
        (x) => getDisplayDashboardStatus(x) === "completed"
      ).length,
      partial: filteredItems.filter(
        (x) => getDisplayDashboardStatus(x) === "partial"
      ).length,
      failed: filteredItems.filter(
        (x) => getDisplayDashboardStatus(x) === "failed"
      ).length,
      unpaid: filteredItems.filter(
        (x) => getDisplayDashboardStatus(x) === "unpaid"
      ).length,
    };
  }, [filteredItems]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-white">
      <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-10 overflow-hidden rounded-[2rem] bg-slate-950 shadow-2xl ring-1 ring-slate-900">
          <div className="relative p-8 sm:p-10">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-transparent to-emerald-400/10 blur-2xl" />
            <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-blue-500/20 blur-3xl" />
            <div className="absolute bottom-0 left-1/2 h-40 w-40 rounded-full bg-emerald-400/10 blur-3xl" />

            <div className="relative flex flex-col gap-8">
              <div>
                <div className="inline-flex rounded-full bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-slate-300 ring-1 ring-white/10">
                  MMD Delivery · Finance Ops
                </div>

                <h1 className="mt-5 text-4xl font-black tracking-tight text-white sm:text-5xl">
                  Payout Operations
                </h1>

                <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                  Monitor, process, reconcile, and audit restaurant and driver
                  payouts from one premium finance control center.
                </p>
              </div>

              <div className="w-full rounded-3xl bg-white/10 p-4 ring-1 ring-white/10 backdrop-blur">
                <div className="mb-3 text-sm font-bold text-white">
                  Quick actions
                </div>

                <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Link
                    href="/admin/payouts/reconciliation"
                    className="inline-flex min-h-[54px] w-full items-center justify-center rounded-2xl bg-white px-5 text-sm font-bold text-slate-950 shadow-sm transition hover:bg-slate-100"
                  >
                    Reconciliation
                  </Link>

                  <Link
                    href="/admin/payouts/audit"
                    className="inline-flex min-h-[54px] w-full items-center justify-center rounded-2xl bg-white/10 px-5 text-sm font-bold text-white ring-1 ring-white/15 transition hover:bg-white/15"
                  >
                    Audit Logs
                  </Link>

                  <ActionButton label="Reset filters" onClick={resetFilters} />

                  <ActionButton
                    label="Export CSV"
                    onClick={exportCsv}
                    disabled={filteredItems.length === 0}
                  />

                  <button
                    type="button"
                    onClick={() => void runPayoutProcessor()}
                    disabled={processingPayouts || refreshing}
                    className="inline-flex min-h-[54px] w-full items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-bold text-white shadow-lg ring-1 ring-white/20 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {processingPayouts ? "Processing..." : "Run payouts"}
                  </button>

                  <ActionButton
                    label={refreshing ? "Refreshing..." : "Refresh"}
                    onClick={() => void loadPage("refresh")}
                    variant="blue"
                    disabled={refreshing}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {loading || !authChecked ? (
          <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
            <div className="text-sm font-medium text-slate-500">
              Loading payouts...
            </div>
          </div>
        ) : error ? (
          <div className="rounded-3xl bg-red-50 p-6 shadow-sm ring-1 ring-red-200">
            <div className="text-sm font-bold text-red-800">
              Failed to load admin payouts
            </div>
            <div className="mt-2 text-sm text-red-700">{error}</div>
          </div>
        ) : !isAdmin ? (
          <div className="rounded-3xl bg-amber-50 p-6 shadow-sm ring-1 ring-amber-200">
            <div className="text-sm font-bold text-amber-800">
              Access restricted
            </div>
            <div className="mt-2 text-sm text-amber-700">
              This page is reserved for administrators.
            </div>
          </div>
        ) : (
          <>
            <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
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

            <section className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

            <section className="mb-8 rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-black tracking-tight text-slate-950">
                    Filters
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Search by order, restaurant, or transfer ID.
                  </p>
                </div>

                <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">
                  {filteredSummary.total} result
                  {filteredSummary.total > 1 ? "s" : ""}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label
                    htmlFor="payout-search"
                    className="mb-2 block text-sm font-bold text-slate-700"
                  >
                    Search
                  </label>
                  <input
                    id="payout-search"
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Order ID, restaurant, transfer ID..."
                    className="h-13 w-full rounded-2xl bg-slate-50 px-4 py-4 text-sm font-medium text-slate-900 shadow-sm ring-1 ring-slate-200 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-400"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">
                    Payment status
                  </label>
                  <select
                    value={paymentFilter}
                    onChange={(e) =>
                      setPaymentFilter(e.target.value as PaymentFilter)
                    }
                    className="h-13 w-full rounded-2xl bg-slate-50 px-4 py-4 text-sm font-bold text-slate-900 shadow-sm ring-1 ring-slate-200 outline-none transition focus:bg-white focus:ring-2 focus:ring-slate-400"
                  >
                    <option value="all">All</option>
                    <option value="paid">Paid</option>
                    <option value="unpaid">Unpaid</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">
                    Sort
                  </label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="h-13 w-full rounded-2xl bg-slate-50 px-4 py-4 text-sm font-bold text-slate-900 shadow-sm ring-1 ring-slate-200 outline-none transition focus:bg-white focus:ring-2 focus:ring-slate-400"
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

              <div className="mt-5 flex flex-wrap gap-2">
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

              <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-slate-50 px-5 py-4 text-sm font-medium text-slate-600 ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  Showing{" "}
                  <span className="font-black text-slate-950">
                    {filteredSummary.total}
                  </span>{" "}
                  result{filteredSummary.total > 1 ? "s" : ""}
                </div>

                <div className="flex flex-wrap gap-4">
                  <span>
                    Paid:{" "}
                    <span className="font-black text-slate-950">
                      {filteredSummary.paid}
                    </span>
                  </span>
                  <span>
                    Completed:{" "}
                    <span className="font-black text-slate-950">
                      {filteredSummary.completed}
                    </span>
                  </span>
                  <span>
                    Partial:{" "}
                    <span className="font-black text-slate-950">
                      {filteredSummary.partial}
                    </span>
                  </span>
                  <span>
                    Failed:{" "}
                    <span className="font-black text-slate-950">
                      {filteredSummary.failed}
                    </span>
                  </span>
                  <span>
                    Unpaid:{" "}
                    <span className="font-black text-slate-950">
                      {filteredSummary.unpaid}
                    </span>
                  </span>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-[2rem] bg-white shadow-xl ring-1 ring-slate-200">
              <div className="border-b border-slate-200 px-6 py-5">
                <h2 className="text-xl font-black tracking-tight text-slate-950">
                  Orders and payouts
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Search, filter, sort, export and inspect payout health order by
                  order.
                </p>
              </div>

              <div className="w-full overflow-x-auto">
                <table className="w-full table-auto divide-y divide-slate-200 text-center text-sm">
                  <thead className="sticky top-0 z-10 bg-white shadow-sm">
                    <tr className="text-center text-xs uppercase tracking-[0.14em] text-slate-500">
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Order
                      </th>
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Created
                      </th>
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Last activity
                      </th>
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Restaurant
                      </th>
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Order status
                      </th>
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Payment
                      </th>
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Total
                      </th>
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Dashboard
                      </th>
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Restaurant payout
                      </th>
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Restaurant transfer
                      </th>
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Driver payout
                      </th>
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Driver transfer
                      </th>
                      <th className="whitespace-nowrap px-4 py-4 font-black">
                        Errors
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredItems.length === 0 ? (
                      <tr>
                        <td
                          colSpan={13}
                          className="px-4 py-14 text-center text-sm font-medium text-slate-500"
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
                            className="align-middle transition-all duration-200 hover:scale-[1.002] hover:bg-slate-50"
                          >
                            <td className="px-4 py-6 text-center align-middle">
                              <div className="break-words font-black text-slate-950">
                                {truncateMiddle(item.order_id, 10, 8)}
                              </div>
                              <div className="mt-2 flex flex-wrap justify-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => void copyText(item.order_id)}
                                  className="text-xs font-bold text-blue-600 hover:text-blue-800"
                                >
                                  {copied === item.order_id
                                    ? "Copied"
                                    : "Copy ID"}
                                </button>
                                <Link
                                  href={`/admin/payouts/${item.order_id}`}
                                  className="text-xs font-bold text-slate-600 hover:text-slate-950"
                                >
                                  Open order
                                </Link>
                              </div>
                            </td>

                            <td className="px-4 py-6 text-center align-middle text-slate-700">
                              {formatDate(item.created_at)}
                            </td>

                            <td className="px-4 py-6 text-center align-middle text-slate-700">
                              {formatDate(getLastActivity(item))}
                            </td>

                            <td className="px-4 py-6 text-center align-middle">
                              <div className="font-black text-slate-950">
                                {item.restaurant_name || "—"}
                              </div>
                              <div className="mt-1 text-xs font-medium text-slate-500">
                                Paid at: {formatDate(item.paid_at)}
                              </div>
                            </td>

                            <td className="px-4 py-6 text-center align-middle">
                              <div className="font-semibold text-slate-900">
                                {item.order_status}
                              </div>
                              <div className="mt-1 text-xs font-medium text-slate-500">
                                Delivered:{" "}
                                {formatDate(item.delivered_confirmed_at)}
                              </div>
                            </td>

                            <td className="px-4 py-6 text-center align-middle">
                              <span
                                className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-black ${
                                  item.payment_status === "paid"
                                    ? "bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 backdrop-blur"
                                    : "bg-slate-200/60 text-slate-700 ring-1 ring-slate-300 backdrop-blur"
                                }`}
                              >
                                {item.payment_status}
                              </span>
                            </td>

                            <td className="px-4 py-6 text-center align-middle font-black text-slate-950">
                              {formatMoney(item.total, item.currency || "USD")}
                            </td>

                            <td className="px-4 py-6 text-center align-middle">
                              <span
                                className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-black ${getStatusBadgeClass(
                                  getDisplayDashboardStatus(item)
                                )}`}
                              >
                                {labelForDashboardStatus(
                                  getDisplayDashboardStatus(item)
                                )}
                              </span>
                            </td>

                            <td className="px-4 py-6 text-center align-middle">
                              <span
                                className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-black ${getPayoutBadgeClass(
                                  item.restaurant_payout_status
                                )}`}
                              >
                                {!item.restaurant_name ? (
                                  <span className="inline-flex items-center gap-1">
                                    🚗 Driver only
                                  </span>
                                ) : (
                                  item.restaurant_payout_status || "pending"
                                )}
                              </span>
                              <div className="mt-2 font-bold text-slate-950">
                                {formatMoneyFromCents(
                                  item.restaurant_amount_cents,
                                  item.currency || "USD"
                                )}
                              </div>
                              <div className="mt-1 text-xs font-medium text-slate-500">
                                Paid out:{" "}
                                {item.restaurant_paid_out ? "true" : "false"}
                              </div>
                              <div className="mt-1 text-xs font-medium text-slate-500">
                                At: {formatDate(item.restaurant_succeeded_at)}
                              </div>
                            </td>

                            <td className="px-4 py-6 text-center align-middle">
                              <div
                                className="font-mono text-xs font-bold text-slate-900"
                                title={restaurantTransferId || ""}
                              >
                                {truncateMiddle(restaurantTransferId, 10, 8)}
                              </div>

                              <div className="mt-2 flex flex-wrap justify-center gap-3">
                                {restaurantTransferId && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void copyText(restaurantTransferId)
                                    }
                                    className="text-xs font-bold text-blue-600 hover:text-blue-800"
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
                                    className="text-xs font-bold text-slate-600 hover:text-slate-950"
                                  >
                                    Open Stripe
                                  </a>
                                )}
                              </div>
                            </td>

                            <td className="px-4 py-6 text-center align-middle">
                              <span
                                className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-black ${getPayoutBadgeClass(
                                  item.driver_payout_status || "pending"
                                )}`}
                              >
                                {item.driver_payout_status || "pending"}
                              </span>
                              <div className="mt-2 font-bold text-slate-950">
                                {formatMoneyFromCents(
                                  item.driver_amount_cents,
                                  item.currency || "USD"
                                )}
                              </div>
                              <div className="mt-1 text-xs font-medium text-slate-500">
                                Paid out:{" "}
                                {item.driver_paid_out ? "true" : "false"}
                              </div>
                              <div className="mt-1 text-xs font-medium text-slate-500">
                                At: {formatDate(item.driver_succeeded_at)}
                              </div>
                            </td>

                            <td className="px-4 py-6 text-center align-middle">
                              <div
                                className="font-mono text-xs font-bold text-slate-900"
                                title={driverTransferId || ""}
                              >
                                {truncateMiddle(driverTransferId, 10, 8)}
                              </div>

                              <div className="mt-2 flex flex-wrap justify-center gap-3">
                                {driverTransferId && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void copyText(driverTransferId)
                                    }
                                    className="text-xs font-bold text-blue-600 hover:text-blue-800"
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
                                    className="text-xs font-bold text-slate-600 hover:text-slate-950"
                                  >
                                    Open Stripe
                                  </a>
                                )}
                              </div>
                            </td>

                            <td className="px-4 py-6 text-center align-middle">
                              {hasError ? (
                                <div className="space-y-2 text-xs">
                                  {item.restaurant_failure_message && (
                                    <div className="rounded-xl bg-red-50 p-3 font-medium text-red-700 ring-1 ring-red-200">
                                      <span className="font-black">
                                        Restaurant:
                                      </span>{" "}
                                      {item.restaurant_failure_message}
                                    </div>
                                  )}

                                  {item.restaurant_last_error && (
                                    <div className="rounded-xl bg-red-50 p-3 font-medium text-red-700 ring-1 ring-red-200">
                                      <span className="font-black">
                                        Restaurant last error:
                                      </span>{" "}
                                      {item.restaurant_last_error}
                                    </div>
                                  )}

                                  {item.driver_failure_message && (
                                    <div className="rounded-xl bg-red-50 p-3 font-medium text-red-700 ring-1 ring-red-200">
                                      <span className="font-black">
                                        Driver:
                                      </span>{" "}
                                      {item.driver_failure_message}
                                    </div>
                                  )}

                                  {item.driver_last_error && (
                                    <div className="rounded-xl bg-red-50 p-3 font-medium text-red-700 ring-1 ring-red-200">
                                      <span className="font-black">
                                        Driver last error:
                                      </span>{" "}
                                      {item.driver_last_error}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="font-bold text-slate-300">
                                  —
                                </span>
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