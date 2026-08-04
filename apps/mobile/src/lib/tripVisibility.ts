/**
 * Exclude soft-archived / test trips from normal client & driver queries.
 */

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
 * PostgREST chain for production-visible trips.
 *
 * Avoids `.or()` so subsequent ownership `.or(...)` calls on the same query
 * do not overwrite the visibility predicate. Soft-archive always sets
 * `is_test=true` + `archived_at`, so those two alone hide archived rows;
 * `hidden_from_user` is enforced client-side via `isLiveVisibleTrip`.
 */
export function applyLiveTripFilters<T extends { eq: any; is: any; or: any }>(
  query: T,
): T {
  return query.eq("is_test", false).is("archived_at", null) as T;
}
