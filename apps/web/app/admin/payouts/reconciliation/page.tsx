"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { canAccessAuditLogs } from "@/lib/adminAccess";

type Severity = "high" | "medium" | "low";

type AnomalyKind =
  | "paid_without_any_payout_rows"
  | "paid_without_restaurant_payout"
  | "paid_without_driver_payout"
  | "restaurant_failed"
  | "driver_failed"
  | "partial_payout"
  | "restaurant_paid_flag_missing_transfer"
  | "driver_paid_flag_missing_transfer"
  | "restaurant_succeeded_missing_order_sync"
  | "driver_succeeded_missing_order_sync"
  | "order_transfer_missing_but_payout_has_transfer"
  | "payout_row_transfer_missing"
  | "duplicate_target_rows";

type Item = {
  anomaly_id: string;
  anomaly_kind: AnomalyKind;
  severity: Severity;
  title: string;
  description: string;

  order_id: string;
  created_at: string;
  restaurant_name: string | null;
  order_status: string;
  payment_status: string;
  dashboard_status: string;
  currency: string | null;
  total: number | null;
  total_cents: number | null;

  restaurant_paid_out: boolean;
  restaurant_transfer_id: string | null;
  restaurant_payout_status: string | null;
  restaurant_payout_transfer_id: string | null;

  driver_paid_out: boolean;
  driver_transfer_id: string | null;
  driver_payout_status: string | null;
  driver_payout_transfer_id: string | null;

  restaurant_failure_message: string | null;
  driver_failure_message: string | null;

  review_status: "open" | "reviewed" | "resolved";
  review_is_reviewed: boolean;
  review_is_resolved: boolean;
  review_admin_note: string | null;
  review_actor: string | null;
  review_updated_at: string | null;

  last_activity: string | null;
};

type Summary = {
  total_orders_scanned: number;
  total_anomalies: number;
  high_severity: number;
  medium_severity: number;
  low_severity: number;
  paid_without_any_payout_rows: number;
  payout_failed: number;
  partial_payout: number;
  transfer_missing: number;
  duplicates: number;
};

type ApiResponse = {
  ok: boolean;
  items: Item[];
  summary: Summary;
  error?: string;
};

type SeverityFilter = "all" | Severity;
type ReviewFilter = "all" | "open" | "reviewed" | "resolved";
type BulkAction = "review" | "resolve" | "reopen";

