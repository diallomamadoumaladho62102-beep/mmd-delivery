"use client";

import AdminGate from "@/components/AdminGate";
import AdminClientsManager from "@/components/admin/AdminClientsManager";

export default function AdminClientsPage() {
  return (
    <AdminGate requiredPermission="users.clients.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
            <p className="mt-1 text-sm text-slate-600">
              Gérer, suspendre, activer et consulter l&apos;historique des clients.
            </p>
          </header>
          <AdminClientsManager />
        </div>
      </main>
    </AdminGate>
  );
}
