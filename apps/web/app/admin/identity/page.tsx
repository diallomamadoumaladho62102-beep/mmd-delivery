"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import {
  CC_BTN_PRIMARY,
  CC_BTN_SECONDARY,
  CC_INPUT,
  CC_PAGE_SUBTITLE,
  CC_PAGE_TITLE,
  CC_TABLE,
  CC_TABLE_WRAP,
} from "@/components/admin/adminUi";
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

type IdentityEvent = {
  id: string;
  verification_id: string | null;
  subject_user_id: string | null;
  event_source: string;
  event_type: string;
  provider: string | null;
  provider_event_id: string | null;
  created_at: string;
};

export default function AdminIdentityPage() {
  const [items, setItems] = useState<IdentityRow[]>([]);
  const [events, setEvents] = useState<IdentityEvent[]>([]);
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
      setEvents(Array.isArray(body.events) ? body.events : []);
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
    <AdminGate requiredPermission="drivers.identity.read">
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className={CC_PAGE_TITLE}>Identity Verification</h1>
          <p className={CC_PAGE_SUBTITLE}>
            Stripe Identity — sessions, statuses, and re-verification (no document
            storage).
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          <select
            className={`${CC_INPUT} w-auto min-w-[140px]`}
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
            className={`${CC_INPUT} w-auto min-w-[140px]`}
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
            className={`${CC_INPUT} max-w-xs`}
            placeholder="User id / session id"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="button" className={CC_BTN_PRIMARY} onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {loading ? <p className="text-sm text-[var(--cc-muted)]">Loading…</p> : null}

        <div className={CC_TABLE_WRAP}>
          <table className={CC_TABLE}>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Provider</th>
                <th>Attempts</th>
                <th>Session</th>
                <th>Failure</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td className="font-mono text-xs">{row.subject_user_id}</td>
                  <td>{row.subject_type}</td>
                  <td>{row.verification_status}</td>
                  <td>{row.provider}</td>
                  <td>{row.verification_attempts}</td>
                  <td className="font-mono text-xs">
                    {row.active_session_id ?? "—"}
                  </td>
                  <td className="text-xs text-red-700">
                    {row.verification_failed_reason ?? "—"}
                  </td>
                  <td className="text-xs">
                    {row.updated_at ? new Date(row.updated_at).toLocaleString() : "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      className={CC_BTN_SECONDARY}
                      onClick={() => void requestReverify(row)}
                    >
                      {busyId === row.id ? "…" : "Request re-verify"}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 ? (
                <tr>
                  <td className="text-[var(--cc-muted)]" colSpan={9}>
                    No identity verifications found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <h2 className="text-sm font-semibold text-white">Audit log</h2>
        <div className={CC_TABLE_WRAP}>
          <table className={CC_TABLE}>
            <thead>
              <tr>
                <th>When</th>
                <th>Source</th>
                <th>Event</th>
                <th>User</th>
                <th>Stripe event</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="text-xs">
                    {event.created_at
                      ? new Date(event.created_at).toLocaleString()
                      : "—"}
                  </td>
                  <td>{event.event_source}</td>
                  <td className="font-mono text-xs">{event.event_type}</td>
                  <td className="font-mono text-xs">
                    {event.subject_user_id ?? "—"}
                  </td>
                  <td className="font-mono text-xs">
                    {event.provider_event_id ?? "—"}
                  </td>
                </tr>
              ))}
              {!loading && events.length === 0 ? (
                <tr>
                  <td className="text-[var(--cc-muted)]" colSpan={5}>
                    No identity audit events yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </AdminGate>
  );
}
