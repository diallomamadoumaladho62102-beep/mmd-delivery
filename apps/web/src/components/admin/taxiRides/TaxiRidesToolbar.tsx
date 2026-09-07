"use client";


import { useAdminT } from "@/i18n/useAdminT";
import type { TaxiRideListFilters } from "@/lib/adminTaxiRideDisplay";

export default function TaxiRidesToolbar({
  filters,
  onChange,
  onReset,
  cityOptions,
  clientOptions,
  driverOptions,
  resultCount,
  totalCount,
}: {
  filters: TaxiRideListFilters;
  onChange: (patch: Partial<TaxiRideListFilters>) => void;
  onReset: () => void;
  cityOptions: string[];
  clientOptions: Array<{ value: string; label: string }>;
  driverOptions: Array<{ value: string; label: string }>;
  resultCount: number;
  totalCount: number;
}) {
  const { t } = useAdminT();

  const field =
    "h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900";

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex-1">
          <label htmlFor="taxi-rides-search" className="mb-1.5 block text-sm font-medium text-slate-700">
            {t("Search")}
          </label>
          <input
            id="taxi-rides-search"
            type="search"
            className={field}
            value={filters.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder={t("Ride #, client, driver, phone, email, plate, address…")}
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
            <option value="">{t("All statuses")}</option>
            <option value="searching">{t("Searching Driver")}</option>
            <option value="accepted">{t("Driver Assigned")}</option>
            <option value="driver_arrived">{t("Driver Arriving")}</option>
            <option value="in_progress">{t("Passenger On Board")}</option>
            <option value="completed">{t("Completed")}</option>
            <option value="canceled">{t("Cancelled")}</option>
            <option value="scheduled">{t("Scheduled")}</option>
            <option value="queued">{t("Queued")}</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Payment")}</label>
          <select
            className={field}
            value={filters.payment}
            onChange={(e) => onChange({ payment: e.target.value })}
          >
            <option value="">{t("All payments")}</option>
            <option value="paid">{t("Paid")}</option>
            <option value="pending">{t("Pending")}</option>
            <option value="failed">{t("Failed")}</option>
            <option value="refunded">{t("Refunded")}</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Vehicle class")}</label>
          <select
            className={field}
            value={filters.vehicle}
            onChange={(e) => onChange({ vehicle: e.target.value })}
          >
            <option value="">{t("All classes")}</option>
            <option value="standard">{t("Standard")}</option>
            <option value="xl">{t("XL")}</option>
            <option value="premium">{t("Premium")}</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("City")}</label>
          <select
            className={field}
            value={filters.city}
            onChange={(e) => onChange({ city: e.target.value })}
          >
            <option value="">{t("All cities")}</option>
            {cityOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Driver online")}</label>
          <select
            className={field}
            value={filters.online}
            onChange={(e) => onChange({ online: e.target.value })}
          >
            <option value="">{t("All")}</option>
            <option value="online">{t("Online")}</option>
            <option value="offline">{t("Offline")}</option>
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
            {clientOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
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
            {driverOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("From date")}</label>
          <input
            type="date"
            className={field}
            value={filters.dateFrom}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t("Reset filters")}
        </button>
      </div>
    </section>
  );
}
