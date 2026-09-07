"use client";


import { useAdminT } from "@/i18n/useAdminT";
import type {
  FoodOrderListFilters,
  FoodOrderSortDir,
  FoodOrderSortKey,
} from "@/lib/adminFoodOrderDisplay";

type Option = { value: string; label: string };

function toolbarOptions(t: (source: string) => string) {
  const statusOptions: Option[] = [
    { value: "", label: t("All statuses") },
    { value: "pending", label: t("Pending") },
    { value: "accepted", label: t("Accepted") },
    { value: "prepared", label: t("Preparing") },
    { value: "ready", label: t("Ready") },
    { value: "dispatched", label: t("On the way") },
    { value: "delivered", label: t("Delivered") },
    { value: "canceled", label: t("Cancelled") },
  ];
  const paymentOptions: Option[] = [
    { value: "", label: t("All payments") },
    { value: "paid", label: t("Paid") },
    { value: "pending", label: t("Pending") },
    { value: "failed", label: t("Failed") },
    { value: "refunded", label: t("Refunded") },
  ];
  const kindOptions: Option[] = [
    { value: "", label: t("All kinds") },
    { value: "food", label: t("Food") },
    { value: "package", label: t("Package") },
    { value: "delivery", label: t("Delivery") },
  ];
  const sortOptions: Array<{ value: FoodOrderSortKey; label: string }> = [
    { value: "date", label: t("Date") },
    { value: "amount", label: t("Amount") },
    { value: "client", label: t("Client") },
    { value: "restaurant", label: t("Restaurant") },
    { value: "status", label: t("Status") },
  ];
  return { statusOptions, paymentOptions, kindOptions, sortOptions };
}

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
  const { t } = useAdminT();
  const { statusOptions, paymentOptions, kindOptions, sortOptions } = toolbarOptions(t);

  const field =
    "h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900";

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex-1">
          <label htmlFor="food-orders-search" className="mb-1.5 block text-sm font-medium text-slate-700">
            {t("Search")}
          </label>
          <input
            id="food-orders-search"
            type="search"
            value={filters.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder={t("Order ID, client, restaurant, phone, address…")}
            className={field}
          />
        </div>
        <div className="text-sm text-slate-600 lg:pb-2">
          {t("Showing")} <span className="font-semibold text-slate-900">{resultCount}</span> of{" "}
          <span className="font-semibold text-slate-900">{totalCount}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Status")}</label>
          <select
            className={field}
            value={filters.status}
            onChange={(e) => onChange({ status: e.target.value })}
          >
            {statusOptions.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Payment")}</label>
          <select
            className={field}
            value={filters.payment}
            onChange={(e) => onChange({ payment: e.target.value })}
          >
            {paymentOptions.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Kind")}</label>
          <select
            className={field}
            value={filters.kind}
            onChange={(e) => onChange({ kind: e.target.value })}
          >
            {kindOptions.map((opt) => (
              <option key={opt.value || "all-kinds"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Restaurant")}</label>
          <select
            className={field}
            value={filters.restaurantId}
            onChange={(e) => onChange({ restaurantId: e.target.value })}
          >
            <option value="">{t("All restaurants")}</option>
            {restaurantOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Client")}</label>
          <select
            className={field}
            value={filters.clientId}
            onChange={(e) => onChange({ clientId: e.target.value })}
          >
            <option value="">{t("All clients")}</option>
            {clientOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Driver")}</label>
          <select
            className={field}
            value={filters.driverId}
            onChange={(e) => onChange({ driverId: e.target.value })}
          >
            <option value="">{t("All drivers")}</option>
            {driverOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("From")}</label>
          <input
            type="date"
            className={field}
            value={filters.dateFrom}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("To")}</label>
          <input
            type="date"
            className={field}
            value={filters.dateTo}
            onChange={(e) => onChange({ dateTo: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Min $")}</label>
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
            <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Max $")}</label>
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
            <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Sort by")}</label>
            <select
              className={field}
              value={filters.sort}
              onChange={(e) => onChange({ sort: e.target.value as FoodOrderSortKey })}
            >
              {sortOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Direction")}</label>
            <select
              className={field}
              value={filters.dir}
              onChange={(e) => onChange({ dir: e.target.value as FoodOrderSortDir })}
            >
              <option value="desc">{t("Descending")}</option>
              <option value="asc">{t("Ascending")}</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t("Reset filters")}
        </button>
      </div>
    </section>
  );
}
