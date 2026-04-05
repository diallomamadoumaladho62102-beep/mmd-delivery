"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";

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
};

type RestaurantTaxSummary = {
  restaurantUserId: string;
  year: number;
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
  }).format(value ?? 0);
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    restaurant_name: "Restaurant name",
    email: "Email",
    tax_id: "Tax ID / EIN",
    address: "Address",
    city: "City",
    postal_code: "Postal code",
  };

  return labels[field] ?? field;
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
      {subtitle ? <p className="mt-1 text-xs text-gray-500">{subtitle}</p> : null}
    </div>
  );
}

export default function RestaurantTaxPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);

  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<RestaurantTaxSummary | null>(null);

  const years = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => currentYear - i);
  }, [currentYear]);

  async function fetchSummary(download = false) {
    setErr(null);
    download ? setDownloading(true) : setLoading(true);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        throw new Error("No session. Please sign in.");
      }

      const res = await fetch(
        `/api/restaurant/tax/summary?year=${year}${download ? "&download=1" : ""}`,
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

      setSummary(json);

      if (download && json?.file?.signedUrl) {
        window.open(json.file.signedUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error: any) {
      setErr(error?.message ?? "Unexpected error");
    } finally {
      setLoading(false);
      setDownloading(false);
    }
  }

  useEffect(() => {
    fetchSummary(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const profile = summary?.profile ?? null;
  const totals = summary?.totals ?? null;

  const profileStatusBadge = profile?.isComplete ? (
    <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
      Ready for yearly tax documents
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1 text-xs font-medium text-yellow-800">
      Profile incomplete
    </span>
  );

  return (
    <main className="min-h-screen p-6 md:p-10">
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
                  Manage your restaurant tax information, review yearly earnings,
                  and prepare downloadable tax documents for MMD Delivery.
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
                {downloading ? "Preparing PDF..." : "Download tax PDF"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Reporting year</p>
            <p className="text-xs text-gray-500">
              Switch the year to review earnings and generate the matching PDF.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-xl border px-3 py-2 text-sm"
            >
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <button
              onClick={() => fetchSummary(false)}
              disabled={loading}
              className="rounded-xl border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Refresh
            </button>
          </div>
        </div>

        {err ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 grid gap-6">
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">Loading tax center...</p>
            </div>
          </div>
        ) : summary ? (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Gross sales"
                value={money(totals?.grossSales ?? 0)}
                subtitle={`Year ${year}`}
              />
              <StatCard
                title="Platform commission"
                value={money(totals?.platformCommission ?? 0)}
                subtitle="15% MMD Delivery commission"
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
                      yearly tax documents.
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
                  Yearly tax documents
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Download your restaurant tax summary PDF for the selected year.
                </p>

                {(totals?.totalOrders ?? 0) > 0 ? (
                  <div className="mt-5 rounded-2xl border bg-gray-50 p-5">
                    <p className="text-sm font-medium text-gray-900">
                      Tax summary for {year}
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
                      {downloading ? "Preparing PDF..." : `Download ${year} PDF`}
                    </button>
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-dashed bg-gray-50 p-5">
                    <p className="text-sm font-medium text-gray-900">
                      No earnings data for {year}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      Once restaurant orders are recorded for this year, your tax
                      summary and PDF download will appear here.
                    </p>
                  </div>
                )}

                <div className="mt-5 rounded-2xl bg-blue-50 p-4">
                  <p className="text-sm font-medium text-blue-900">
                    Connected to your 15% restaurant commission model
                  </p>
                  <p className="mt-1 text-sm text-blue-800">
                    This page uses your restaurant commission logic:
                    gross sales → 15% platform commission → restaurant net.
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