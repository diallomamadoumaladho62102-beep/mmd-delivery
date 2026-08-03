"use client";

import AdminGate from "@/components/AdminGate";
import AdminApiTable from "@/components/admin/AdminApiTable";

type DrRow = {
  id: string;
  status: string | null;
  payment_status: string | null;
  total: number | null;
  total_cents: number | null;
  currency: string | null;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  created_at: string;
};

function formatDrTotal(r: DrRow): string {
  const currency = r.currency ?? "USD";
  if (r.total_cents != null && Number.isFinite(r.total_cents)) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(r.total_cents / 100);
  }
  if (r.total != null) {
    return `${r.total} ${currency}`;
  }
  return "—";
}

export default function AdminDeliveryRequestsPage() {
  return (
    <AdminGate requiredPermission="delivery_requests.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Delivery Requests</h1>
            <p className="mt-1 text-sm text-slate-600">
              Demandes de livraison, statuts et chauffeurs assignés.
            </p>
          </header>
          <AdminApiTable<DrRow>
            apiPath="/api/admin/delivery-requests"
            columns={[
              {
                key: "id",
                label: "ID",
                render: (r) => (
                  <span className="font-mono text-xs">{r.id.slice(0, 8)}…</span>
                ),
              },
              { key: "status", label: "Statut" },
              { key: "payment_status", label: "Paiement" },
              {
                key: "total_cents",
                label: "Total (charge)",
                render: (r) => formatDrTotal(r),
              },
              {
                key: "driver_id",
                label: "Chauffeur",
                render: (r) =>
                  r.driver_id ? `${r.driver_id.slice(0, 8)}…` : "—",
              },
              {
                key: "pickup_address",
                label: "Pickup",
                render: (r) => (
                  <span className="max-w-[200px] truncate block">
                    {r.pickup_address ?? "—"}
                  </span>
                ),
              },
              {
                key: "created_at",
                label: "Créé",
                render: (r) => new Date(r.created_at).toLocaleString(),
              },
            ]}
          />
        </div>
      </main>
    </AdminGate>
  );
}
