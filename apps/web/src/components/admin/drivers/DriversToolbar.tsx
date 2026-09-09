"use client";


import { useAdminT } from "@/i18n/useAdminT";
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
  const { t } = useAdminT();

  const field =
    "h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900";

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex-1">
          <label htmlFor="drivers-search" className="mb-1.5 block text-sm font-medium text-slate-700">
            {t("Search")}
          </label>
          <input
            id="drivers-search"
            type="search"
            className={field}
            value={filters.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder={t("Name, email, phone, plate, city, license…")}
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
            <option value="pending">{t("Pending")}</option>
            <option value="incomplete">{t("Incomplete")}</option>
            <option value="approved">{t("Approved")}</option>
            <option value="rejected">{t("Rejected")}</option>
            <option value="suspended">{t("Suspended")}</option>
            <option value="disabled">{t("Disabled")}</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Mode")}</label>
          <select
            className={field}
            value={filters.mode}
            onChange={(e) => onChange({ mode: e.target.value })}
          >
            <option value="">{t("All modes")}</option>
            <option value="car">{t("Car")}</option>
            <option value="bike">{t("Bike")}</option>
            <option value="moto">{t("Moto / Scooter")}</option>
            <option value="other">{t("Other")}</option>
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
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("State")}</label>
          <select
            className={field}
            value={filters.state}
            onChange={(e) => onChange({ state: e.target.value })}
          >
            <option value="">{t("All states")}</option>
            {stateOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Online")}</label>
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
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            {t("Stripe Identity")}
          </label>
          <select
            className={field}
            value={filters.identity}
            onChange={(e) => onChange({ identity: e.target.value })}
          >
            <option value="">{t("All")}</option>
            <option value="verified">{t("Verified")}</option>
            <option value="pending">{t("Pending")}</option>
            <option value="not_started">{t("Not started")}</option>
            <option value="failed">{t("Failed")}</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("Joined from")}</label>
          <input
            type="date"
            className={field}
            value={filters.dateFrom}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            {t("Min completeness %")}
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
          {t("Incomplete documents only")}
        </label>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t("Reset filters")}
        </button>
      </div>
    </section>
  );
}
