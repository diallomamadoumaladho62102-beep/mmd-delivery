"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

type OrderRow = {
  id: string;
  created_at: string;
  status: string;
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
  restaurant_payout_id: string | null;

  driver_paid_out: boolean;
  driver_paid_out_at: string | null;
  driver_transfer_id: string | null;
  driver_payout_id: string | null;

  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;

  user_id: string | null;
  client_id: string | null;
  client_user_id: string | null;
  driver_id: string | null;
  restaurant_id: string;
  restaurant_user_id: string | null;

  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;

  subtotal: number | null;
  tax: number | null;
  delivery_fee: number | null;
  delivery_fee_cents: number | null;
  taxes_cents: number | null;
  tip: number | null;
  tip_cents: number | null;

  restaurant_net_amount: number | null;
  restaurant_commission_amount: number | null;
  restaurant_commission_rate: number | null;
  driver_delivery_payout: number | null;
  platform_delivery_fee: number | null;

  distance_miles: number | null;
  eta_minutes: number | null;
  distance_miles_est: number | null;
  eta_minutes_est: number | null;

  kind: string | null;
  order_type: string | null;
  type: string | null;
  title: string | null;
};

type OrderPayoutRow = {
  id: string;
  order_id: string;
  target: "restaurant" | "driver" | string;
  status: string;
  currency: string | null;
  amount_cents: number | null;
  destination_account_id: string | null;
  source_charge_id: string | null;
  stripe_transfer_id: string | null;
  idempotency_key: string | null;
  locked_at: string | null;
  locked_by: string | null;
  failure_code: string | null;
  failure_message: string | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  succeeded_at: string | null;
  failed_at: string | null;
};

type TimelineItem = {
  key: string;
  label: string;
  at: string;
  tone: "default" | "success" | "danger";
};

