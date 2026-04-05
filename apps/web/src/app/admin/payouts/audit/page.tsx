"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { canAccessAuditLogs } from "@/lib/adminAccess";

type AuditStatus = "requested" | "rejected" | "succeeded" | "failed";
type AuditTarget = "restaurant" | "driver";
type AuditStatusFilter = "all" | AuditStatus;
type AuditTargetFilter = "all" | AuditTarget;
type SortDirection = "asc" | "desc";

type AuditItem = {
  id: string;
  order_id: string;
  target: AuditTarget | string;
  action: string;
  actor: string | null;
  status: AuditStatus | string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ApiResponse = {
  ok: boolean;
  items: AuditItem[];
  summary: {
    total: number;
    total_matching: number;
    requested: number;
    rejected: number;
    succeeded: number;
    failed: number;
    restaurant: number;
    driver: number;
  };
  filters: {
    q: string;
    status: AuditStatusFilter;
    target: AuditTargetFilter;
    sort: SortDirection;
    limit: number;
  };
  error?: string;
};

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

function statusBadgeClass(status: string) {
  switch (status) {
    case "requested":
      return "border-blue-200 bg-blue-100 text-blue-800";
    case "rejected":
      return "border-amber-200 bg-amber-100 text-amber-800";
    case "succeeded":
      return "border-green-200 bg-green-100 text-green-800";
    case "failed":
      return "border-red-200 bg-red-100 text-red-800";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function targetBadgeClass(target: string) {
  switch (target) {
    case "restaurant":
      return "border-violet-200 bg-violet-100 text-violet-800";
    case "driver":
      return "border-cyan-200 bg-cyan-100 text-cyan-800";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
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

function safeJsonPreview(value: Record<string, unknown> | null | undefined) {
  if (!value) return "—";

  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > 500 ? `${json.slice(0, 500)}...` : json;
  } catch {
    return "—";
  }
}

export default function AdminPayoutAuditLogsPage() {
  const router = useRouter();
  const copyTimeoutRef = useRef<number | null>(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AuditStatusFilter>("all");
  const [target, setTarget] = useState<AuditTargetFilter>("all");
  const [sort, setSort] = useState<SortDirection>("desc");

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

        const params = new URLSearchParams();

        if (search.trim()) {
          params.set("q", search.trim());
        }

        if (status !== "all") {
          params.set("status", status);
        }

        if (target !== "all") {
          params.set("target", target);
        }

        params.set("sort", sort);
        params.set("limit", "200");

        const response = await fetch(
          `/api/admin/payouts/audit?${params.toString()}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const json = (await response.json()) as ApiResponse;

        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Failed to load audit logs");
        }

        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router, search, status, target, sort]
  );

  useEffect(() => {
    void loadPage("initial");

    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, [loadPage]);

  function applySearch() {
    setSearch(searchInput.trim());
  }

  function resetFilters() {
    setSearchInput("");
    setSearch("");
    setStatus("all");
    setTarget("all");
    setSort("desc");
  }

  async function copyOrderId(orderId: string) {
    try {
      await navigator.clipboard.writeText(orderId);
      setCopiedOrderId(orderId);

      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }

      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedOrderId(null);
      }, 1200);
    } catch {
      // no-op
    }
  }

  const items = data?.items ?? [];
  const summary = data?.summary;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-[1700px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              MMD Delivery · Finance Ops · Audit
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
              Admin Payout Audit Logs
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Review retry requests, rejections, successes and failures across
              restaurant and driver payout actions.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/payouts"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              Back to payouts
            </Link>
            <Link
              href="/admin/payouts/reconciliation"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              Reconciliation
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
            <div className="text-sm text-slate-500">Loading audit logs...</div>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
            <div className="text-sm font-medium text-red-800">
              Failed to load audit logs
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
              <StatCard title="Matching logs" value={summary?.total_matching ?? 0} />
              <StatCard title="Requested" value={summary?.requested ?? 0} />
              <StatCard
                title="Rejected"
                value={summary?.rejected ?? 0}
                tone="warning"
              />
              <StatCard
                title="Succeeded"
                value={summary?.succeeded ?? 0}
                tone="success"
              />
              <StatCard
                title="Failed"
                value={summary?.failed ?? 0}
                tone="danger"
              />
            </section>

            <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard title="Restaurant target" value={summary?.restaurant ?? 0} />
              <StatCard title="Driver target" value={summary?.driver ?? 0} />
              <StatCard title="Rows returned" value={summary?.total ?? 0} />
            </section>

            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_220px_220px_180px_auto]">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Search
                  </label>
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        applySearch();
                      }
                    }}
                    placeholder="Search by order_id, target, status, actor, action or message..."
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) =>
                      setStatus(e.target.value as AuditStatusFilter)
                    }
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="all">All</option>
                    <option value="requested">Requested</option>
                    <option value="rejected">Rejected</option>
                    <option value="succeeded">Succeeded</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Target
                  </label>
                  <select
                    value={target}
                    onChange={(e) =>
                      setTarget(e.target.value as AuditTargetFilter)
                    }
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="all">All</option>
                    <option value="restaurant">Restaurant</option>
                    <option value="driver">Driver</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Sort
                  </label>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortDirection)}
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </div>

                <div className="flex items-end gap-3">
                  <button
                    type="button"
                    onClick={applySearch}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
                  >
                    Search
                  </button>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="mt-4 text-sm text-slate-600">
                Showing{" "}
                <span className="font-semibold text-slate-900">
                  {items.length}
                </span>{" "}
                audit log row{items.length > 1 ? "s" : ""}
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Audit log entries
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Trace sensitive payout retry activity across admin operations.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[1600px] divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 font-medium">Created</th>
                      <th className="px-4 py-3 font-medium">Order</th>
                      <th className="px-4 py-3 font-medium">Target</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Action</th>
                      <th className="px-4 py-3 font-medium">Actor</th>
                      <th className="px-4 py-3 font-medium">Message</th>
                      <th className="px-4 py-3 font-medium">Metadata</th>
                      <th className="px-4 py-3 font-medium">Navigation</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200 bg-white">
                    {items.length === 0 ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="px-4 py-12 text-center text-sm text-slate-500"
                        >
                          No audit logs found for the current filters.
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => (
                        <tr key={item.id} className="align-top hover:bg-slate-50">
                          <td className="px-4 py-4 text-slate-700">
                            {formatDate(item.created_at)}
                          </td>

                          <td className="px-4 py-4">
                            <div className="font-mono text-xs text-slate-900">
                              {truncateMiddle(item.order_id, 12, 10)}
                            </div>
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => void copyOrderId(item.order_id)}
                                className="text-xs font-medium text-slate-600 hover:text-slate-900"
                              >
                                {copiedOrderId === item.order_id
                                  ? "Copied"
                                  : "Copy order ID"}
                              </button>
                            </div>
                          </td>

                          <td className="px-4 py-4">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${targetBadgeClass(
                                item.target
                              )}`}
                            >
                              {item.target}
                            </span>
                          </td>

                          <td className="px-4 py-4">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusBadgeClass(
                                item.status
                              )}`}
                            >
                              {item.status}
                            </span>
                          </td>

                          <td className="px-4 py-4 text-slate-900">
                            {item.action}
                          </td>

                          <td className="px-4 py-4">
                            <div className="max-w-[220px] break-all text-slate-700">
                              {item.actor || "—"}
                            </div>
                          </td>

                          <td className="px-4 py-4">
                            <div className="max-w-[360px] whitespace-pre-wrap text-slate-700">
                              {item.message || "—"}
                            </div>
                          </td>

                          <td className="px-4 py-4">
                            <pre className="max-w-[420px] overflow-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                              {safeJsonPreview(item.metadata)}
                            </pre>
                          </td>

                          <td className="px-4 py-4">
                            <div className="flex flex-col gap-2">
                              <Link
                                href={`/admin/payouts/${item.order_id}`}
                                className="text-xs font-medium text-blue-600 hover:text-blue-800"
                              >
                                Open payout detail
                              </Link>
                              <Link
                                href={`/admin/orders/${item.order_id}`}
                                className="text-xs font-medium text-slate-700 hover:text-slate-900"
                              >
                                Open order
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))
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