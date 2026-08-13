"use client";

import AdminGate from "@/components/AdminGate";
import AdminClientsManager from "@/components/admin/AdminClientsManager";

export default function AdminClientsPage() {
  return (
    <AdminGate requiredPermission="users.clients.read">
      <main className="space-y-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <AdminClientsManager />
        </div>
      </main>
    </AdminGate>
  );
}
