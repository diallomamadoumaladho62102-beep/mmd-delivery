"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminGate from "@/components/AdminGate";
import { adminFetch } from "@/lib/adminBrowserAuth";

type Metrics = {
  pending_orders: number;
  online_drivers: number;
  unpaid_orders: number;
  failed_payouts: number;
  pending_dispatch_retries: number;
  webhooks_24h: number;
};

export default function AdminSupervisionPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await adminFetch("/api/admin/overview");
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Échec chargement");
        return;
      }
      setMetrics(body.metrics as Metrics);
    })();
  }, []);

  const cards = metrics
    ? [
        { label: "Commandes en attente", value: metrics.pending_orders, href: "/admin/orders" },
        { label: "Chauffeurs en ligne", value: metrics.online_drivers, href: "/admin/drivers" },
        { label: "Commandes non payées", value: metrics.unpaid_orders, href: "/admin/orders" },
        { label: "Payouts échoués", value: metrics.failed_payouts, href: "/admin/payouts" },
        {
          label: "Dispatch retries",
          value: metrics.pending_dispatch_retries,
          href: "/admin/dispatch",
        },
        { label: "Webhooks (24h)", value: metrics.webhooks_24h, href: "/admin/stripe" },
      ]
    : [];

  return (
    <AdminGate requiredPermission="supervision.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Supervision</h1>
            <p className="mt-1 text-sm text-slate-600">
              Vue opérationnelle temps réel de la plateforme.
            </p>
          </header>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : !metrics ? (
            <div className="text-sm text-slate-500">Chargement métriques…</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card) => (
                <Link
                  key={card.label}
                  href={card.href}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:bg-slate-50"
                >
                  <div className="text-sm text-slate-500">{card.label}</div>
                  <div className="mt-2 text-3xl font-bold text-slate-900">
                    {card.value}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
