"use client";

import { memo, useState } from "react";
import Link from "next/link";
import {
  formatOrderDateParts,
  formatOrderMoney,
  orderStatusBadge,
  paymentStatusBadge,
  shortOrderId,
  summarizeAddress,
  type AdminFoodOrderListItem,
} from "@/lib/adminFoodOrderDisplay";
import FoodOrderActionsMenu from "./FoodOrderActionsMenu";
import FoodOrderAvatar from "./FoodOrderAvatar";
import FoodOrderBadge from "./FoodOrderBadge";
import FoodOrderStatusStepper from "./FoodOrderStatusStepper";

function FoodOrderCard({
  order,
  canManageOrders,
}: {
  order: AdminFoodOrderListItem;
  canManageOrders: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const status = orderStatusBadge(order.status);
  const payment = paymentStatusBadge(order.payment_status);
  const { date, time } = formatOrderDateParts(order.created_at);
  const restaurantName = order.restaurant?.name || order.restaurant_name || "Restaurant";
  const clientName = order.client?.full_name || "Client";
  const dropoff = summarizeAddress(order.dropoff_address);
  const paidParts = order.paid_at ? formatOrderDateParts(order.paid_at) : null;
  const deliveredParts = order.delivered_confirmed_at
    ? formatOrderDateParts(order.delivered_confirmed_at)
    : null;

  async function copyId() {
    try {
      await navigator.clipboard.writeText(order.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/orders/${order.id}`}
              className="min-h-11 inline-flex items-center font-semibold tracking-tight text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              #{shortOrderId(order.id)}
            </Link>
            <button
              type="button"
              onClick={() => void copyId()}
              aria-label="Copy full order ID"
              className="inline-flex h-11 min-w-11 items-center justify-center rounded-lg border border-slate-200 px-2 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <FoodOrderBadge label={status.label} tone={status.tone} />
            <FoodOrderBadge label={payment.label} tone={payment.tone} />
            {order.kind ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                {order.kind}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {date} · {time}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <div className="text-right">
            <div className="text-base font-semibold text-slate-900">
              {formatOrderMoney(order)}
            </div>
            <div className="text-[11px] text-slate-500">
              {order.item_count} item{order.item_count === 1 ? "" : "s"}
            </div>
          </div>
          <FoodOrderActionsMenu order={order} canManageOrders={canManageOrders} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <FoodOrderAvatar
            name={restaurantName}
            src={order.restaurant?.logo_url}
            rounded="lg"
            size={40}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900">
              {restaurantName}
            </div>
            <div className="text-[11px] text-slate-500">Restaurant</div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          <FoodOrderAvatar name={clientName} src={order.client?.avatar_url} size={40} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900">{clientName}</div>
            <div
              className="truncate text-[11px] text-slate-500"
              title={order.client?.email || undefined}
            >
              {order.client?.email || "No email"}
            </div>
            {order.client?.phone ? (
              <div className="truncate text-[11px] text-slate-500">{order.client.phone}</div>
            ) : null}
          </div>
        </div>
      </div>

      {order.driver ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          <FoodOrderAvatar
            name={order.driver.full_name}
            src={order.driver.avatar_url}
            size={24}
          />
          <span className="truncate">
            Driver · {order.driver.full_name || shortOrderId(order.driver.id)}
          </span>
        </div>
      ) : (
        <div className="mt-3 text-xs text-slate-500">No driver assigned</div>
      )}

      {(order.distance_miles != null || order.eta_minutes != null || dropoff) && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
          {order.distance_miles != null ? <span>{order.distance_miles.toFixed(1)} mi</span> : null}
          {order.eta_minutes != null ? <span>{order.eta_minutes} min ETA</span> : null}
          {dropoff ? <span className="truncate">→ {dropoff}</span> : null}
        </div>
      )}

      {(paidParts || deliveredParts) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
          {paidParts ? (
            <span>
              Paid {paidParts.date} · {paidParts.time}
            </span>
          ) : null}
          {deliveredParts ? (
            <span>
              Delivered {deliveredParts.date} · {deliveredParts.time}
            </span>
          ) : null}
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <FoodOrderStatusStepper status={order.status} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/admin/orders/${order.id}`}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          Open order
        </Link>
        <Link
          href={`/admin/orders/${order.id}#timeline`}
          className="inline-flex h-11 items-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          Timeline
        </Link>
      </div>
    </article>
  );
}

export default memo(FoodOrderCard);
