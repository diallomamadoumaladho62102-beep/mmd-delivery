"use client";

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
  const field =
    "h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900";

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex-1">
          <label htmlFor="taxi-rides-search" className="mb-1.5 block text-sm font-medium text-slate-700">
            Search
          </label>
          <input
            id="taxi-rides-search"
            type="search"
            className={field}
            value={filters.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Ride #, client, driver, phone, email, plate, address…"
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
            <option value="">All statuses</option>
            <option value="searching">Searching Driver</option>
            <option value="accepted">Driver Assigned</option>
            <option value="driver_arrived">Driver Arriving</option>
            <option value="in_progress">Passenger On Board</option>
            <option value="completed">Completed</option>
            <option value="canceled">Cancelled</option>
            <option value="scheduled">Scheduled</option>
            <option value="queued">Queued</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Payment</label>
          <select
            className={field}
            value={filters.payment}
            onChange={(e) => onChange({ payment: e.target.value })}
          >
            <option value="">All payments</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Vehicle class</label>
          <select
            className={field}
            value={filters.vehicle}
            onChange={(e) => onChange({ vehicle: e.target.value })}
          >
            <option value="">All classes</option>
            <option value="standard">Standard</option>
            <option value="xl">XL</option>
            <option value="premium">Premium</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">City</label>
          <select
            className={field}
            value={filters.city}
            onChange={(e) => onChange({ city: e.target.value })}
          >
            <option value="">All cities</option>
            {cityOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Driver online</label>
          <select
            className={field}
            value={filters.online}
            onChange={(e) => onChange({ online: e.target.value })}
          >
            <option value="">All</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
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
            {clientOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
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
            {driverOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">From date</label>
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
          Reset filters
        </button>
      </div>
    </section>
  );
}
