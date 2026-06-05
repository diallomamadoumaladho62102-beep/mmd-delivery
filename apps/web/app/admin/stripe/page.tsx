"use client";

import AdminGate from "@/components/AdminGate";
import AdminApiTable from "@/components/admin/AdminApiTable";

type StripeEventRow = {
  id: string;
  stripe_event_id: string;
  event_type: string;
  livemode: boolean;
  order_id: string | null;
  stripe_payment_intent_id: string | null;
  created_at: string;
};

export default function AdminStripePage() {
  return (
    <AdminGate requiredPermission="payments.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Stripe Monitoring</h1>
            <p className="mt-1 text-sm text-slate-600">
              Webhooks reçus, statuts de traitement et erreurs.
            </p>
          </header>
          <AdminApiTable<StripeEventRow>
            apiPath="/api/admin/stripe-events"
            columns={[
              {
                key: "stripe_event_id",
                label: "Event ID",
                render: (r) => (
                  <span className="font-mono text-xs">{r.stripe_event_id}</span>
                ),
              },
              { key: "event_type", label: "Type" },
              {
                key: "livemode",
                label: "Mode",
                render: (r) => (r.livemode ? "live" : "test"),
              },
              {
                key: "order_id",
                label: "Order",
                render: (r) =>
                  r.order_id ? (
                    <span className="font-mono text-xs">{r.order_id.slice(0, 8)}…</span>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "stripe_payment_intent_id",
                label: "PI",
                render: (r) => r.stripe_payment_intent_id ?? "—",
              },
              {
                key: "created_at",
                label: "Reçu",
                render: (r) => new Date(r.created_at).toLocaleString(),
              },
            ]}
          />
        </div>
      </main>
    </AdminGate>
  );
}
