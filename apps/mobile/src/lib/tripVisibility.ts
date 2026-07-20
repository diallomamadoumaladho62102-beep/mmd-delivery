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

/** PostgREST chain for production-visible trips. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyLiveTripFilters<T extends { eq: any; is: any; or: any }>(
  query: T,
): T {
  return query
    .eq("is_test", false)
    .is("archived_at", null)
    .or("hidden_from_user.is.null,hidden_from_user.eq.false") as T;
}
