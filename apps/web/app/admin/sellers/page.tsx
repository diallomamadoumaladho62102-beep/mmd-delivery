"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canReviewSellers } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type SellerStatus = "pending" | "approved" | "rejected" | "suspended";

type SellerRow = {
  id: string;
  user_id: string;
  business_name: string;
  country_code: string;
  city: string;
  address: string;
  phone: string;
  region_code: string | null;
  status: SellerStatus;
  review_notes: string | null;
  created_at: string;
  profiles?: { full_name?: string | null; email?: string | null } | null;
};

export default function AdminSellersPage() {
  const [rows, setRows] = useState<SellerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canReviewSellers(session?.role ?? null));
    const qs = statusFilter !== "all" ? `?status=${encodeURIComponent(statusFilter)}` : "";
    const res = await adminFetch(`/api/admin/sellers${qs}`);
    const body = await res.json().catch(() => ({}));
    setRows(body.items ?? []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredCount = useMemo(() => rows.length, [rows]);

  async function reviewSeller(sellerId: string, status: "approved" | "rejected" | "suspended") {
    if (!canEdit) return;
    setSavingId(sellerId);
    try {
      const res = await adminFetch("/api/admin/sellers/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId, status }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) alert(body.message ?? body.error ?? "Review failed");
      else await load();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AdminGate requiredPermission="users.sellers.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Marketplace Sellers</h1>
            <p className="mt-1 text-sm text-slate-600">
              Review seller onboarding applications. Separate from restaurant profiles.
            </p>
          </header>

          <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <label className="flex min-w-[180px] flex-col text-sm">
              Status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="mt-1 rounded-lg border px-3 py-2"
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="suspended">Suspended</option>
              </select>
            </label>
            <div className="flex items-end text-sm text-slate-500">{filteredCount} sellers</div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-slate-900">{row.business_name}</h2>
                      <p className="text-sm text-slate-600">
                        {row.country_code}
                        {row.region_code ? `/${row.region_code}` : ""} · {row.city}
                      </p>
                      <p className="text-xs text-slate-500">{row.address}</p>
                      <p className="text-xs text-slate-500">
                        {row.profiles?.full_name ?? "—"} · {row.profiles?.email ?? "—"} · {row.phone}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase text-slate-700">
                      {row.status}
                    </span>
                  </div>

                  {canEdit ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={savingId === row.id}
                        onClick={() => void reviewSeller(row.id, "approved")}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={savingId === row.id}
                        onClick={() => void reviewSeller(row.id, "rejected")}
                        className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={savingId === row.id}
                        onClick={() => void reviewSeller(row.id, "suspended")}
                        className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Suspend
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
