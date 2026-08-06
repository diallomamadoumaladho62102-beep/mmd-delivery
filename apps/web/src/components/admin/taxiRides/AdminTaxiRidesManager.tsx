"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { adminFetch } from "@/lib/adminBrowserAuth";
import {
  DEFAULT_TAXI_RIDE_FILTERS,
  computeTaxiRideKpis,
  filterTaxiRides,
  formatRideMoney,
  parseTaxiRideFiltersFromSearchParams,
  partyDisplayName,
  sortTaxiRidesOps,
  taxiRideFiltersToSearchParams,
  type AdminTaxiRideListItem,
  type TaxiRideListFilters,
} from "@/lib/adminTaxiRideDisplay";
import TaxiRidesList from "./TaxiRidesList";
import TaxiRidesToolbar from "./TaxiRidesToolbar";

export default function AdminTaxiRidesManager() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [items, setItems] = useState<AdminTaxiRideListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const filters = useMemo(
    () => parseTaxiRideFiltersFromSearchParams(searchParams),
    [searchParams]
  );

  const syncFilters = useCallback(
    (next: TaxiRideListFilters) => {
      const qs = taxiRideFiltersToSearchParams(next).toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [pathname, router]
  );

  const loadRides = useCallback(async () => {
    const res = await adminFetch("/api/admin/taxi-rides?limit=100");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      throw new Error(body.error ?? "Failed to load taxi rides");
    }
    setHasMore(Boolean(body.page?.hasMore));
    return (body.items ?? []) as AdminTaxiRideListItem[];
  }, []);

  const loadPage = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      try {
        if (mode === "initial") setLoading(true);
        else setRefreshing(true);
        setError(null);
        setItems(await loadRides());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setItems([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadRides]
  );

  useEffect(() => {
    void loadPage("initial");
  }, [loadPage]);

  const visible = useMemo(
    () => sortTaxiRidesOps(filterTaxiRides(items, filters)),
    [items, filters]
  );

  const kpis = useMemo(() => computeTaxiRideKpis(items), [items]);

  const cityOptions = useMemo(
    () =>
      [...new Set(items.map((r) => r.pickup_city).filter(Boolean) as string[])].sort(),
    [items]
  );

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const ride of items) {
      const id = ride.client?.id || ride.client_user_id || "";
      if (!id) continue;
      map.set(id, partyDisplayName(ride.client, id.slice(0, 8)));
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  const driverOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const ride of items) {
      const id = ride.driver?.id || ride.driver_id || "";
      if (!id) continue;
      map.set(id, partyDisplayName(ride.driver, id.slice(0, 8)));
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            MMD Delivery · Taxi Operations Center
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            Taxi Rides
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Prioritized ops view: client, driver, vehicle, payment, and trip progress.
            Cancel, refund, and payout stay on the ride detail page.
          </p>
          <p className="mt-2 text-sm">
            <Link
              href="/admin/live-map"
              className="font-medium text-slate-700 underline-offset-2 hover:underline"
            >
              Open Live Map
            </Link>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPage("refresh")}
          disabled={refreshing || loading}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <section
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"
        aria-label="Taxi operations KPIs"
      >
        {(
          [
            ["Total Rides", String(kpis.total)],
            ["Active", String(kpis.active)],
            ["Searching Driver", String(kpis.searching)],
            ["Passenger On Board", String(kpis.onBoard)],
            ["Completed", String(kpis.completed)],
            ["Cancelled", String(kpis.canceled)],
            [
              "Revenue Today",
              formatRideMoney(kpis.revenueTodayCents, items[0]?.currency ?? "USD"),
            ],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3.5 shadow-sm"
          >
            <div className="text-[11px] font-medium leading-snug text-slate-500">{label}</div>
            <div className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              {value}
            </div>
          </div>
        ))}
      </section>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      <TaxiRidesToolbar
        filters={filters}
        onChange={(patch) => syncFilters({ ...filters, ...patch })}
        onReset={() => syncFilters({ ...DEFAULT_TAXI_RIDE_FILTERS })}
        cityOptions={cityOptions}
        clientOptions={clientOptions}
        driverOptions={driverOptions}
        resultCount={visible.length}
        totalCount={items.length}
      />

      <div className={isPending ? "opacity-80" : ""}>
        <TaxiRidesList
          items={visible}
          loading={loading}
          hasMore={hasMore}
          onLoadMore={undefined}
        />
      </div>
    </div>
  );
}
