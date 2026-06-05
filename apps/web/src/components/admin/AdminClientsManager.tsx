"use client";

import { useCallback, useEffect, useState } from "react";
import { hasPermission } from "@/lib/adminRbac";
import { supabase } from "@/lib/supabaseBrowser";
import { normalizeUserRole } from "@/lib/roles";

type ClientRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  account_status: string;
  created_at: string;
};

type AuditRow = {
  id: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
};

export default function AdminClientsManager() {
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [query, setQuery] = useState("");
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
    const res = await fetch(url.toString(), { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Échec chargement");
      setRows([]);
    } else {
      setRows(body.items ?? []);
    }
    setLoading(false);
  }, [query]);

  useEffect(() => {
    void load();
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .maybeSingle();
      setCanManage(
        hasPermission(normalizeUserRole(profile?.role), "users.clients.manage")
      );
    })();
  }, [load]);

  async function openClient(client: ClientRow) {
    setSelected(client);
    setEditName(client.full_name ?? "");
    setEditPhone(client.phone ?? "");
    setEditEmail(client.email ?? "");
    const res = await fetch(`/api/admin/clients/${client.id}/history`, {
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    setHistory(res.ok && body.ok ? body.items ?? [] : []);
  }

  async function runAction(action: string) {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`/api/admin/clients/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok || !body.ok) {
      alert(body.error ?? "Échec");
      return;
    }
    await load();
    await openClient(body.item as ClientRow);
  }

  async function saveEdits() {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`/api/admin/clients/${selected.id}`, {
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
      alert(body.error ?? "Échec");
      return;
    }
    await load();
    await openClient(body.item as ClientRow);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher client…"
          className="h-10 max-w-md flex-1 rounded-xl border border-slate-300 px-3 text-sm"
        />
        <button
          type="button"
          onClick={() => void load()}
          className="h-10 rounded-xl bg-slate-900 px-4 text-sm text-white"
        >
          Actualiser
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Chargement…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Nom</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="px-4 py-3">{row.full_name ?? "—"}</td>
                  <td className="px-4 py-3">{row.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">
                      {row.account_status ?? "active"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void openClient(row)}
                      className="text-sm text-blue-600 underline"
                    >
                      Gérer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{selected.full_name ?? selected.id}</h2>
              <p className="text-sm text-slate-500">Statut : {selected.account_status}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-sm text-slate-500 underline"
            >
              Fermer
            </button>
          </div>

          {canManage ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Nom"
                className="rounded-lg border px-3 py-2 text-sm"
              />
              <input
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="Téléphone"
                className="rounded-lg border px-3 py-2 text-sm"
              />
              <input
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="Email"
                className="rounded-lg border px-3 py-2 text-sm"
              />
            </div>
          ) : null}

          {canManage ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveEdits()}
                className="rounded-lg bg-black px-3 py-1.5 text-xs text-white disabled:opacity-50"
              >
                Enregistrer
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void runAction("suspend")}
                className="rounded-lg border px-3 py-1.5 text-xs"
              >
                Suspendre
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void runAction("unsuspend")}
                className="rounded-lg border px-3 py-1.5 text-xs"
              >
                Désuspendre
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void runAction("activate")}
                className="rounded-lg border px-3 py-1.5 text-xs"
              >
                Activer
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void runAction("deactivate")}
                className="rounded-lg border px-3 py-1.5 text-xs"
              >
                Désactiver
              </button>
            </div>
          ) : null}

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-900">Historique admin</h3>
            <ul className="mt-2 space-y-2 text-xs text-slate-600">
              {history.length === 0 ? (
                <li>Aucune action enregistrée.</li>
              ) : (
                history.map((h) => (
                  <li key={h.id} className="rounded-lg border border-slate-100 p-2">
                    <div className="font-medium">{h.action}</div>
                    <div>{new Date(h.created_at).toLocaleString()}</div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