type ApiResponse = {
  ok: boolean;
  item: {
    order: OrderRow;
    payouts: OrderPayoutRow[];
    restaurant_payout: OrderPayoutRow | null;
    driver_payout: OrderPayoutRow | null;
    dashboard_status: DashboardStatus;
    timeline: TimelineItem[];
  };
  error?: string;
};

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
  start = 10,
  end = 8
) {
  if (!value) return "—";
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function buildStripeTransferUrl(transferId: string | null | undefined) {
  if (!transferId) return null;
  return `https://dashboard.stripe.com/transfers/${transferId}`;
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

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[180px_minmax(0,1fr)]">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className={`text-sm text-slate-900 ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export default function AdminPayoutDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const router = useRouter();
  const copyTimeoutRef = useRef<number | null>(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [orderId, setOrderId] = useState<string>("");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [retryingTarget, setRetryingTarget] = useState<
    "restaurant" | "driver" | null
  >(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function resolveParams() {
      const p = await params;
      if (alive) {
        setOrderId((p.orderId ?? "").trim());
      }
    }

    void resolveParams();

    return () => {
      alive = false;
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, [params]);

  const loadPage = useCallback(
    async (currentOrderId: string, mode: "initial" | "refresh" = "initial") => {
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

        if (!profile || !canAccessPayouts(profile.role)) {
          setIsAdmin(false);
          setAuthChecked(true);
          setError("Access restricted to administrators.");
          return;
        }

        setIsAdmin(true);
        setAuthChecked(true);

        const response = await fetch(`/api/admin/payouts/${currentOrderId}`, {
          method: "GET",
          cache: "no-store",
        });

        const json = (await response.json()) as ApiResponse;

        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Failed to load payout detail");
        }

        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  useEffect(() => {
    if (!orderId) return;
    void loadPage(orderId, "initial");
  }, [orderId, loadPage]);

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
      // no-op
    }
  }

  async function retryFailedPayout(target: "restaurant" | "driver") {
    try {
      if (!orderId) return;

      const ok = window.confirm(
        `Retry failed payout for ${target} on order ${orderId} ?`
      );
      if (!ok) return;

      setRetryMessage(null);
      setRetryingTarget(target);

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

      setRetryMessage(json.message || `Retry succeeded for ${target}.`);
      await loadPage(orderId, "refresh");
    } catch (err) {
      setRetryMessage(
        err instanceof Error ? err.message : "Unknown retry error"
      );
    } finally {
      setRetryingTarget(null);
    }
  }

  const item = data?.item;
  const order = item?.order;
  const restaurantPayout = item?.restaurant_payout;
  const driverPayout = item?.driver_payout;

  const restaurantStripeUrl = useMemo(
    () =>
      buildStripeTransferUrl(
        restaurantPayout?.stripe_transfer_id || order?.restaurant_transfer_id
      ),
    [restaurantPayout?.stripe_transfer_id, order?.restaurant_transfer_id]
  );

  const driverStripeUrl = useMemo(
    () =>
      buildStripeTransferUrl(
        driverPayout?.stripe_transfer_id || order?.driver_transfer_id
      ),
    [driverPayout?.stripe_transfer_id, order?.driver_transfer_id]
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              MMD Delivery · Admin Payout Detail
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
              Payout Detail
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Full order, payout, Stripe transfer and timeline detail for one
              order.
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
              onClick={() => orderId && void loadPage(orderId, "refresh")}
              disabled={refreshing || !orderId}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            {orderId ? (
              <button
                type="button"
                onClick={() => void copyText(orderId)}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
              >
                {copied === orderId ? "Copied" : "Copy order ID"}
              </button>
            ) : null}
          </div>
        </div>

        {loading || !authChecked ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-sm text-slate-500">Loading payout detail...</div>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
            <div className="text-sm font-medium text-red-800">
              Failed to load payout detail
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
        ) : !order || !item ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-sm text-slate-500">No detail found.</div>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm text-slate-500">Order ID</div>
                <div className="mt-2 font-mono text-sm text-slate-900">
                  {truncateMiddle(order.id, 12, 10)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm text-slate-500">Dashboard status</div>
                <div className="mt-3">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(
                      item.dashboard_status
                    )}`}
                  >
                    {labelForDashboardStatus(item.dashboard_status)}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm text-slate-500">Payment status</div>
                <div className="mt-3">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                      order.payment_status === "paid"
                        ? "border-green-200 bg-green-100 text-green-800"
                        : "border-slate-200 bg-slate-100 text-slate-700"
                    }`}
                  >
                    {order.payment_status}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm text-slate-500">Total</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatMoney(order.total, order.currency || "USD")}
                </div>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1fr]">
              <Card title="Order overview" subtitle="Core business and payment data">
                <InfoRow label="Order ID" value={order.id} mono />
                <InfoRow label="Restaurant" value={order.restaurant_name || "—"} />
                <InfoRow label="Order status" value={order.status} />
                <InfoRow label="Payment status" value={order.payment_status} />
                <InfoRow label="Currency" value={order.currency || "—"} />
                <InfoRow
                  label="Total"
                  value={formatMoney(order.total, order.currency || "USD")}
                />
                <InfoRow
                  label="Subtotal"
                  value={formatMoney(order.subtotal, order.currency || "USD")}
                />
                <InfoRow
                  label="Tax"
                  value={formatMoney(order.tax, order.currency || "USD")}
                />
                <InfoRow
                  label="Delivery fee"
                  value={formatMoney(order.delivery_fee, order.currency || "USD")}
                />
                <InfoRow
                  label="Tip"
                  value={formatMoney(order.tip, order.currency || "USD")}
                />
                <InfoRow label="Created at" value={formatDate(order.created_at)} />
                <InfoRow label="Paid at" value={formatDate(order.paid_at)} />
                <InfoRow label="Picked up at" value={formatDate(order.picked_up_at)} />
                <InfoRow
                  label="Delivered at"
                  value={formatDate(order.delivered_confirmed_at)}
                />
                <InfoRow label="Type" value={order.type || "—"} />
                <InfoRow label="Kind" value={order.kind || "—"} />
                <InfoRow label="Order type" value={order.order_type || "—"} />
                <InfoRow label="Title" value={order.title || "—"} />
              </Card>

              <Card title="Timeline" subtitle="Main lifecycle and payout events">
                <div className="space-y-3">
                  {item.timeline.length === 0 ? (
                    <div className="text-sm text-slate-500">No timeline events.</div>
                  ) : (
                    item.timeline.map((t) => (
                      <div
                        key={t.key}
                        className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <div
                          className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
                            t.tone === "success"
                              ? "bg-green-500"
                              : t.tone === "danger"
                              ? "bg-red-500"
                              : "bg-slate-400"
                          }`}
                        />
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            {t.label}
                          </div>
                          <div className="text-sm text-slate-500">
                            {formatDate(t.at)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <Card
                title="Restaurant payout"
                subtitle="Restaurant transfer and payout metadata"
              >
                <div className="mb-4">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getPayoutBadgeClass(
                      restaurantPayout?.status ?? null
                    )}`}
                  >
                    {restaurantPayout?.status || "none"}
                  </span>
                </div>

                <InfoRow
                  label="Paid out"
                  value={order.restaurant_paid_out ? "true" : "false"}
                />
                <InfoRow
                  label="Paid out at"
                  value={formatDate(order.restaurant_paid_out_at)}
                />
                <InfoRow
                  label="Amount"
                  value={formatMoneyFromCents(
                    restaurantPayout?.amount_cents ?? null,
                    order.currency || "USD"
                  )}
                />
                <InfoRow
                  label="Transfer ID"
                  value={
                    restaurantPayout?.stripe_transfer_id ||
                    order.restaurant_transfer_id ||
                    "—"
                  }
                  mono
                />
                <InfoRow
                  label="Destination account"
                  value={restaurantPayout?.destination_account_id || "—"}
                  mono
                />
                <InfoRow
                  label="Source charge"
                  value={restaurantPayout?.source_charge_id || "—"}
                  mono
                />
                <InfoRow
                  label="Idempotency key"
                  value={restaurantPayout?.idempotency_key || "—"}
                  mono
                />
                <InfoRow
                  label="Locked by"
                  value={restaurantPayout?.locked_by || "—"}
                />
                <InfoRow
                  label="Locked at"
                  value={formatDate(restaurantPayout?.locked_at || null)}
                />
                <InfoRow
                  label="Succeeded at"
                  value={formatDate(restaurantPayout?.succeeded_at || null)}
                />
                <InfoRow
                  label="Failed at"
                  value={formatDate(restaurantPayout?.failed_at || null)}
                />
                <InfoRow
                  label="Failure code"
                  value={restaurantPayout?.failure_code || "—"}
                />
                <InfoRow
                  label="Failure message"
                  value={restaurantPayout?.failure_message || "—"}
                />
                <InfoRow
                  label="Last error"
                  value={restaurantPayout?.last_error || "—"}
                />

                <div className="mt-4 flex flex-wrap gap-3">
                  {(restaurantPayout?.stripe_transfer_id ||
                    order.restaurant_transfer_id) && (
                    <button
                      type="button"
                      onClick={() =>
                        void copyText(
                          restaurantPayout?.stripe_transfer_id ||
                            order.restaurant_transfer_id ||
                            ""
                        )
                      }
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100"
                    >
                      {copied ===
                      (restaurantPayout?.stripe_transfer_id ||
                        order.restaurant_transfer_id)
                        ? "Copied"
                        : "Copy transfer ID"}
                    </button>
                  )}

                  {restaurantStripeUrl && (
                    <a
                      href={restaurantStripeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                    >
                      Open Stripe
                    </a>
                  )}

                  {restaurantPayout?.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => void retryFailedPayout("restaurant")}
                      disabled={retryingTarget === "restaurant"}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-red-600 bg-red-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {retryingTarget === "restaurant"
                        ? "Retrying..."
                        : "Retry Failed Payout"}
                    </button>
                  )}
                </div>
              </Card>

              <Card
                title="Driver payout"
                subtitle="Driver transfer and payout metadata"
              >
                <div className="mb-4">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getPayoutBadgeClass(
                      driverPayout?.status ?? null
                    )}`}
                  >
                    {driverPayout?.status || "none"}
                  </span>
                </div>

                <InfoRow
                  label="Paid out"
                  value={order.driver_paid_out ? "true" : "false"}
                />
                <InfoRow
                  label="Paid out at"
                  value={formatDate(order.driver_paid_out_at)}
                />
                <InfoRow
                  label="Amount"
                  value={formatMoneyFromCents(
                    driverPayout?.amount_cents ?? null,
                    order.currency || "USD"
                  )}
                />
                <InfoRow
                  label="Transfer ID"
                  value={
                    driverPayout?.stripe_transfer_id ||
                    order.driver_transfer_id ||
                    "—"
                  }
                  mono
                />
                <InfoRow
                  label="Destination account"
                  value={driverPayout?.destination_account_id || "—"}
                  mono
                />
                <InfoRow
                  label="Source charge"
                  value={driverPayout?.source_charge_id || "—"}
                  mono
                />
                <InfoRow
                  label="Idempotency key"
                  value={driverPayout?.idempotency_key || "—"}
                  mono
                />
                <InfoRow label="Locked by" value={driverPayout?.locked_by || "—"} />
                <InfoRow
                  label="Locked at"
                  value={formatDate(driverPayout?.locked_at || null)}
                />
                <InfoRow
                  label="Succeeded at"
                  value={formatDate(driverPayout?.succeeded_at || null)}
                />
                <InfoRow
                  label="Failed at"
                  value={formatDate(driverPayout?.failed_at || null)}
                />
                <InfoRow
                  label="Failure code"
                  value={driverPayout?.failure_code || "—"}
                />
                <InfoRow
                  label="Failure message"
                  value={driverPayout?.failure_message || "—"}
                />
                <InfoRow label="Last error" value={driverPayout?.last_error || "—"} />

                <div className="mt-4 flex flex-wrap gap-3">
                  {(driverPayout?.stripe_transfer_id || order.driver_transfer_id) && (
                    <button
                      type="button"
                      onClick={() =>
                        void copyText(
                          driverPayout?.stripe_transfer_id ||
                            order.driver_transfer_id ||
                            ""
                        )
                      }
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100"
                    >
                      {copied ===
                      (driverPayout?.stripe_transfer_id ||
                        order.driver_transfer_id)
                        ? "Copied"
                        : "Copy transfer ID"}
                    </button>
                  )}

                  {driverStripeUrl && (
                    <a
                      href={driverStripeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                    >
                      Open Stripe
                    </a>
                  )}

                  {driverPayout?.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => void retryFailedPayout("driver")}
                      disabled={retryingTarget === "driver"}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-red-600 bg-red-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {retryingTarget === "driver"
                        ? "Retrying..."
                        : "Retry Failed Payout"}
                    </button>
                  )}
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <Card
                title="Business amounts"
                subtitle="Net, commission and payout numbers"
              >
                <InfoRow
                  label="Restaurant net amount"
                  value={formatMoney(
                    order.restaurant_net_amount,
                    order.currency || "USD"
                  )}
                />
                <InfoRow
                  label="Restaurant commission amount"
                  value={formatMoney(
                    order.restaurant_commission_amount,
                    order.currency || "USD"
                  )}
                />
                <InfoRow
                  label="Restaurant commission rate"
                  value={
                    order.restaurant_commission_rate != null
                      ? `${Number(order.restaurant_commission_rate) * 100}%`
                      : "—"
                  }
                />
                <InfoRow
                  label="Driver delivery payout"
                  value={formatMoney(
                    order.driver_delivery_payout,
                    order.currency || "USD"
                  )}
                />
                <InfoRow
                  label="Platform delivery fee"
                  value={formatMoney(
                    order.platform_delivery_fee,
                    order.currency || "USD"
                  )}
                />
                <InfoRow
                  label="Distance"
                  value={
                    order.distance_miles != null ? `${order.distance_miles} mi` : "—"
                  }
                />
                <InfoRow
                  label="ETA"
                  value={order.eta_minutes != null ? `${order.eta_minutes} min` : "—"}
                />
              </Card>

              <Card
                title="Identifiers and addresses"
                subtitle="Useful ops references"
              >
                <InfoRow label="User ID" value={order.user_id || "—"} mono />
                <InfoRow label="Client ID" value={order.client_id || "—"} mono />
                <InfoRow
                  label="Client user ID"
                  value={order.client_user_id || "—"}
                  mono
                />
                <InfoRow label="Driver ID" value={order.driver_id || "—"} mono />
                <InfoRow
                  label="Restaurant ID"
                  value={order.restaurant_id || "—"}
                  mono
                />
                <InfoRow
                  label="Restaurant user ID"
                  value={order.restaurant_user_id || "—"}
                  mono
                />
                <InfoRow
                  label="Payment Intent ID"
                  value={order.stripe_payment_intent_id || "—"}
                  mono
                />
                <InfoRow
                  label="Stripe Session ID"
                  value={order.stripe_session_id || "—"}
                  mono
                />
                <InfoRow label="Pickup address" value={order.pickup_address || "—"} />
                <InfoRow
                  label="Dropoff address"
                  value={order.dropoff_address || "—"}
                />
                <InfoRow
                  label="Pickup coordinates"
                  value={
                    order.pickup_lat != null && order.pickup_lng != null
                      ? `${order.pickup_lat}, ${order.pickup_lng}`
                      : "—"
                  }
                />
                <InfoRow
                  label="Dropoff coordinates"
                  value={
                    order.dropoff_lat != null && order.dropoff_lng != null
                      ? `${order.dropoff_lat}, ${order.dropoff_lng}`
                      : "—"
                  }
                />
              </Card>
            </div>

            <Card
              title="Raw payout records"
              subtitle="Database payout rows for this order"
            >
              <div className="overflow-x-auto">
                <table className="min-w-[1100px] divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 font-medium">Target</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Amount</th>
                      <th className="px-4 py-3 font-medium">Transfer ID</th>
                      <th className="px-4 py-3 font-medium">Source charge</th>
                      <th className="px-4 py-3 font-medium">Created</th>
                      <th className="px-4 py-3 font-medium">Succeeded</th>
                      <th className="px-4 py-3 font-medium">Failed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {item.payouts.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-8 text-center text-sm text-slate-500"
                        >
                          No payout rows found.
                        </td>
                      </tr>
                    ) : (
                      item.payouts.map((payout) => (
                        <tr key={payout.id}>
                          <td className="px-4 py-4 text-slate-900">
                            {payout.target}
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getPayoutBadgeClass(
                                payout.status
                              )}`}
                            >
                              {payout.status}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-slate-900">
                            {formatMoneyFromCents(
                              payout.amount_cents,
                              payout.currency || order.currency || "USD"
                            )}
                          </td>
                          <td className="px-4 py-4 font-mono text-xs text-slate-900">
                            {truncateMiddle(payout.stripe_transfer_id, 12, 10)}
                          </td>
                          <td className="px-4 py-4 font-mono text-xs text-slate-900">
                            {truncateMiddle(payout.source_charge_id, 12, 10)}
                          </td>
                          <td className="px-4 py-4 text-slate-700">
                            {formatDate(payout.created_at)}
                          </td>
                          <td className="px-4 py-4 text-slate-700">
                            {formatDate(payout.succeeded_at)}
                          </td>
                          <td className="px-4 py-4 text-slate-700">
                            {formatDate(payout.failed_at)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {retryMessage ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
                {retryMessage}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}