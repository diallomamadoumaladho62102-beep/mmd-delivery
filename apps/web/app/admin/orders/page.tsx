"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { canAccessAdminDashboard } from "@/lib/adminAccess";

type Order = {
  id: string;
  status: string | null;
  subtotal: number | null;
  currency: string | null;
  created_at: string;
};

function formatMoney(value: number | null | undefined, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value ?? 0);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function truncateId(value: string, size = 8) {
  return value.slice(0, size);
}

export default function AdminOrdersPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [rows, setRows] = useState<Order[]>([]);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async (statusFilter: string) => {
    let query = supabase
      .from("orders")
      .select("id, status, subtotal, currency, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as Order[];
  }, []);

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

        if (!profile || !canAccessAdminDashboard(profile.role)) {
          setIsAdmin(false);
          setAuthChecked(true);
          setError("Access restricted to administrators.");
          return;
        }

        setIsAdmin(true);
        setAuthChecked(true);

        const orders = await loadOrders(status);
        setRows(orders);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setRows([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router, loadOrders, status]
  );

  useEffect(() => {
    void loadPage("initial");
  }, [loadPage]);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              MMD Delivery · Admin Orders
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
              Admin — Orders
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Browse the latest orders, filter by status and open the admin detail
              page.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void loadPage("refresh")}
              disabled={!isAdmin || refreshing}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {loading || !authChecked ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-sm text-slate-500">Loading admin orders...</div>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
            <div className="text-sm font-medium text-red-800">
              Failed to load admin orders
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
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="sm:w-72">
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Status filter
                  </label>
                  <select
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="">(all)</option>
                    <option value="pending">pending</option>
                    <option value="assigned">assigned</option>
                    <option value="accepted">accepted</option>
                    <option value="prepared">prepared</option>
                    <option value="ready">ready</option>
                    <option value="dispatched">dispatched</option>
                    <option value="delivered">delivered</option>
                    <option value="canceled">canceled</option>
                  </select>
                </div>

                <div className="text-sm text-slate-600">
                  Showing{" "}
                  <span className="font-semibold text-slate-900">{rows.length}</span>{" "}
                  order{rows.length > 1 ? "s" : ""}
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {rows.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm md:col-span-2">
                  No orders found for the current filter.
                </div>
              ) : (
                rows.map((order) => {
                  const shortId = truncateId(order.id, 8);

                  return (
                    <div
                      key={order.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="space-y-2">
                        <div className="font-semibold text-slate-900">#{shortId}</div>

                        <div className="text-sm text-slate-600">
                          Status:{" "}
                          <span className="font-medium text-slate-900">
                            {order.status ?? "-"}
                          </span>
                        </div>

                        <div className="text-sm text-slate-600">
                          Total:{" "}
                          <span className="font-medium text-slate-900">
                            {formatMoney(order.subtotal, order.currency ?? "USD")}
                          </span>
                        </div>

                        <div className="text-xs text-slate-500">
                          {formatDate(order.created_at)}
                        </div>

                        <div className="pt-2">
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="text-sm font-medium text-blue-600 underline underline-offset-2 hover:text-blue-800"
                          >
                            Open
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
