"use client";

import type { AdminFoodOrderListItem } from "@/lib/adminFoodOrderDisplay";
import FoodOrderCard from "./FoodOrderCard";
import FoodOrderCardSkeleton from "./FoodOrderCardSkeleton";

/**
 * Presentational list shell.
 * Ready for future pagination / infinite scroll via optional footer props.
 */
export default function FoodOrdersList({
  items,
  loading,
  canManageOrders,
  emptyMessage,
  hasMore = false,
  onLoadMore,
}: {
  items: AdminFoodOrderListItem[];
  loading: boolean;
  canManageOrders: boolean;
  emptyMessage: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
}) {
  if (loading) {
    return (
      <div
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        aria-busy="true"
        aria-live="polite"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <FoodOrderCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-800">No orders match</p>
        <p className="mt-1 text-sm text-slate-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {items.map((order) => (
          <FoodOrderCard
            key={order.id}
            order={order}
            canManageOrders={canManageOrders}
          />
        ))}
      </div>
      {hasMore && onLoadMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Load more
          </button>
        </div>
      ) : null}
    </div>
  );
}
