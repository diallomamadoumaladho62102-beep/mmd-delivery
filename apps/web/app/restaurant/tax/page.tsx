"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";

type RestaurantTaxRange = "weekly" | "monthly" | "yearly";

type RestaurantTaxProfile = {
  restaurantName: string | null;
  email: string | null;
  taxId: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  isComplete: boolean;
  missingFields: string[];
};

type RestaurantTaxTotals = {
  grossSales: number;
  platformCommission: number;
  restaurantNet: number;
  totalOrders: number;
  year: number;
  range: RestaurantTaxRange;
  commissionRate?: number | null;
  month?: number | null;
  week?: number | null;
};

type RestaurantTaxSummary = {
  restaurantUserId: string;
  year: number;
  range: RestaurantTaxRange;
  month?: number | null;
  week?: number | null;
  generatedAt: string;
  profile: RestaurantTaxProfile;
  totals: RestaurantTaxTotals;
  file: {
    bucket: string;
    path: string;
    signedUrl: string | null;
  } | null;
};

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(value) ? value : 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getInitialWeek(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  const oneWeek = 1000 * 60 * 60 * 24 * 7;

  return clamp(Math.floor(diff / oneWeek) + 1, 1, 53);
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    restaurant_name: "Restaurant name",
    email: "Email",
    tax_id: "Tax ID / EIN",
    address: "Address",
    city: "City",
    postal_code: "Postal code",
    phone: "Phone",
  };

  return labels[field] ?? field;
}

function getRangeLabel(range: RestaurantTaxRange): string {
  if (range === "weekly") return "Weekly";
  if (range === "monthly") return "Monthly";
  return "Yearly";
}

function getPeriodLabel(params: {
  range: RestaurantTaxRange;
  year: number;
  month: number;
  week: number;
}): string {
  const { range, year, month, week } = params;

  if (range === "weekly") return `Week ${week} • ${year}`;
  if (range === "monthly") return `Month ${month} • ${year}`;
  return `Year ${year}`;
}

function getCommissionLabel(rate?: number | null): string {
  const safeRate = Number(rate ?? 0);

  if (!Number.isFinite(safeRate) || safeRate <= 0) {
    return "Platform commission";
  }

  return `Platform commission (${Math.round(safeRate * 100)}%)`;
}

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
      {subtitle ? (
        <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
      ) : null}
    </div>
  );
}