function formatMoney(value: number | null | undefined, currency = "USD") {
  if (value == null) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value);
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
  start = 10,
  end = 8
) {
  if (!value) return "—";
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function severityClass(severity: Severity) {
  switch (severity) {
    case "high":
      return "border-red-200 bg-red-100 text-red-800";
    case "medium":
      return "border-amber-200 bg-amber-100 text-amber-800";
    case "low":
    default:
      return "border-blue-200 bg-blue-100 text-blue-800";
  }
}

function dashboardBadgeClass(status: string) {
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

function payoutBadgeClass(status: string | null) {
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

function reviewBadgeClass(status: "open" | "reviewed" | "resolved") {
  switch (status) {
    case "resolved":
      return "border-green-200 bg-green-100 text-green-800";
    case "reviewed":
      return "border-blue-200 bg-blue-100 text-blue-800";
    case "open":
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function reviewFilterLabel(value: ReviewFilter) {
  switch (value) {
    case "open":
      return "Open";
    case "reviewed":
      return "Reviewed";
    case "resolved":
      return "Resolved";
    case "all":
    default:
      return "All";
  }
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

export default function AdminPayoutsReconciliationPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("open");
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState<BulkAction | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadPage = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      try {
        if (mode === "initial") {
          setLoading(true);
        } else {
          setRefreshing(true);
        }

        setError(null);

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw new Error(userError.message);
        }

        if (!user) {
          setIsAdmin(false);
          setAuthChecked(true);
          router.push("/auth/login");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, role")
          .eq("id", user.id)
          .maybeSingle();

        if (profileError) {
          throw new Error(profileError.message);
        }

        if (!profile || !canAccessAuditLogs(profile.role)) {
          setIsAdmin(false);
          setAuthChecked(true);
          setError("Access restricted to administrators.");
          return;
        }

        setIsAdmin(true);
        setAuthChecked(true);

        const response = await fetch("/api/admin/payouts/reconciliation", {
          method: "GET",
          cache: "no-store",
        });

        const json = (await response.json()) as ApiResponse;

        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Failed to load reconciliation data");
        }

        setData(json);

        const initialDrafts: Record<string, string> = {};
        for (const item of json.items ?? []) {
          const key = `${item.order_id}:${item.anomaly_kind}`;
          initialDrafts[key] = noteDrafts[key] ?? item.review_admin_note ?? "";
        }
        setNoteDrafts(initialDrafts);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router, noteDrafts]
  );

  useEffect(() => {
    void loadPage("initial");
  }, [loadPage]);

  async function retryFailedPayout(
    orderId: string,
    target: "restaurant" | "driver"
  ) {
    try {
      const ok = window.confirm(
        `Retry failed payout for ${target} on order ${orderId} ?`
      );
      if (!ok) return;

      setActionMessage(null);
      setRetryingKey(`${orderId}:${target}`);

      const response = await fetch("/api/admin/payouts/retry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderId, target }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Failed to retry ${target} payout`);
      }

      setActionMessage(json.message || `Retry succeeded for ${target}.`);
      await loadPage("refresh");
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : "Unknown retry error"
      );
    } finally {
      setRetryingKey(null);
    }
  }

  async function saveCaseReview(
    item: Item,
    patch: {
      isReviewed?: boolean;
      isResolved?: boolean;
      adminNote?: string;
    }
  ) {
    const key = `${item.order_id}:${item.anomaly_kind}`;

    try {
      setActionMessage(null);
      setSavingKey(key);

      const response = await fetch("/api/admin/payouts/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId: item.order_id,
          anomalyKind: item.anomaly_kind,
          isReviewed: patch.isReviewed ?? item.review_is_reviewed,
          isResolved: patch.isResolved ?? item.review_is_resolved,
          adminNote:
            patch.adminNote ?? noteDrafts[key] ?? item.review_admin_note ?? "",
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to save case review");
      }

      setActionMessage("Case review saved.");
      await loadPage("refresh");
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : "Unknown save error"
      );
    } finally {
      setSavingKey(null);
    }
  }

  const items = useMemo(() => data?.items ?? [], [data]);
  const summary = data?.summary;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return items.filter((item) => {
      const matchesSearch =
        q.length === 0 ||
        item.order_id.toLowerCase().includes(q) ||
        (item.restaurant_name ?? "").toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        (item.restaurant_transfer_id ?? "").toLowerCase().includes(q) ||
        (item.driver_transfer_id ?? "").toLowerCase().includes(q) ||
        (item.restaurant_payout_transfer_id ?? "").toLowerCase().includes(q) ||
        (item.driver_payout_transfer_id ?? "").toLowerCase().includes(q) ||
        (item.review_admin_note ?? "").toLowerCase().includes(q) ||
        (item.review_actor ?? "").toLowerCase().includes(q) ||
        item.review_status.toLowerCase().includes(q);

      const matchesSeverity = severity === "all" || item.severity === severity;
      const matchesReview =
        reviewFilter === "all" || item.review_status === reviewFilter;

      return matchesSearch && matchesSeverity && matchesReview;
    });
  }, [items, search, severity, reviewFilter]);

  const filteredSummary = useMemo(() => {
    return {
      total: filtered.length,
      open: filtered.filter((item) => item.review_status === "open").length,
      reviewed: filtered.filter((item) => item.review_status === "reviewed")
        .length,
      resolved: filtered.filter((item) => item.review_status === "resolved")
        .length,
    };
  }, [filtered]);

  async function applyBulkAction(action: BulkAction) {
    try {
      if (filtered.length === 0) {
        setActionMessage("No filtered anomalies to update.");
        return;
      }

      const ok = window.confirm(
        `Apply '${action}' to ${filtered.length} filtered anomaly row(s) ?`
      );
      if (!ok) return;

      setActionMessage(null);
      setBulkSaving(action);

      const response = await fetch("/api/admin/payouts/reviews/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          items: filtered.map((item) => ({
            orderId: item.order_id,
            anomalyKind: item.anomaly_kind,
          })),
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Failed to apply bulk action '${action}'`);
      }

      setActionMessage(json.message || `Bulk action '${action}' applied.`);
      await loadPage("refresh");
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : "Unknown bulk action error"
      );
    } finally {
      setBulkSaving(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-[1820px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              MMD Delivery · Finance Ops · Reconciliation
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
              Reconciliation / Anomaly Center
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Monitor paid orders without payouts, failed payouts, partial
              payouts, sync mismatches, missing transfers and other finance
              anomalies.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/payouts"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              Back to payouts
            </Link>
            <button
              type="button"
              onClick={() => void loadPage("refresh")}
              disabled={refreshing}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {loading || !authChecked ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-sm text-slate-500">
              Loading reconciliation data...
            </div>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
            <div className="text-sm font-medium text-red-800">
              Failed to load reconciliation data
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
              <StatCard
                title="Orders scanned"
                value={summary?.total_orders_scanned ?? 0}
              />
              <StatCard
                title="Total anomalies"
                value={summary?.total_anomalies ?? 0}
                tone="danger"
              />
              <StatCard
                title="High severity"
                value={summary?.high_severity ?? 0}
                tone="danger"
              />
              <StatCard
                title="Payout failed"
                value={summary?.payout_failed ?? 0}
                tone="danger"
              />
              <StatCard
                title="Partial payout"
                value={summary?.partial_payout ?? 0}
                tone="warning"
              />
            </section>

            <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Paid / no payout rows"
                value={summary?.paid_without_any_payout_rows ?? 0}
                tone="danger"
              />
              <StatCard
                title="Transfer missing"
                value={summary?.transfer_missing ?? 0}
                tone="warning"
              />
              <StatCard
                title="Duplicate payout rows"
                value={summary?.duplicates ?? 0}
              />
              <StatCard
                title="Medium severity"
                value={summary?.medium_severity ?? 0}
              />
            </section>

            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_260px]">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Search
                  </label>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by order ID, restaurant, transfer ID, title, description or review note..."
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Severity
                  </label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as SeverityFilter)}
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="all">All</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(["all", "open", "reviewed", "resolved"] as ReviewFilter[]).map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setReviewFilter(value)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                        reviewFilter === value
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {reviewFilterLabel(value)}
                    </button>
                  )
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void applyBulkAction("review")}
                  disabled={filtered.length === 0 || bulkSaving !== null}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkSaving === "review" ? "Marking..." : "Mark filtered as reviewed"}
                </button>

                <button
                  type="button"
                  onClick={() => void applyBulkAction("resolve")}
                  disabled={filtered.length === 0 || bulkSaving !== null}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-green-600 bg-green-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkSaving === "resolve" ? "Resolving..." : "Resolve filtered"}
                </button>

                <button
                  type="button"
                  onClick={() => void applyBulkAction("reopen")}
                  disabled={filtered.length === 0 || bulkSaving !== null}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-amber-600 bg-amber-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkSaving === "reopen" ? "Re-opening..." : "Re-open filtered"}
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  Showing{" "}
                  <span className="font-semibold text-slate-900">
                    {filteredSummary.total}
                  </span>{" "}
                  anomaly result{filteredSummary.total > 1 ? "s" : ""}
                </div>

                <div className="flex flex-wrap gap-4">
                  <span>
                    Open:{" "}
                    <span className="font-semibold text-slate-900">
                      {filteredSummary.open}
                    </span>
                  </span>
                  <span>
                    Reviewed:{" "}
                    <span className="font-semibold text-slate-900">
                      {filteredSummary.reviewed}
                    </span>
                  </span>
                  <span>
                    Resolved:{" "}
                    <span className="font-semibold text-slate-900">
                      {filteredSummary.resolved}
                    </span>
                  </span>
                </div>
              </div>

              {actionMessage ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  {actionMessage}
                </div>
              ) : null}
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Anomalies to investigate
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Each row highlights a finance or payout inconsistency that
                  should be reviewed.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[1900px] divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 font-medium">Severity</th>
                      <th className="px-4 py-3 font-medium">Issue</th>
                      <th className="px-4 py-3 font-medium">Order</th>
                      <th className="px-4 py-3 font-medium">Restaurant</th>
                      <th className="px-4 py-3 font-medium">Payment</th>
                      <th className="px-4 py-3 font-medium">Dashboard</th>
                      <th className="px-4 py-3 font-medium">Restaurant payout</th>
                      <th className="px-4 py-3 font-medium">Driver payout</th>
                      <th className="px-4 py-3 font-medium">Transfers</th>
                      <th className="px-4 py-3 font-medium">Last activity</th>
                      <th className="px-4 py-3 font-medium">Case review</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200 bg-white">
                    {filtered.length === 0 ? (
                      <tr>
                        <td
                          colSpan={12}
                          className="px-4 py-12 text-center text-sm text-slate-500"
                        >
                          No anomalies found for the current filters.
                        </td>
                      </tr>
                    ) : (
                      filtered.map((item) => {
                        const reviewKey = `${item.order_id}:${item.anomaly_kind}`;
                        const isSaving = savingKey === reviewKey;

                        return (
                          <tr
                            key={item.anomaly_id}
                            className="align-top hover:bg-slate-50"
                          >
                            <td className="px-4 py-4">
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${severityClass(
                                  item.severity
                                )}`}
                              >
                                {item.severity}
                              </span>
                            </td>

                            <td className="px-4 py-4">
                              <div className="font-medium text-slate-900">
                                {item.title}
                              </div>
                              <div className="mt-1 max-w-md text-xs text-slate-600">
                                {item.description}
                              </div>
                            </td>

                            <td className="px-4 py-4">
                              <div className="font-mono text-xs text-slate-900">
                                {truncateMiddle(item.order_id, 10, 8)}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {formatMoney(item.total, item.currency || "USD")}
                              </div>
                            </td>

                            <td className="px-4 py-4">
                              <div className="font-medium text-slate-900">
                                {item.restaurant_name || "—"}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {item.order_status}
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

                            <td className="px-4 py-4">
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${dashboardBadgeClass(
                                  item.dashboard_status
                                )}`}
                              >
                                {item.dashboard_status}
                              </span>
                            </td>

                            <td className="px-4 py-4">
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${payoutBadgeClass(
                                  item.restaurant_payout_status
                                )}`}
                              >
                                {item.restaurant_payout_status || "none"}
                              </span>
                              <div className="mt-1 text-xs text-slate-500">
                                paid_out: {item.restaurant_paid_out ? "true" : "false"}
                              </div>
                              {item.restaurant_failure_message ? (
                                <div className="mt-2 max-w-[220px] text-xs text-red-700">
                                  {item.restaurant_failure_message}
                                </div>
                              ) : null}
                            </td>

                            <td className="px-4 py-4">
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${payoutBadgeClass(
                                  item.driver_payout_status
                                )}`}
                              >
                                {item.driver_payout_status || "none"}
                              </span>
                              <div className="mt-1 text-xs text-slate-500">
                                paid_out: {item.driver_paid_out ? "true" : "false"}
                              </div>
                              {item.driver_failure_message ? (
                                <div className="mt-2 max-w-[220px] text-xs text-red-700">
                                  {item.driver_failure_message}
                                </div>
                              ) : null}
                            </td>

                            <td className="px-4 py-4">
                              <div className="font-mono text-xs text-slate-900">
                                R:{" "}
                                {truncateMiddle(
                                  item.restaurant_payout_transfer_id ||
                                    item.restaurant_transfer_id,
                                  8,
                                  6
                                )}
                              </div>
                              <div className="mt-1 font-mono text-xs text-slate-900">
                                D:{" "}
                                {truncateMiddle(
                                  item.driver_payout_transfer_id ||
                                    item.driver_transfer_id,
                                  8,
                                  6
                                )}
                              </div>
                            </td>

                            <td className="px-4 py-4 text-slate-700">
                              {formatDate(item.last_activity || item.created_at)}
                            </td>

                            <td className="px-4 py-4">
                              <div className="space-y-2">
                                <span
                                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${reviewBadgeClass(
                                    item.review_status
                                  )}`}
                                >
                                  {item.review_status}
                                </span>

                                <div className="text-xs text-slate-500">
                                  reviewed: {item.review_is_reviewed ? "true" : "false"}
                                </div>
                                <div className="text-xs text-slate-500">
                                  resolved: {item.review_is_resolved ? "true" : "false"}
                                </div>

                                {item.review_actor || item.review_updated_at ? (
                                  <div className="text-xs text-slate-500">
                                    {item.review_actor ? (
                                      <div>actor: {item.review_actor}</div>
                                    ) : null}
                                    {item.review_updated_at ? (
                                      <div>
                                        updated: {formatDate(item.review_updated_at)}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}

                                {item.review_admin_note ? (
                                  <div className="max-w-[240px] rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                                    {item.review_admin_note}
                                  </div>
                                ) : null}

                                <textarea
                                  value={noteDrafts[reviewKey] ?? item.review_admin_note ?? ""}
                                  onChange={(e) =>
                                    setNoteDrafts((prev) => ({
                                      ...prev,
                                      [reviewKey]: e.target.value,
                                    }))
                                  }
                                  rows={3}
                                  placeholder="Add admin note..."
                                  className="w-full min-w-[220px] rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                />
                              </div>
                            </td>

                            <td className="px-4 py-4">
                              <div className="flex min-w-[180px] flex-col gap-2">
                                <Link
                                  href={`/admin/payouts/${item.order_id}`}
                                  className="text-xs font-medium text-blue-600 hover:text-blue-800"
                                >
                                  Open detail
                                </Link>
                                <Link
                                  href={`/admin/orders/${item.order_id}`}
                                  className="text-xs font-medium text-slate-700 hover:text-slate-900"
                                >
                                  Open order
                                </Link>

                                <button
                                  type="button"
                                  onClick={() =>
                                    void saveCaseReview(item, {
                                      isReviewed: true,
                                    })
                                  }
                                  disabled={isSaving}
                                  className="text-left text-xs font-medium text-slate-700 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Mark reviewed
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    void saveCaseReview(item, {
                                      isReviewed: true,
                                      isResolved: true,
                                    })
                                  }
                                  disabled={isSaving}
                                  className="text-left text-xs font-medium text-green-700 hover:text-green-800 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Mark resolved
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    void saveCaseReview(item, {
                                      isReviewed: false,
                                      isResolved: false,
                                    })
                                  }
                                  disabled={isSaving}
                                  className="text-left text-xs font-medium text-amber-700 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Re-open
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    void saveCaseReview(item, {
                                      adminNote:
                                        noteDrafts[reviewKey] ??
                                        item.review_admin_note ??
                                        "",
                                    })
                                  }
                                  disabled={isSaving}
                                  className="text-left text-xs font-medium text-blue-700 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Save note
                                </button>

                                {item.anomaly_kind === "restaurant_failed" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void retryFailedPayout(item.order_id, "restaurant")
                                    }
                                    disabled={retryingKey === `${item.order_id}:restaurant`}
                                    className="text-left text-xs font-medium text-red-700 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {retryingKey === `${item.order_id}:restaurant`
                                      ? "Retrying restaurant..."
                                      : "Retry restaurant"}
                                  </button>
                                )}

                                {item.anomaly_kind === "driver_failed" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void retryFailedPayout(item.order_id, "driver")
                                    }
                                    disabled={retryingKey === `${item.order_id}:driver`}
                                    className="text-left text-xs font-medium text-red-700 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {retryingKey === `${item.order_id}:driver`
                                      ? "Retrying driver..."
                                      : "Retry driver"}
                                  </button>
                                )}
                              </div>
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
