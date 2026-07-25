"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AdminGate from "@/components/AdminGate";
import StaffCommsPanel from "@/components/admin/StaffCommsPanel";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { roleDisplayName } from "@/lib/adminRbac";

type AdminRow = {
  id: string;
  role: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  account_status: string;
  is_founder: boolean;
  created_at: string;
  staff_country_code?: string | null;
  staff_region_code?: string | null;
  staff_county_code?: string | null;
  staff_city?: string | null;
  staff_timezone?: string | null;
  staff_language?: string | null;
  staff_department?: string | null;
  staff_title?: string | null;
  last_seen_at?: string | null;
  presence_status?: string | null;
};

type Perf = {
  tasks_assigned: number;
  tasks_done: number;
  tasks_overdue: number;
  avg_resolution_hours: number | null;
  drivers_approved: number;
  restaurants_approved: number;
  sellers_approved: number;
  refunds_validated: number;
  incidents_handled: number;
  support_tickets: number;
  activity_7d: number;
  activity_30d: number;
  success_rate: number;
  workload: number;
};

export default function AdminStaffDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const [row, setRow] = useState<AdminRow | null>(null);
  const [perf, setPerf] = useState<Perf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [savingGeo, setSavingGeo] = useState(false);
  const [geoForm, setGeoForm] = useState({
    staff_country_code: "",
    staff_region_code: "",
    staff_county_code: "",
    staff_city: "",
    staff_timezone: "",
    staff_language: "",
    staff_department: "",
    staff_title: "",
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const session = await resolveBrowserStaffSession();
      if (alive && session) setCurrentUserId(session.userId);

      const res = await adminFetch("/api/admin/admins");
      const body = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Failed to load");
        return;
      }
      const found =
        (body.items as AdminRow[]).find((item) => item.id === id) ?? null;
      if (!found) setError("Administrator not found");
      setRow(found);
      if (found) {
        setGeoForm({
          staff_country_code: found.staff_country_code ?? "",
          staff_region_code: found.staff_region_code ?? "",
          staff_county_code: found.staff_county_code ?? "",
          staff_city: found.staff_city ?? "",
          staff_timezone: found.staff_timezone ?? "",
          staff_language: found.staff_language ?? "",
          staff_department: found.staff_department ?? "",
          staff_title: found.staff_title ?? "",
        });
      }

      const perfRes = await adminFetch(
        `/api/admin/staff/performance?admin_id=${id}`
      );
      const perfBody = await perfRes.json().catch(() => ({}));
      if (perfRes.ok && perfBody.ok) {
        const item = (perfBody.items ?? [])[0];
        setPerf(item?.performance ?? null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  async function saveGeo(e: FormEvent) {
    e.preventDefault();
    if (!row) return;
    setSavingGeo(true);
    setError(null);
    const res = await adminFetch("/api/admin/admins", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: row.id,
        action: "update_profile",
        ...geoForm,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingGeo(false);
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Geo update failed");
      return;
    }
    setRow(body.item);
  }

  return (
    <AdminGate requiredPermission="users.admins.manage">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link
          href="/admin/staff"
          className="text-sm font-semibold text-[var(--cc-info)] hover:underline"
        >
          ← Staff & Roles
        </Link>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : !row ? (
          <p className="text-sm text-[var(--cc-muted)]">Loading…</p>
        ) : (
          <>
            <header className="cc-card flex flex-wrap items-center gap-4 p-6">
              <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-xl font-semibold text-slate-700">
                {(row.full_name || row.email || "?").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                  {row.full_name ?? "Administrator"}
                </h1>
                <p className="text-sm text-[var(--cc-muted)]">
                  {roleDisplayName(row.role as never, {
                    isFounder: row.is_founder,
                  })}
                  {" · "}
                  {row.presence_status ?? "offline"}
                  {row.last_seen_at
                    ? ` · last seen ${new Date(row.last_seen_at).toLocaleString()}`
                    : ""}
                </p>
              </div>
            </header>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="cc-card space-y-3 p-5">
                <h2 className="text-sm font-semibold text-slate-900">
                  Information
                </h2>
                <Info label="Email" value={row.email} />
                <Info label="Phone" value={row.phone} />
                <Info
                  label="Role"
                  value={roleDisplayName(row.role as never, {
                    isFounder: row.is_founder,
                  })}
                />
                <Info label="Title" value={row.staff_title} />
                <Info label="Department" value={row.staff_department} />
              </section>

              <section className="cc-card space-y-3 p-5">
                <h2 className="text-sm font-semibold text-slate-900">
                  Performance
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Tasks assigned", perf?.tasks_assigned],
                    ["Tasks done", perf?.tasks_done],
                    ["Overdue", perf?.tasks_overdue],
                    ["Avg resolution (h)", perf?.avg_resolution_hours],
                    ["Drivers approved", perf?.drivers_approved],
                    ["Restaurants approved", perf?.restaurants_approved],
                    ["Sellers approved", perf?.sellers_approved],
                    ["Refunds", perf?.refunds_validated],
                    ["Incidents", perf?.incidents_handled],
                    ["Support actions", perf?.support_tickets],
                    ["Success rate %", perf?.success_rate],
                    ["Workload", perf?.workload],
                    ["Activity 7d", perf?.activity_7d],
                    ["Activity 30d", perf?.activity_30d],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="rounded-xl border border-[var(--cc-border)] bg-slate-50 px-3 py-3"
                    >
                      <p className="text-xs text-[var(--cc-muted)]">{label}</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {value ?? "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <form onSubmit={(e) => void saveGeo(e)} className="cc-card grid gap-3 p-5 md:grid-cols-2">
              <h2 className="text-sm font-semibold text-slate-900 md:col-span-2">
                Geographic assignment
              </h2>
              {(
                [
                  ["staff_country_code", "Country"],
                  ["staff_region_code", "State / Region"],
                  ["staff_county_code", "County"],
                  ["staff_city", "City"],
                  ["staff_timezone", "Timezone"],
                  ["staff_language", "Language"],
                  ["staff_department", "Department"],
                  ["staff_title", "Title"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-[var(--cc-muted)]">
                    {label}
                  </span>
                  <input
                    value={geoForm[key]}
                    onChange={(e) =>
                      setGeoForm((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="w-full rounded-xl border border-[var(--cc-border)] px-3 py-2"
                  />
                </label>
              ))}
              <button
                type="submit"
                disabled={savingGeo}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white md:col-span-2"
              >
                {savingGeo ? "Saving…" : "Save geography"}
              </button>
            </form>

            {currentUserId ? (
              <StaffCommsPanel
                peerAdminId={row.id}
                peerName={row.full_name || row.email || "Admin"}
                currentUserId={currentUserId}
              />
            ) : null}

            <Link
              href={`/admin/tasks?assignee=${row.id}`}
              className="inline-flex text-sm font-semibold text-[var(--cc-info)] hover:underline"
            >
              Assign a task →
            </Link>
          </>
        )}
      </div>
    </AdminGate>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--cc-muted)]">
        {label}
      </span>
      <span className="text-right text-sm text-slate-800">{value || "—"}</span>
    </div>
  );
}