export default function RestaurantTaxPage() {
  const now = new Date();
  const currentYear = now.getFullYear();

  const [range, setRange] = useState<RestaurantTaxRange>("yearly");
  const [year, setYear] = useState<number>(currentYear);
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [week, setWeek] = useState<number>(getInitialWeek());

  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<RestaurantTaxSummary | null>(null);

  const years = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => currentYear - index);
  }, [currentYear]);

  const selectedPeriodLabel = useMemo(
    () => getPeriodLabel({ range, year, month, week }),
    [range, year, month, week]
  );

  const queryString = useMemo(() => {
    const params = new URLSearchParams();

    params.set("range", range);
    params.set("year", String(year));

    if (range === "monthly") {
      params.set("month", String(month));
    }

    if (range === "weekly") {
      params.set("week", String(week));
    }

    return params.toString();
  }, [range, year, month, week]);

  async function fetchSummary(download = false) {
    setErr(null);
    download ? setDownloading(true) : setLoading(true);

    try {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        throw new Error(error.message);
      }

      const token = data.session?.access_token;

      if (!token) {
        throw new Error("No session. Please sign in.");
      }

      const res = await fetch(
        `/api/restaurant/tax/summary?${queryString}${download ? "&download=1" : ""}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.error ?? "Failed to load restaurant tax summary");
      }

      const nextSummary = json as RestaurantTaxSummary;
      setSummary(nextSummary);

      if (download) {
        const signedUrl = nextSummary?.file?.signedUrl;

        if (!signedUrl) {
          throw new Error("PDF download link was not returned.");
        }

        window.open(signedUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error: any) {
      setErr(error?.message ?? "Unexpected error");
    } finally {
      setLoading(false);
      setDownloading(false);
    }
  }

  useEffect(() => {
    void fetchSummary(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  function selectRange(nextRange: RestaurantTaxRange) {
    setRange(nextRange);
    setSummary(null);
    setErr(null);
  }

  function changeMonth(delta: number) {
    setMonth((prev) => clamp(prev + delta, 1, 12));
    setSummary(null);
    setErr(null);
  }

  function changeWeek(delta: number) {
    setWeek((prev) => clamp(prev + delta, 1, 53));
    setSummary(null);
    setErr(null);
  }

  function changeYear(nextYear: number) {
    setYear(nextYear);
    setSummary(null);
    setErr(null);
  }

  const profile = summary?.profile ?? null;
  const totals = summary?.totals ?? null;
  const commissionLabel = getCommissionLabel(totals?.commissionRate);
  const hasOrders = (totals?.totalOrders ?? 0) > 0;

  const profileStatusBadge = profile?.isComplete ? (
    <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
      Ready for documents
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1 text-xs font-medium text-yellow-800">
      Profile incomplete
    </span>
  );

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-10">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-3xl border bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium text-gray-600">
                Restaurant finance
              </div>

              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
                  Restaurant Tax Center
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-gray-600">
                  Review weekly, monthly and yearly restaurant earnings,
                  commissions, tax profile information, and downloadable PDF
                  documents for MMD Delivery.
                </p>
              </div>

              {profile ? profileStatusBadge : null}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/restaurant/profile"
                className="inline-flex items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Update restaurant profile
              </Link>

              <button
                onClick={() => fetchSummary(true)}
                disabled={loading || downloading || !summary}
                className="inline-flex items-center justify-center rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {downloading ? "Preparing PDF..." : "Download PDF"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">
                Reporting period
              </p>
              <p className="text-xs text-gray-500">
                Select weekly, monthly or yearly reporting. PDF downloads follow
                the selected period.
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex rounded-xl border bg-gray-50 p-1">
                {(["weekly", "monthly", "yearly"] as RestaurantTaxRange[]).map(
                  (item) => {
                    const active = range === item;

                    return (
                      <button
                        key={item}
                        onClick={() => selectRange(item)}
                        className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                          active
                            ? "bg-black text-white shadow-sm"
                            : "text-gray-600 hover:bg-white"
                        }`}
                      >
                        {getRangeLabel(item)}
                      </button>
                    );
                  }
                )}
              </div>

              <select
                value={year}
                onChange={(event) => changeYear(Number(event.target.value))}
                className="rounded-xl border px-3 py-2 text-sm"
              >
                {years.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              {range === "monthly" ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => changeMonth(-1)}
                    className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    -1 month
                  </button>

                  <span className="min-w-24 rounded-xl border bg-gray-50 px-3 py-2 text-center text-sm font-semibold">
                    Month {month}
                  </span>

                  <button
                    onClick={() => changeMonth(1)}
                    className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    +1 month
                  </button>
                </div>
              ) : null}

              {range === "weekly" ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => changeWeek(-1)}
                    className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    -1 week
                  </button>

                  <span className="min-w-24 rounded-xl border bg-gray-50 px-3 py-2 text-center text-sm font-semibold">
                    Week {week}
                  </span>

                  <button
                    onClick={() => changeWeek(1)}
                    className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    +1 week
                  </button>
                </div>
              ) : null}

              <button
                onClick={() => fetchSummary(false)}
                disabled={loading}
                className="rounded-xl border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
            Selected period: {selectedPeriodLabel}
          </div>
        </div>

        {err ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500">Loading tax center...</p>
          </div>
        ) : summary ? (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Gross sales"
                value={money(totals?.grossSales ?? 0)}
                subtitle={selectedPeriodLabel}
              />
              <StatCard
                title={commissionLabel}
                value={money(totals?.platformCommission ?? 0)}
                subtitle="Configured from Admin Pricing"
              />
              <StatCard
                title="Restaurant net"
                value={money(totals?.restaurantNet ?? 0)}
                subtitle="Estimated net after platform commission"
              />
              <StatCard
                title="Total orders"
                value={String(totals?.totalOrders ?? 0)}
                subtitle="Completed / included orders"
              />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
              <section className="rounded-2xl border bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      Tax profile
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">
                      Restaurant tax identity and reporting information.
                    </p>
                  </div>
                  {profileStatusBadge}
                </div>

                {profile?.isComplete ? (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl bg-gray-50 p-4">
                      <p className="text-xs text-gray-500">Restaurant name</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        {profile.restaurantName ?? "—"}
                      </p>
                    </div>

                    <div className="rounded-xl bg-gray-50 p-4">
                      <p className="text-xs text-gray-500">Email</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        {profile.email ?? "—"}
                      </p>
                    </div>

                    <div className="rounded-xl bg-gray-50 p-4">
                      <p className="text-xs text-gray-500">Tax ID / EIN</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        {profile.taxId ?? "—"}
                      </p>
                    </div>

                    <div className="rounded-xl bg-gray-50 p-4">
                      <p className="text-xs text-gray-500">Phone</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        {profile.phone ?? "—"}
                      </p>
                    </div>

                    <div className="rounded-xl bg-gray-50 p-4 sm:col-span-2">
                      <p className="text-xs text-gray-500">Address</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        {[profile.address, profile.city, profile.postalCode]
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-yellow-200 bg-yellow-50 p-5">
                    <p className="text-sm font-medium text-yellow-900">
                      Your tax profile is not complete yet
                    </p>
                    <p className="mt-1 text-sm text-yellow-800">
                      Complete your restaurant profile before generating official
                      reporting documents.
                    </p>

                    <div className="mt-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-yellow-900">
                        Missing fields
                      </p>

                      <div className="mt-2 flex flex-wrap gap-2">
                        {profile?.missingFields.map((field) => (
                          <span
                            key={field}
                            className="rounded-full border border-yellow-300 bg-white px-3 py-1 text-xs text-yellow-900"
                          >
                            {fieldLabel(field)}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4">
                      <Link
                        href="/restaurant/profile"
                        className="inline-flex items-center rounded-xl bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                      >
                        Complete profile
                      </Link>
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900">
                  Tax documents
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Download your restaurant summary PDF for the selected period.
                </p>

                {hasOrders ? (
                  <div className="mt-5 rounded-2xl border bg-gray-50 p-5">
                    <p className="text-sm font-medium text-gray-900">
                      Summary for {selectedPeriodLabel}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      Gross sales: {money(totals?.grossSales ?? 0)}
                    </p>
                    <p className="text-sm text-gray-600">
                      Commission: {money(totals?.platformCommission ?? 0)}
                    </p>
                    <p className="text-sm text-gray-600">
                      Restaurant net: {money(totals?.restaurantNet ?? 0)}
                    </p>

                    <button
                      onClick={() => fetchSummary(true)}
                      disabled={downloading}
                      className="mt-4 inline-flex items-center rounded-xl bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                    >
                      {downloading
                        ? "Preparing PDF..."
                        : `Download ${selectedPeriodLabel} PDF`}
                    </button>
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-dashed bg-gray-50 p-5">
                    <p className="text-sm font-medium text-gray-900">
                      No earnings data for {selectedPeriodLabel}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      Once restaurant orders are recorded for this period, your
                      summary and PDF download will appear here.
                    </p>
                  </div>
                )}

                <div className="mt-5 rounded-2xl bg-blue-50 p-4">
                  <p className="text-sm font-medium text-blue-900">
                    Connected to your Admin Pricing restaurant commission model
                  </p>
                  <p className="mt-1 text-sm text-blue-800">
                    This page uses the active restaurant commission configured in
                    admin pricing: gross sales → platform commission →
                    restaurant net.
                  </p>
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500">No data available.</p>
          </div>
        )}
      </div>
    </main>
  );
}
