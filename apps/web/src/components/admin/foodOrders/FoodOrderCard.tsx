"use client";


import { useAdminT } from "@/i18n/useAdminT";
import { memo, useState } from "react";
import Link from "next/link";
import {
  formatOrderDateParts,
  formatOrderMoney,
  orderStatusBadge,
  partyDisplayName,
  paymentStatusBadge,
  shortOrderId,
  summarizeAddress,
  type AdminFoodOrderListItem,
} from "@/lib/adminFoodOrderDisplay";
import FoodOrderActionsMenu from "./FoodOrderActionsMenu";
import FoodOrderAvatar from "./FoodOrderAvatar";
import FoodOrderBadge from "./FoodOrderBadge";
import FoodOrderStatusStepper from "./FoodOrderStatusStepper";
import { orderKindUiLabel } from "@/i18n/orderStatusUi";

function FoodOrderCard({
  order,
  canManageOrders,
}: {
  order: AdminFoodOrderListItem;
  canManageOrders: boolean;
}) {
  const { t, locale } = useAdminT();

  const [copied, setCopied] = useState(false);
  const status = orderStatusBadge(order.status);
  const payment = paymentStatusBadge(order.payment_status);
  const { date, time } = formatOrderDateParts(order.created_at, locale);
  const restaurantName = order.restaurant?.name || order.restaurant_name || t("Restaurant");
  const clientName = partyDisplayName(order.client, t("Unknown client"));
  const driverName = partyDisplayName(order.driver, t("Unknown driver"));
  const clientKind = String(order.client?.account_kind ?? "").toLowerCase();
  const dropoff = summarizeAddress(order.dropoff_address);
  const paidParts = order.paid_at ? formatOrderDateParts(order.paid_at, locale) : null;
  const deliveredParts = order.delivered_confirmed_at
    ? formatOrderDateParts(order.delivered_confirmed_at, locale)
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
              aria-label={t("Copy full order ID")}
              className="inline-flex h-11 min-w-11 items-center justify-center rounded-lg border border-slate-200 px-2 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {copied ? t("Copied") : t("Copy")}
            </button>
            <FoodOrderBadge label={t(status.label)} tone={status.tone} />
            <FoodOrderBadge label={t(payment.label)} tone={payment.tone} />
            {order.kind ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                {orderKindUiLabel(order.kind, t)}
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
              {formatOrderMoney(order, locale)}
            </div>
            <div className="text-[11px] text-slate-500">
              {order.item_count}{" "}
              {order.item_count === 1 ? t("item") : t("items")}
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
            <div className="text-[11px] text-slate-500">{t("Restaurant")}</div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          <FoodOrderAvatar name={clientName} src={order.client?.avatar_url} size={40} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="truncate text-sm font-medium text-slate-900">{clientName}</div>
              {clientKind && clientKind !== "real" ? (
                <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200">
                  {clientKind}
                </span>
              ) : null}
            </div>
            {order.client?.email && order.client.email !== clientName ? (
              <div
                className="truncate text-[11px] text-slate-500"
                title={order.client.email}
              >
                {order.client.email}
              </div>
            ) : null}
            {order.client?.phone ? (
              <div className="truncate text-[11px] text-slate-500">{order.client.phone}</div>
            ) : null}
          </div>
        </div>
      </div>

      {order.driver ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          <FoodOrderAvatar
            name={driverName}
            src={order.driver.avatar_url}
            size={24}
          />
          <span className="truncate">{t("Driver")} · {driverName}</span>
        </div>
      ) : (
        <div className="mt-3 text-xs text-slate-500">{t("No driver assigned")}</div>
      )}

      {(order.distance_miles != null || order.eta_minutes != null || dropoff) && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
          {order.distance_miles != null ? <span>{order.distance_miles.toFixed(1)} mi</span> : null}
          {order.eta_minutes != null ? (
            <span>
              {order.eta_minutes} {t("min ETA")}
            </span>
          ) : null}
          {dropoff ? <span className="truncate">→ {dropoff}</span> : null}
        </div>
      )}

      {(paidParts || deliveredParts) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
          {paidParts ? (
            <span>
              {t("Paid")} {paidParts.date} · {paidParts.time}
            </span>
          ) : null}
          {deliveredParts ? (
            <span>
              {t("Delivered")} {deliveredParts.date} · {deliveredParts.time}
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
          {t("Open order")}
        </Link>
        <Link
          href={`/admin/orders/${order.id}#timeline`}
          className="inline-flex h-11 items-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t("Timeline")}
        </Link>
      </div>
    </article>
  );
}

export default memo(FoodOrderCard);
