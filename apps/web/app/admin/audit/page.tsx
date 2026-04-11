"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type AuditAction =
  | "driver_approved"
  | "driver_rejected"
  | "restaurant_approved"
  | "restaurant_rejected"
  | "payout_retry"
  | "payout_resolved"
  | "payout_reviewed"
  | string;

type AuditTargetType = "driver" | "restaurant" | "payout" | "order" | string;

type AuditRow = {
  id: string;
  admin_user_id: string;
  action: AuditAction;
  target_type: AuditTargetType;
  target_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type AdminProfile = {
  id: string;
  role: string | null;
};

function isAdminRole(role: string | null | undefined) {
  return role === "admin";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function truncateMiddle(value: string | null | undefined, start = 10, end = 8) {
  if (!value) return "—";
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function actionBadgeClass(action: string) {
  if (action.includes("approved")) {
    return "border-green-200 bg-green-100 text-green-800";
  }

  if (action.includes("rejected")) {
    return "border-red-200 bg-red-100 text-red-800";
  }

  if (action.includes("retry")) {
    return "border-blue-200 bg-blue-100 text-blue-800";
  }

  if (action.includes("resolved")) {
    return "border-emerald-200 bg-emerald-100 text-emerald-800";
  }

  if (action.includes("reviewed")) {
    return "border-amber-200 bg-amber-100 text-amber-800";
  }

  return "border-slate-200 bg-slate-100 text-slate-700";
}

function targetBadgeClass(targetType: string) {
  switch (targetType) {
    case "driver":
      return "border-cyan-200 bg-cyan-100 text-cyan-800";
    case "restaurant":
      return "border-violet-200 bg-violet-100 text-violet-800";
    case "payout":
      return "border-blue-200 bg-blue-100 text-blue-800";
    case "order":
      return "border-slate-300 bg-slate-100 text-slate-800";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function labelForAction(action: string) {
  switch (action) {
    case "driver_approved":
      return "Driver approved";
    case "driver_rejected":
      return "Driver rejected";
    case "restaurant_approved":
      return "Restaurant approved";
    case "restaurant_rejected":
      return "Restaurant rejected";
    case "payout_retry":
      return "Payout retry";
    case "payout_resolved":
      return "Payout resolved";
    case "payout_reviewed":
      return "Payout reviewed";
    default:
      return action;
  }
}

function safeJsonPreview(value: Record<string, unknown> | null | undefined) {
  if (!value) return "—";

  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > 700 ? `${json.slice(0, 700)}...` : json;
  } catch {
    return "—";
  }
}

export default function AdminAuditPage() {
  const router = useRouter();

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [targetFilter, setTargetFilter] = useState<string>("all");

  const loadPage = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      try {
        if (mode === "initial") {
          setLoading(true);
        } else {
          setRefreshing(true);
        }

        setErr(null);

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw new Error(userError.message);
        }

        if (!user) {
          setAuthChecked(true);
          setIsAdmin(false);
          router.push("/auth/login");
          return;
        }

        const { data: me, error: meError } = await supabase
          .from("profiles")
          .select("id, role")
          .eq("id", user.id)
          .maybeSingle();

        if (meError) {
          throw new Error(meError.message);
        }

        const profile = (me as AdminProfile | null) ?? null;

        if (!profile || !isAdminRole(profile.role)) {
          setAuthChecked(true);
          setIsAdmin(false);
          setErr("Accès réservé aux administrateurs.");
          return;
        }

        setAuthChecked(true);
        setIsAdmin(true);

        const { data, error } = await supabase
          .from("admin_audit_logs")
          .select(
            "id, admin_user_id, action, target_type, target_id, metadata, created_at"
          )
          .order("created_at", { ascending: false })
          .limit(300);

        if (error) {
          throw new Error(error.message);
        }

        setRows((data ?? []) as AuditRow[]);
      } catch (e: unknown) {
        const message =
          e instanceof Error ? e.message : "Erreur lors du chargement";
        setErr(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  useEffect(() => {
    void loadPage("initial");
  }, [loadPage]);

  const actionOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.action))).sort();
  }, [rows]);

  const targetOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.target_type))).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSearch =
        q.length === 0 ||
        row.action.toLowerCase().includes(q) ||
        row.target_type.toLowerCase().includes(q) ||
        row.target_id.toLowerCase().includes(q) ||
        row.admin_user_id.toLowerCase().includes(q) ||
        JSON.stringify(row.metadata ?? {}).toLowerCase().includes(q);

      const matchesAction =
        actionFilter === "all" || row.action === actionFilter;

      const matchesTarget =
        targetFilter === "all" || row.target_type === targetFilter;

      return matchesSearch && matchesAction && matchesTarget;
    });
  }, [rows, search, actionFilter, targetFilter]);

  const summary = useMemo(() => {
    return {
      total: filteredRows.length,
      approvals: filteredRows.filter((row) => row.action.includes("approved"))
        .length,
      rejections: filteredRows.filter((row) => row.action.includes("rejected"))
        .length,
      drivers: filteredRows.filter((row) => row.target_type === "driver").length,
      restaurants: filteredRows.filter((row) => row.target_type === "restaurant")
        .length,
    };
  }, [filteredRows]);

  function resetFilters() {
    setSearch("");
    setActionFilter("all");
    setTargetFilter("all");
  }

  if (loading || !authChecked) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-7xl p-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="mb-4 text-2xl font-bold text-slate-900">
              Admin audit logs
            </h1>
            <p className="text-sm text-slate-600">Chargement…</p>
          </div>
        </div>
      </main>
    );
  }

  if ((!isAdmin || err) && rows.length === 0) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-7xl p-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="mb-4 text-2xl font-bold text-slate-900">
              Admin audit logs
            </h1>
            <p className="text-sm text-red-600">{err || "Accès refusé"}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <header className="space-y-3">
          <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            MMD Delivery · Admin Audit
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Admin audit logs
          </h1>

          <p className="text-sm text-slate-600">
            Trace les actions sensibles des administrateurs sur les drivers,
            restaurants, payouts et autres opérations.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Logs affichés</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {summary.total}
            </div>
          </div>

          <div className="rounded-2xl border border-green-200 bg-green-50 p-5 shadow-sm">
            <div className="text-sm text-slate-500">Approvals</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {summary.approvals}
            </div>
          </div>

          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
            <div className="text-sm text-slate-500">Rejections</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {summary.rejections}
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
            <div className="text-sm text-slate-500">Drivers</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {summary.drivers}
            </div>
          </div>

          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 shadow-sm">
            <div className="text-sm text-slate-500">Restaurants</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {summary.restaurants}
            </div>
          </div>
        </section>

        {err && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            {err}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_260px_260px_auto_auto]">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Search
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by action, target, target ID, admin ID, metadata..."
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Action
              </label>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              >
                <option value="all">All</option>
                {actionOptions.map((action) => (
                  <option key={action} value={action}>
                    {labelForAction(action)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Target
              </label>
              <select
                value={targetFilter}
                onChange={(e) => setTargetFilter(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              >
                <option value="all">All</option>
                {targetOptions.map((target) => (
                  <option key={target} value={target}>
                    {target}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
              >
                Reset
              </button>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void loadPage("refresh")}
                disabled={refreshing}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Audit entries</h2>
            <p className="mt-1 text-sm text-slate-500">
              Historique des actions admin enregistrées dans la base.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1500px] divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Target type</th>
                  <th className="px-4 py-3 font-medium">Target ID</th>
                  <th className="px-4 py-3 font-medium">Admin user</th>
                  <th className="px-4 py-3 font-medium">Metadata</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 bg-white">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-sm text-slate-500"
                    >
                      Aucun log trouvé pour les filtres actuels.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-4 text-slate-700">
                        {formatDate(row.created_at)}
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${actionBadgeClass(
                            row.action
                          )}`}
                        >
                          {labelForAction(row.action)}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${targetBadgeClass(
                            row.target_type
                          )}`}
                        >
                          {row.target_type}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <div
                          className="font-mono text-xs text-slate-900"
                          title={row.target_id}
                        >
                          {truncateMiddle(row.target_id, 12, 10)}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <div
                          className="font-mono text-xs text-slate-700"
                          title={row.admin_user_id}
                        >
                          {truncateMiddle(row.admin_user_id, 12, 10)}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <pre className="max-w-[520px] overflow-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                          {safeJsonPreview(row.metadata)}
                        </pre>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
