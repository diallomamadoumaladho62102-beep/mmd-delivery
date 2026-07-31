"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMarketing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-slate-500";

type Submission = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  status: string;
  assignee_user_id: string | null;
  internal_notes: string | null;
  created_at: string;
};

function ContactInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [rows, setRows] = useState<Submission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("new");

  const load = useCallback(async () => {
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMarketing(session?.role ?? null));
    const http = await adminFetch("/api/admin/site/contact?limit=200");
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Load failed"));
      return;
    }
    setRows((res.submissions as Submission[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openRow = (row: Submission) => {
    setSelected(row);
    setNotes(row.internal_notes ?? "");
    setStatus(row.status);
  };

  const save = async () => {
    if (!canEdit || !selected) return;
    const http = await adminFetch("/api/admin/site/contact", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selected.id,
        status,
        internal_notes: notes,
      }),
    });
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Update failed"));
      return;
    }
    setNotice("Submission updated.");
    setSelected(null);
    await load();
  };

  const exportCsv = async () => {
    const http = await adminFetch("/api/admin/site/contact?export=csv");
    if (!http.ok) {
      setError("CSV export failed");
      return;
    }
    const blob = await http.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "site-contact-submissions.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/site" className="text-sm font-semibold text-slate-500 hover:text-slate-800">
            ← Corporate Website
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Contact inbox</h1>
        </div>
        <button
          type="button"
          onClick={() => void exportCsv()}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"
        >
          Export CSV
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      <div className={`${CARD} space-y-2`}>
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => openRow(row)}
            className="flex w-full flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
          >
            <div>
              <div className="font-semibold text-slate-900">
                {row.name} · {row.email}
              </div>
              <div className="text-xs text-slate-500">
                {row.status} · {row.subject || "No subject"} ·{" "}
                {new Date(row.created_at).toLocaleString()}
              </div>
              <div className="mt-1 line-clamp-2 text-sm text-slate-600">{row.message}</div>
            </div>
          </button>
        ))}
        {rows.length === 0 ? <p className="text-sm text-slate-500">No submissions.</p> : null}
      </div>

      {selected ? (
        <div className={`${CARD} space-y-3`}>
          <h2 className="font-semibold text-slate-900">Edit submission</h2>
          <p className="text-sm text-slate-600">
            {selected.name} &lt;{selected.email}&gt;
          </p>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{selected.message}</p>
          <label className="block">
            <span className={LABEL}>Status</span>
            <select
              className={INPUT}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={!canEdit}
            >
              <option value="new">new</option>
              <option value="in_progress">in_progress</option>
              <option value="done">done</option>
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Internal notes</span>
            <textarea
              className={`${INPUT} min-h-[100px]`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canEdit}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => void save()}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-slate-400">
        CSV: use Export CSV (authenticated via staff session).
      </p>
    </div>
  );
}

export default function SiteContactPage() {
  return (
    <AdminGate requiredPermission="marketing.read">
      <ContactInner />
    </AdminGate>
  );
}
