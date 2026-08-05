"use client";

import type {
  FoodOrderListFilters,
  FoodOrderSortDir,
  FoodOrderSortKey,
} from "@/lib/adminFoodOrderDisplay";

type Option = { value: string; label: string };

const STATUS_OPTIONS: Option[] = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "prepared", label: "Preparing" },
  { value: "ready", label: "Ready" },
  { value: "dispatched", label: "On the way" },
  { value: "delivered", label: "Delivered" },
  { value: "canceled", label: "Cancelled" },
];

const PAYMENT_OPTIONS: Option[] = [
  { value: "", label: "All payments" },
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
];

const KIND_OPTIONS: Option[] = [
  { value: "", label: "All kinds" },
  { value: "food", label: "Food" },
  { value: "package", label: "Package" },
  { value: "delivery", label: "Delivery" },
];

const SORT_OPTIONS: Array<{ value: FoodOrderSortKey; label: string }> = [
  { value: "date", label: "Date" },
  { value: "amount", label: "Amount" },
  { value: "client", label: "Client" },
  { value: "restaurant", label: "Restaurant" },
  { value: "status", label: "Status" },
];

export default function FoodOrdersToolbar({
  filters,
  onChange,
  onReset,
  restaurantOptions,
  clientOptions,
  driverOptions,
  resultCount,
  totalCount,
}: {
  filters: FoodOrderListFilters;
  onChange: (patch: Partial<FoodOrderListFilters>) => void;
  onReset: () => void;
  restaurantOptions: Option[];
  clientOptions: Option[];
  driverOptions: Option[];
  resultCount: number;
  totalCount: number;
}) {
  const field =
    "h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-500";

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex-1">
          <label htmlFor="food-orders-search" className="mb-1.5 block text-sm font-medium text-slate-700">
            Search
          </label>
          <input
            id="food-orders-search"
            type="search"
            value={filters.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Order ID, client, restaurant, phone, address…"
            className={field}
          />
        </div>
        <div className="text-sm text-slate-600 lg:pb-2">
          Showing <span className="font-semibold text-slate-900">{resultCount}</span> of{" "}
          <span className="font-semibold text-slate-900">{totalCount}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Status</label>
          <select
            className={field}
            value={filters.status}
            onChange={(e) => onChange({ status: e.target.value })}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Payment</label>
          <select
            className={field}
            value={filters.payment}
            onChange={(e) => onChange({ payment: e.target.value })}
          >
            {PAYMENT_OPTIONS.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Kind</label>
          <select
            className={field}
            value={filters.kind}
            onChange={(e) => onChange({ kind: e.target.value })}
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value || "all-kinds"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Restaurant</label>
          <select
            className={field}
            value={filters.restaurantId}
            onChange={(e) => onChange({ restaurantId: e.target.value })}
          >
            <option value="">All restaurants</option>
            {restaurantOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Client</label>
          <select
            className={field}
            value={filters.clientId}
            onChange={(e) => onChange({ clientId: e.target.value })}
          >
            <option value="">All clients</option>
            {clientOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Driver</label>
          <select
            className={field}
            value={filters.driverId}
            onChange={(e) => onChange({ driverId: e.target.value })}
          >
            <option value="">All drivers</option>
            {driverOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">From</label>
          <input
            type="date"
            className={field}
            value={filters.dateFrom}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">To</label>
          <input
            type="date"
            className={field}
            value={filters.dateTo}
            onChange={(e) => onChange({ dateTo: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Min $</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className={field}
              value={filters.minAmount}
              onChange={(e) => onChange({ minAmount: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Max $</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className={field}
              value={filters.maxAmount}
              onChange={(e) => onChange({ maxAmount: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid grid-cols-2 gap-3 sm:w-[28rem]">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Sort by</label>
            <select
              className={field}
              value={filters.sort}
              onChange={(e) => onChange({ sort: e.target.value as FoodOrderSortKey })}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Direction</label>
            <select
              className={field}
              value={filters.dir}
              onChange={(e) => onChange({ dir: e.target.value as FoodOrderSortDir })}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Reset filters
        </button>
      </div>
    </section>
  );
}
