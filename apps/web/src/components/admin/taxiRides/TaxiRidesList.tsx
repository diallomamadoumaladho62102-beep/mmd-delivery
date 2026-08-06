"use client";

import type { AdminTaxiRideListItem } from "@/lib/adminTaxiRideDisplay";
import TaxiRideCardSkeleton from "./TaxiRideCardSkeleton";
import TaxiRideOpsCard from "./TaxiRideOpsCard";

/**
 * Presentational list shell — ready for future selection / infinite scroll props.
 */
export default function TaxiRidesList({
  items,
  loading,
  hasMore = false,
  onLoadMore,
  selectedIds,
  onToggleSelect,
}: {
  items: AdminTaxiRideListItem[];
  loading: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (rideId: string) => void;
}) {
  void selectedIds;
  void onToggleSelect;

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <TaxiRideCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-800">No rides match</p>
        <p className="mt-1 text-sm text-slate-500">Try clearing filters or refreshing.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {items.map((ride) => (
          <TaxiRideOpsCard key={ride.id} ride={ride} />
        ))}
      </div>
      {hasMore && onLoadMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            Load more
          </button>
        </div>
      ) : null}
    </div>
  );
}
