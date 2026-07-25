"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminGate from "@/components/AdminGate";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { STAFF_ROLES, roleDisplayName } from "@/lib/adminRbac";

type AdminRow = {
  id: string;
  role: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  account_status: string;
  is_founder: boolean;
  created_at: string;
};

const CREATABLE_ROLES = STAFF_ROLES.filter((role) => role !== "admin");

export default function AdminStaffPage() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [createEmail, setCreateEmail] = useState("");
  const [createRole, setCreateRole] = useState("ops");
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await adminFetch("/api/admin/admins");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Failed to load staff");
      setRows([]);
    } else {
      setRows(body.items ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (roleFilter !== "all" && row.role !== roleFilter) return false;
      if (statusFilter !== "all" && row.account_status !== statusFilter) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        (row.full_name ?? "").toLowerCase().includes(q) ||
        (row.email ?? "").toLowerCase().includes(q) ||
        (row.phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, roleFilter, statusFilter, query]);

  async function changeRole(userId: string, role: string) {
    setSavingId(userId);
    const res = await adminFetch("/api/admin/admins", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: "change_role", role }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok || !body.ok) {
      alert(body.error ?? "Role update failed");
      return;
    }
    void load();
  }

  async function runLifecycle(
    userId: string,
    action: "suspend" | "unsuspend" | "activate" | "deactivate"
  ) {
    setSavingId(userId);
    const res = await adminFetch("/api/admin/admins", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok || !body.ok) {
      alert(body.error ?? "Action failed");
      return;
    }
    void load();
  }

  async function removeAdmin(userId: string) {
    if (!window.confirm("Remove this administrator from staff?")) return;
    setSavingId(userId);
    const res = await adminFetch("/api/admin/admins", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok || !body.ok) {
      alert(body.error ?? "Delete failed");
      return;
    }
    void load();
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await adminFetch("/api/admin/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: createEmail.trim(),
        role: createRole,
        full_name: createName.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok || !body.ok) {
      alert(body.error ?? "Create failed");
      return;
    }
    setCreateEmail("");
    setCreateName("");
    void load();
  }

  return (
    <AdminGate requiredPermission="users.admins.manage">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cc-muted)]">
              Administration
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              Staff & Roles
            </h1>
            <p className="mt-1 text-sm text-[var(--cc-muted)]">
              Founder and authorized admins · full internal organization
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/admin/teams"
              className="rounded-xl border border-[var(--cc-border)] bg-white px-3 py-2 text-sm font-semibold text-slate-700"
            >
              Org chart
            </Link>
            <Link
              href="/admin/hr"
              className="rounded-xl bg-[var(--cc-ai)] px-3 py-2 text-sm font-semibold text-white"
            >
              People Ops
            </Link>
          </div>
        </header>

        <form onSubmit={(e) => void handleCreate(e)} className="cc-card p-5">
          <h2 className="text-sm font-semibold text-slate-900">Add administrator</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <input
              type="email"
              required
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              placeholder="email@example.com"
              className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Full name"
              className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
            />
            <select
              value={createRole}
              onChange={(e) => setCreateRole(e.target.value)}
              className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
            >
              {CREATABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleDisplayName(role)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={creating}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </form>

        <div className="flex flex-wrap gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, phone"
            className="min-w-[220px] flex-1 rounded-xl border border-[var(--cc-border)] bg-white px-3 py-2 text-sm"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-xl border border-[var(--cc-border)] bg-white px-3 py-2 text-sm"
          >
            <option value="all">All roles</option>
            {STAFF_ROLES.map((role) => (
              <option key={role} value={role}>
                {roleDisplayName(role)}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-[var(--cc-border)] bg-white px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--cc-muted)]">Loading…</p>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <div className="cc-card overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--cc-border)] bg-slate-50 text-xs uppercase tracking-wide text-[var(--cc-muted)]">
                <tr>
                  <th className="px-4 py-3">Photo</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 align-middle hover:bg-slate-50/80"
                  >
                    <td className="px-4 py-3">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                        {(row.full_name || row.email || "?").slice(0, 1).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/staff/${row.id}`}
                        className="font-medium text-slate-900 hover:text-[var(--cc-info)]"
                      >
                        {row.full_name ?? "—"}
                      </Link>
                      {row.is_founder ? (
                        <div className="mt-0.5 text-xs font-semibold text-[var(--cc-ai)]">
                          Founder
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[var(--cc-muted)]">
                      {row.email ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--cc-muted)]">
                      {row.phone ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={row.role}
                        disabled={savingId === row.id || row.is_founder}
                        onChange={(e) => void changeRole(row.id, e.target.value)}
                        className="rounded-lg border border-[var(--cc-border)] px-2 py-1 text-sm"
                      >
                        {STAFF_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {roleDisplayName(role, {
                              isFounder: row.is_founder && role === "admin",
                            })}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={row.account_status} />
                    </td>
                    <td className="px-4 py-3 text-[var(--cc-muted)]">
                      {row.created_at
                        ? new Date(row.created_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {row.is_founder ? (
                        <span className="text-xs text-[var(--cc-muted)]">Protected</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          <Link
                            href={`/admin/staff/${row.id}`}
                            className="rounded-lg border border-[var(--cc-border)] px-2 py-1 text-xs font-medium"
                          >
                            Profile
                          </Link>
                          {row.account_status === "suspended" ? (
                            <button
                              type="button"
                              disabled={savingId === row.id}
                              onClick={() => void runLifecycle(row.id, "unsuspend")}
                              className="rounded-lg border border-emerald-300 px-2 py-1 text-xs"
                            >
                              Unsuspend
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={savingId === row.id}
                              onClick={() => void runLifecycle(row.id, "suspend")}
                              className="rounded-lg border border-orange-300 px-2 py-1 text-xs"
                            >
                              Suspend
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={savingId === row.id}
                            onClick={() => void removeAdmin(row.id)}
                            className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminGate>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-50 text-emerald-700"
      : status === "suspended"
        ? "bg-amber-50 text-amber-800"
        : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      {status || "active"}
    </span>
  );
}
