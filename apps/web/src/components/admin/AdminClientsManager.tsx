"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { hasPermission } from "@/lib/adminRbac";
import { supabase } from "@/lib/supabaseBrowser";
import { normalizeUserRole } from "@/lib/roles";

type ClientRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  account_status: string;
  account_kind: string;
  country: string | null;
  city: string | null;
  created_at: string;
  last_seen_at: string | null;
  orders_count: number;
  wallet_balance_cents: number;
  wallet_currency: string;
  email_verified: boolean;
  phone_verified: boolean;
  address_verified: boolean;
  completeness_percent: number;
  completeness_status: string;
  missing_fields: string[];
};

type AuditRow = {
  id: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
};

function Badge({
  ok,
  label,
}: {
  ok: boolean;
  label: string;
}) {
  return (
    <span
      className={[
        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        ok
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format((cents || 0) / 100);
  } catch {
    return `${(cents || 0) / 100} ${currency}`;
  }
}

export default function AdminClientsManager() {
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("real");
  const [status, setStatus] = useState("active");
  const [incomplete, setIncomplete] = useState(false);
  const [sort, setSort] = useState("created_at");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const url = new URL("/api/admin/clients", window.location.origin);
    if (query.trim()) url.searchParams.set("q", query.trim());
    url.searchParams.set("kind", kind);
    url.searchParams.set("status", status);
    if (incomplete) url.searchParams.set("incomplete", "1");
    url.searchParams.set("sort", sort);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(pageSize));
    const res = await adminFetch(url.toString());
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Failed to load clients");
      setRows([]);
      setTotal(0);
    } else {
      setRows(body.items ?? []);
      setTotal(Number(body.total ?? 0));
    }
    setLoading(false);
  }, [query, kind, status, incomplete, sort, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .maybeSingle();
      setCanManage(
        hasPermission(normalizeUserRole(profile?.role), "users.clients.manage"),
      );
    })();
  }, []);

  async function openClient(client: ClientRow) {
    setSelected(client);
    setEditName(client.full_name ?? "");
    setEditPhone(client.phone ?? "");
    setEditEmail(client.email ?? "");
    const res = await adminFetch(`/api/admin/clients/${client.id}/history`);
    const body = await res.json().catch(() => ({}));
    setHistory(res.ok && body.ok ? body.items ?? [] : []);
  }

  async function runAction(action: string) {
    if (!selected) return;
    setSaving(true);
    const res = await adminFetch(`/api/admin/clients/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok || !body.ok) {
      alert(body.error ?? "Action failed");
      return;
    }
    await load();
    setSelected(null);
  }

  async function saveEdits() {
    if (!selected) return;
    setSaving(true);
    const res = await adminFetch(`/api/admin/clients/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        full_name: editName,
        phone: editPhone,
        email: editEmail,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok || !body.ok) {
      alert(body.error ?? "Save failed");
      return;
    }
    await load();
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Control Center
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Clients
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Premium CRM view — real active clients by default. Test / cert /
            deleted accounts are filtered out unless selected.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
        >
          Refresh
        </button>
      </header>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-6">
        <label className="block text-xs font-semibold text-slate-500 xl:col-span-2">
          Search
          <input
            value={query}
            onChange={(e) => {
              setPage(1);
              setQuery(e.target.value);
            }}
            placeholder="Name, email, phone, id…"
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-500">
          Account kind
          <select
            value={kind}
            onChange={(e) => {
              setPage(1);
              setKind(e.target.value);
            }}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="real">Real (default)</option>
            <option value="demo">Demo</option>
            <option value="test">Test</option>
            <option value="certification">Certification</option>
            <option value="deleted">Deleted</option>
            <option value="all">All kinds</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-500">
          Status
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="active">Active (default)</option>
            <option value="suspended">Suspended</option>
            <option value="disabled">Disabled</option>
            <option value="deleted">Deleted</option>
            <option value="all">All statuses</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-500">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="created_at">Signup date</option>
            <option value="last_seen_at">Last activity</option>
            <option value="full_name">Name</option>
            <option value="orders_count">Orders</option>
            <option value="completeness">Completeness</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pt-6 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={incomplete}
            onChange={(e) => {
              setPage(1);
              setIncomplete(e.target.checked);
            }}
          />
          Incomplete only
        </label>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Activity</th>
                <th className="px-4 py-3">Wallet</th>
                <th className="px-4 py-3">Profile</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    No clients match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative h-10 w-10 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                          {row.avatar_url ? (
                            <Image
                              src={row.avatar_url}
                              alt=""
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-400">
                              {(row.full_name ?? "?").slice(0, 1).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">
                            {row.full_name || "—"}
                          </div>
                          <div className="text-xs text-slate-500">
                            {row.account_kind} · {row.account_status}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-800">{row.email || "—"}</div>
                      <div className="text-xs text-slate-500">{row.phone || "—"}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge ok={row.email_verified} label="Email" />
                        <Badge ok={row.phone_verified} label="Phone" />
                        <Badge ok={row.address_verified} label="Address" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div>{row.city || "—"}</div>
                      <div className="text-xs text-slate-500">{row.country || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="text-xs text-slate-500">Joined</div>
                      <div>{new Date(row.created_at).toLocaleDateString()}</div>
                      <div className="mt-1 text-xs text-slate-500">Last seen</div>
                      <div>
                        {row.last_seen_at
                          ? new Date(row.last_seen_at).toLocaleString()
                          : "—"}
                      </div>
                      <div className="mt-1 text-xs font-medium text-slate-600">
                        {row.orders_count} orders
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {money(row.wallet_balance_cents, row.wallet_currency)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="mb-1 text-xs font-semibold text-slate-600">
                        {row.completeness_percent}%
                      </div>
                      <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-orange-500"
                          style={{ width: `${row.completeness_percent}%` }}
                        />
                      </div>
                      {row.missing_fields?.length ? (
                        <div className="mt-1 max-w-[140px] text-[10px] text-amber-700">
                          Missing: {row.missing_fields.slice(0, 3).join(", ")}
                          {row.missing_fields.length > 3 ? "…" : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void openClient(row)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
          <span>
            {total} client{total === 1 ? "" : "s"} · page {page}/{totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {selected ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 p-4">
          <div className="flex h-full w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {selected.full_name || "Client"}
                </h2>
                <p className="text-xs text-slate-500">{selected.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="flex flex-wrap gap-1">
                <Badge ok={selected.email_verified} label="Email verified" />
                <Badge ok={selected.phone_verified} label="Phone verified" />
                <Badge ok={selected.address_verified} label="Address verified" />
              </div>
              <label className="block text-xs font-semibold text-slate-500">
                Full name
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={!canManage}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Email
                <input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  disabled={!canManage}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Phone
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  disabled={!canManage}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              {selected.missing_fields?.length ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Missing: {selected.missing_fields.join(", ")}
                </div>
              ) : null}
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveEdits()}
                    className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                  >
                    Save profile
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void runAction("suspend")}
                    className="rounded-xl border border-orange-300 px-3 py-2 text-xs text-orange-800"
                  >
                    Suspend
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void runAction("unsuspend")}
                    className="rounded-xl border border-emerald-300 px-3 py-2 text-xs text-emerald-800"
                  >
                    Unsuspend
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void runAction("deactivate")}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
                  >
                    Deactivate
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void runAction("activate")}
                    className="rounded-xl border border-emerald-300 px-3 py-2 text-xs text-emerald-800"
                  >
                    Activate
                  </button>
                </div>
              ) : null}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Audit history
                </h3>
                <ul className="mt-2 space-y-2 text-xs text-slate-600">
                  {history.length === 0 ? (
                    <li>No history</li>
                  ) : (
                    history.map((h) => (
                      <li
                        key={h.id}
                        className="rounded-lg border border-slate-100 px-2 py-1.5"
                      >
                        <span className="font-semibold">{h.action}</span>
                        <span className="text-slate-400">
                          {" "}
                          · {new Date(h.created_at).toLocaleString()}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
