/**
 * Exclude soft-archived / test trips from normal client, driver, and admin queries.
 * Columns: is_test, hidden_from_user, archived_at (added in 20260914120000).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type TripVisibilityFlags = {
  is_test?: boolean | null;
  hidden_from_user?: boolean | null;
  archived_at?: string | null;
};

export function isLiveVisibleTrip(row: TripVisibilityFlags | null | undefined): boolean {
  if (!row) return false;
  if (row.is_test === true) return false;
  if (row.hidden_from_user === true) return false;
  if (row.archived_at) return false;
  return true;
}

/**
 * Apply PostgREST filters for production-visible trips.
 * Chain after .from(...).select(...) and before .eq(driver_id) etc. as needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyLiveTripFilters<T extends { eq: any; is: any; or: any }>(
  query: T,
): T {
  return query
    .eq("is_test", false)
    .is("archived_at", null)
    .or("hidden_from_user.is.null,hidden_from_user.eq.false") as T;
}

/** Query param for admin APIs: default live-only; include_test=1 shows archived/test. */
export function shouldIncludeTestTrips(searchParams: URLSearchParams | { get: (k: string) => string | null }): boolean {
  const raw = String(searchParams.get("include_test") ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function normalizeTripParentType(raw: unknown): "order" | "delivery_request" | "taxi_ride" | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (["order", "orders", "food", "food_order"].includes(value)) return "order";
  if (["delivery_request", "delivery_requests", "package", "delivery"].includes(value)) {
    return "delivery_request";
  }
  if (["taxi_ride", "taxi_rides", "taxi"].includes(value)) return "taxi_ride";
  return null;
}

/**
 * Keep finance/child rows whose trip parent is live-visible.
 * Non-trip parents (marketplace, adjustments, etc.) pass through.
 */
export async function filterRowsByLiveTripParent<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  rows: T[],
  opts?: { typeKey?: string; idKey?: string },
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const typeKey = opts?.typeKey ?? "source_type";
  const idKey = opts?.idKey ?? "source_id";

  const byType: Record<"order" | "delivery_request" | "taxi_ride", Set<string>> = {
    order: new Set(),
    delivery_request: new Set(),
    taxi_ride: new Set(),
  };

  for (const row of rows) {
    const kind = normalizeTripParentType(row[typeKey] ?? row.vertical);
    const id = String(row[idKey] ?? "").trim();
    if (kind && id) byType[kind].add(id);
  }

  const liveIds = new Set<string>();

  const loadLive = async (
    table: "orders" | "delivery_requests" | "taxi_rides",
    ids: string[],
  ) => {
    if (ids.length === 0) return;
    const { data } = await applyLiveTripFilters(
      supabase.from(table).select("id"),
    ).in("id", ids);
    for (const row of data ?? []) {
      liveIds.add(String((row as { id: string }).id));
    }
  };

  await Promise.all([
    loadLive("orders", [...byType.order]),
    loadLive("delivery_requests", [...byType.delivery_request]),
    loadLive("taxi_rides", [...byType.taxi_ride]),
  ]);

  return rows.filter((row) => {
    const kind = normalizeTripParentType(row[typeKey] ?? row.vertical);
    const id = String(row[idKey] ?? "").trim();
    if (!kind || !id) return true;
    return liveIds.has(id);
  });
}
