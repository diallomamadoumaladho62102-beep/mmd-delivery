"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { canManageOrders } from "@/lib/adminAccess";
import { normalizeUserRole } from "@/lib/roles";
import { supabase } from "@/lib/supabaseBrowser";
import {
  DEFAULT_FOOD_ORDER_FILTERS,
  filterFoodOrders,
  filtersToSearchParams,
  parseFiltersFromSearchParams,
  partyDisplayName,
  sortFoodOrders,
  type AdminFoodOrderListItem,
  type FoodOrderListFilters,
} from "@/lib/adminFoodOrderDisplay";
import FoodOrdersList from "./FoodOrdersList";
import FoodOrdersToolbar from "./FoodOrdersToolbar";

function optionLabel(name: string | null | undefined, id: string): string {
  const n = String(name ?? "").trim();
  return n || id.slice(0, 8);
}

function partyOptionLabel(
  party: AdminFoodOrderListItem["client"] | AdminFoodOrderListItem["driver"],
  id: string
): string {
  return partyDisplayName(party ? { ...party, id: party.id || id } : { id, full_name: null, email: null, phone: null, avatar_url: null, account_kind: null }, id.slice(0, 8));
}

export default function AdminFoodOrdersManager() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [items, setItems] = useState<AdminFoodOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staffRole, setStaffRole] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const filters = useMemo(
    () => parseFiltersFromSearchParams(searchParams),
    [searchParams]
  );

  const manageOrders = canManageOrders(normalizeUserRole(staffRole));

  const syncFilters = useCallback(
    (next: FoodOrderListFilters) => {
      const params = filtersToSearchParams(next);
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [pathname, router]
  );

  const patchFilters = useCallback(
    (patch: Partial<FoodOrderListFilters>) => {
      syncFilters({ ...filters, ...patch });
    },
    [filters, syncFilters]
  );

  const loadOrders = useCallback(async (statusFilter: string) => {
    const url = new URL("/api/admin/orders", window.location.origin);
    url.searchParams.set("limit", "100");
    // Keep existing server status filter; remaining filters stay client-side.
    if (statusFilter) url.searchParams.set("status", statusFilter);

    const res = await adminFetch(url.toString());
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      throw new Error(body.error ?? "Failed to load orders");
    }
    setHasMore(Boolean(body.page?.hasMore));
    return (body.items ?? []) as AdminFoodOrderListItem[];
  }, []);

  const loadPage = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      try {
        if (mode === "initial") setLoading(true);
        else setRefreshing(true);
        setError(null);
        const orders = await loadOrders(filters.status);
        setItems(orders);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setItems([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadOrders, filters.status]
  );

  useEffect(() => {
    void loadPage("initial");
  }, [loadPage]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId || cancelled) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();
      if (!cancelled) setStaffRole(profile?.role ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const filtered = filterFoodOrders(items, filters);
    return sortFoodOrders(filtered, filters.sort, filters.dir);
  }, [items, filters]);

  const restaurantOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const order of items) {
      const id =
        order.restaurant?.id || order.restaurant_user_id || order.restaurant_id || "";
      if (!id) continue;
      map.set(id, optionLabel(order.restaurant?.name || order.restaurant_name, id));
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const order of items) {
      const id =
        order.client?.id || order.client_id || order.client_user_id || order.user_id || "";
      if (!id) continue;
      map.set(id, partyOptionLabel(order.client, id));
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  const driverOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const order of items) {
      const id = order.driver?.id || order.driver_id || "";
      if (!id) continue;
      map.set(id, partyOptionLabel(order.driver, id));
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
            MMD Delivery · Admin Food Orders
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            Food orders
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Enterprise list view with search, filters, and order progress. Status and
            payment changes stay on the detail page.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPage("refresh")}
          disabled={refreshing || loading}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-sm"
        >
          <p className="font-medium">Could not load orders</p>
          <p className="mt-1">{error}</p>
          <button
            type="button"
            onClick={() => void loadPage("refresh")}
            className="mt-3 inline-flex h-9 items-center rounded-lg border border-red-300 bg-white px-3 text-sm font-medium text-red-800"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <FoodOrdersToolbar
            filters={filters}
            onChange={patchFilters}
            onReset={() => syncFilters({ ...DEFAULT_FOOD_ORDER_FILTERS })}
            restaurantOptions={restaurantOptions}
            clientOptions={clientOptions}
            driverOptions={driverOptions}
            resultCount={visible.length}
            totalCount={items.length}
          />
          <div className={isPending ? "opacity-80 transition-opacity" : ""}>
            <FoodOrdersList
              items={visible}
              loading={loading}
              canManageOrders={manageOrders}
              emptyMessage="Try clearing filters or refreshing the list."
              hasMore={hasMore && !filters.q && !filters.status}
              // Hook reserved for future pagination; current API returns one page.
              onLoadMore={undefined}
            />
          </div>
          {manageOrders ? (
            <p className="text-xs text-slate-500">
              Cancel/refund actions are available on each order detail page.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
