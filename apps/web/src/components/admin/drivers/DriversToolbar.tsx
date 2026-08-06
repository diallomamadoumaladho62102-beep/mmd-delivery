"use client";

import type { DriverSortFilters } from "@/lib/adminDriverDisplay";

export default function DriversToolbar({
  filters,
  onChange,
  onReset,
  cityOptions,
  stateOptions,
  resultCount,
  totalCount,
}: {
  filters: DriverSortFilters;
  onChange: (patch: Partial<DriverSortFilters>) => void;
  onReset: () => void;
  cityOptions: string[];
  stateOptions: string[];
  resultCount: number;
  totalCount: number;
}) {
  const field =
    "h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900";

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex-1">
          <label htmlFor="drivers-search" className="mb-1.5 block text-sm font-medium text-slate-700">
            Search
          </label>
          <input
            id="drivers-search"
            type="search"
            className={field}
            value={filters.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Name, email, phone, plate, city, license…"
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
            <option value="pending">Pending</option>
            <option value="incomplete">Incomplete</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="suspended">Suspended</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Mode</label>
          <select
            className={field}
            value={filters.mode}
            onChange={(e) => onChange({ mode: e.target.value })}
          >
            <option value="">All modes</option>
            <option value="car">Car</option>
            <option value="bike">Bike</option>
            <option value="moto">Moto / Scooter</option>
            <option value="other">Other</option>
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
          <label className="mb-1.5 block text-sm font-medium text-slate-700">State</label>
          <select
            className={field}
            value={filters.state}
            onChange={(e) => onChange({ state: e.target.value })}
          >
            <option value="">All states</option>
            {stateOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Online</label>
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
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Stripe Identity
          </label>
          <select
            className={field}
            value={filters.identity}
            onChange={(e) => onChange({ identity: e.target.value })}
          >
            <option value="">All</option>
            <option value="verified">Verified</option>
            <option value="pending">Pending</option>
            <option value="not_started">Not started</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Joined from</label>
          <input
            type="date"
            className={field}
            value={filters.dateFrom}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Min completeness %
          </label>
          <input
            type="number"
            min={0}
            max={100}
            className={field}
            value={filters.minCompleteness}
            onChange={(e) => onChange({ minCompleteness: e.target.value })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={filters.docsIncomplete}
            onChange={(e) => onChange({ docsIncomplete: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300"
          />
          Incomplete documents only
        </label>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Reset filters
        </button>
      </div>
    </section>
  );
}
