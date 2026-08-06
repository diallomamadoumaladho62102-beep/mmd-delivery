"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  rideStatusActions,
  type AdminTaxiRideListItem,
} from "@/lib/adminTaxiRideDisplay";

/**
 * Navigation-only actions (Food Orders menu pattern).
 * Cancel / refund / payout stay on the ride detail page.
 */
export default function TaxiRideActionsMenu({
  ride,
}: {
  ride: AdminTaxiRideListItem;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const actions = rideStatusActions(ride);

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

  async function copyRideId() {
    try {
      await navigator.clipboard.writeText(ride.id);
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
        aria-label="Ride actions"
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
          <button type="button" role="menuitem" className={itemClass} onClick={() => void copyRideId()}>
            {copied ? "ID copied" : "Copy ride ID"}
          </button>
          {actions.map((action) => (
            <Link
              key={action.key}
              role="menuitem"
              href={action.href}
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
