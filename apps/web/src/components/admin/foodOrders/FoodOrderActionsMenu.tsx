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

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
      >
        <span className="sr-only">Order actions</span>
        <span aria-hidden className="text-lg leading-none">
          ⋯
        </span>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          <Link
            role="menuitem"
            href={`/admin/orders/${order.id}`}
            className="block px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            View details
          </Link>
          {clientId ? (
            <Link
              role="menuitem"
              href={`/admin/clients?q=${encodeURIComponent(clientId)}`}
              className="block px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              Open client
            </Link>
          ) : null}
          {driverId ? (
            <Link
              role="menuitem"
              href={`/admin/drivers`}
              className="block px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              Open drivers
            </Link>
          ) : null}
          {restaurantId ? (
            <Link
              role="menuitem"
              href={`/admin/restaurants`}
              className="block px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              Open restaurants
            </Link>
          ) : null}
          {canManageOrders ? (
            <Link
              role="menuitem"
              href={`/admin/orders/${order.id}#cancel-refund`}
              className="block px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              Cancel / refund (detail)
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
