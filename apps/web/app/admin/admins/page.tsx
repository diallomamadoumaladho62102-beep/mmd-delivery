"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { STAFF_ROLES, roleDisplayName } from "@/lib/adminRbac";

type AdminRow = {
  id: string;
  role: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
};

export default function AdminAdminsPage() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/admins", { cache: "no-store" });
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
    const res = await fetch("/api/admin/admins", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok || !body.ok) {
      alert(body.error ?? "Échec mise à jour rôle");
      return;
    }
    void load();
  }

  return (
    <AdminGate requiredPermission="users.admins.manage">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Administrateurs</h1>
            <p className="mt-1 text-sm text-slate-600">
              Gestion des rôles staff — réservé au Super Admin (fondateur).
            </p>
          </header>

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
                    <th className="px-4 py-3">Créé</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="px-4 py-3">{row.full_name ?? "—"}</td>
                      <td className="px-4 py-3">{row.email ?? "—"}</td>
                      <td className="px-4 py-3">
                        <select
                          value={row.role}
                          disabled={savingId === row.id}
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
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(row.created_at).toLocaleString()}
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
