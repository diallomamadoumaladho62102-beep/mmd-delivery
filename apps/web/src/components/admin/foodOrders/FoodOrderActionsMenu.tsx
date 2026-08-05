"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { AdminFoodOrderListItem } from "@/lib/adminFoodOrderDisplay";

/**
 * Navigation-only actions. No payment, cancel, refund, or status mutations.
 * Refund management stays on the order detail page.
 */
export default function FoodOrderActionsMenu({
  order,
  canManageOrders,
}: {
  order: AdminFoodOrderListItem;
  canManageOrders: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const clientId =
    order.client?.id || order.client_id || order.client_user_id || order.user_id || "";
  const driverId = order.driver?.id || order.driver_id || "";
  const restaurantId =
    order.restaurant?.id || order.restaurant_user_id || order.restaurant_id || "";

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function copyOrderId() {
    try {
      await navigator.clipboard.writeText(order.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
    setOpen(false);
  }

  const itemClass =
    "block w-full px-3 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none";

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label="Order actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        <span aria-hidden className="text-lg leading-none">
          ⋯
        </span>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          <Link
            role="menuitem"
            href={`/admin/orders/${order.id}`}
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            View details
          </Link>
          <Link
            role="menuitem"
            href={`/admin/orders/${order.id}#timeline`}
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            Timeline
          </Link>
          <Link
            role="menuitem"
            href={`/admin/payouts/${order.id}`}
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            Receipt / payout
          </Link>
          <button type="button" role="menuitem" className={itemClass} onClick={() => void copyOrderId()}>
            {copied ? "Copied!" : "Copy order ID"}
          </button>
          {clientId ? (
            <Link
              role="menuitem"
              href={`/admin/clients?q=${encodeURIComponent(clientId)}`}
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              Open client
            </Link>
          ) : null}
          {driverId ? (
            <Link
              role="menuitem"
              href="/admin/drivers"
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              Open drivers
            </Link>
          ) : null}
          {restaurantId ? (
            <Link
              role="menuitem"
              href="/admin/restaurants"
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              Open restaurants
            </Link>
          ) : null}
          {canManageOrders ? (
            <Link
              role="menuitem"
              href={`/admin/orders/${order.id}#cancel-refund`}
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              Refund (detail)
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
