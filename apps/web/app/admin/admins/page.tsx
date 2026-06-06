"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
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

export default function AdminAdminsPage() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [createEmail, setCreateEmail] = useState("");
  const [createRole, setCreateRole] = useState("ops");
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await adminFetch("/api/admin/admins");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Échec chargement");
      setRows([]);
    } else {
      setRows(body.items ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      alert(body.error ?? "Échec mise à jour rôle");
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
      alert(body.error ?? "Échec action admin");
      return;
    }
    void load();
  }

  async function removeAdmin(userId: string) {
    if (!window.confirm("Retirer cet administrateur du staff ?")) return;
    setSavingId(userId);
    const res = await adminFetch("/api/admin/admins", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok || !body.ok) {
      alert(body.error ?? "Échec suppression");
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
      alert(body.error ?? "Échec création admin");
      return;
    }
    setCreateEmail("");
    setCreateName("");
    void load();
  }

  return (
    <AdminGate requiredPermission="users.admins.manage">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Administrateurs</h1>
            <p className="mt-1 text-sm text-slate-600">
              Gouvernance staff — réservé au Super Admin (fondateur).
            </p>
          </header>

          <form
            onSubmit={(e) => void handleCreate(e)}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-sm font-semibold text-slate-900">
              Créer un administrateur
            </h2>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <input
                type="email"
                required
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder="email@exemple.com"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Nom complet"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
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
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
              >
                {creating ? "Création…" : "Créer"}
              </button>
            </div>
          </form>

          {loading ? (
            <div className="text-sm text-slate-500">Chargement…</div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Nom</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Rôle</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 align-top">
                      <td className="px-4 py-3">
                        {row.full_name ?? "—"}
                        {row.is_founder ? (
                          <div className="mt-1 text-xs font-semibold text-amber-700">
                            Fondateur
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{row.email ?? "—"}</td>
                      <td className="px-4 py-3">
                        <select
                          value={row.role}
                          disabled={savingId === row.id || row.is_founder}
                          onChange={(e) => void changeRole(row.id, e.target.value)}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        >
                          {STAFF_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {roleDisplayName(role)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">{row.account_status ?? "active"}</td>
                      <td className="px-4 py-3">
                        {row.is_founder ? (
                          <span className="text-xs text-slate-500">Protégé</span>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {row.account_status === "suspended" ? (
                              <button
                                type="button"
                                disabled={savingId === row.id}
                                onClick={() => void runLifecycle(row.id, "unsuspend")}
                                className="rounded-lg border border-emerald-300 px-2 py-1 text-xs"
                              >
                                Désuspendre
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={savingId === row.id}
                                onClick={() => void runLifecycle(row.id, "suspend")}
                                className="rounded-lg border border-orange-300 px-2 py-1 text-xs"
                              >
                                Suspendre
                              </button>
                            )}
                            {row.account_status === "disabled" ? (
                              <button
                                type="button"
                                disabled={savingId === row.id}
                                onClick={() => void runLifecycle(row.id, "activate")}
                                className="rounded-lg border border-blue-300 px-2 py-1 text-xs"
                              >
                                Activer
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={savingId === row.id}
                                onClick={() => void runLifecycle(row.id, "deactivate")}
                                className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                              >
                                Désactiver
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={savingId === row.id}
                              onClick={() => void removeAdmin(row.id)}
                              className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700"
                            >
                              Supprimer
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
      </main>
    </AdminGate>
  );
}
