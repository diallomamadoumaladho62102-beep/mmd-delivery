"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { adminFetch } from "@/lib/adminBrowserAuth";

type IdentityRow = {
  id: string;
  subject_user_id: string;
  subject_type: string;
  feature_key: string;
  provider: string;
  verification_status: string;
  active_session_id: string | null;
  verification_attempts: number;
  verification_failed_reason: string | null;
  verified_at: string | null;
  updated_at: string;
};

export default function AdminIdentityPage() {
  const [items, setItems] = useState<IdentityRow[]>([]);
  const [status, setStatus] = useState("");
  const [subjectType, setSubjectType] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (subjectType) params.set("subject_type", subjectType);
      if (q.trim()) params.set("q", q.trim());
      params.set("limit", "100");
      const res = await adminFetch(`/api/admin/identity?${params.toString()}`);
      const body = await res.json();
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error ?? "load_failed");
      }
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [q, status, subjectType]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestReverify = async (row: IdentityRow) => {
    setBusyId(row.id);
    try {
      const res = await adminFetch("/api/admin/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reverify",
          subject_user_id: row.subject_user_id,
          subject_type: row.subject_type,
          feature_key: row.feature_key,
          reason: "admin_manual_reverify",
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error ?? body?.message ?? "reverify_failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "reverify_failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell
      title="Identity Verification"
      subtitle="Stripe Identity — sessions, statuses, and re-verification (no document storage)."
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className="rounded border px-2 py-1 text-sm"
          value={subjectType}
          onChange={(e) => setSubjectType(e.target.value)}
        >
          <option value="">All roles</option>
          <option value="driver">Driver</option>
          <option value="restaurant">Restaurant</option>
          <option value="seller">Seller</option>
          <option value="business">Business</option>
          <option value="client">Client</option>
        </select>
        <select
          className="rounded border px-2 py-1 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="not_started">not_started</option>
          <option value="pending">pending</option>
          <option value="processing">processing</option>
          <option value="verified">verified</option>
          <option value="requires_input">requires_input</option>
          <option value="failed">failed</option>
          <option value="canceled">canceled</option>
        </select>
        <input
          className="rounded border px-2 py-1 text-sm"
          placeholder="User id / session id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <p className="mb-3 text-sm text-red-600">{error}</p>
      ) : null}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}

      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Attempts</th>
              <th className="px-3 py-2">Session</th>
              <th className="px-3 py-2">Failure</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{row.subject_user_id}</td>
                <td className="px-3 py-2">{row.subject_type}</td>
                <td className="px-3 py-2">{row.verification_status}</td>
                <td className="px-3 py-2">{row.provider}</td>
                <td className="px-3 py-2">{row.verification_attempts}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.active_session_id ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-red-700">
                  {row.verification_failed_reason ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.updated_at ? new Date(row.updated_at).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => void requestReverify(row)}
                  >
                    {busyId === row.id ? "…" : "Request re-verify"}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-slate-500" colSpan={9}>
                  No identity verifications found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
