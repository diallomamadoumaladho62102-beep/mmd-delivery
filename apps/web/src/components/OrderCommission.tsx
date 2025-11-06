"use client";
import useSWR from "swr";
const fetcher = (u: string) => fetch(u).then(r => r.json());

const fmt = (cents: number) =>
  (cents/100).toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function OrderCommission({ orderId }: { orderId: string }) {
  const { data, error, isLoading } = useSWR(`/api/orders/${orderId}/commission`, fetcher);

  if (isLoading) return <div className="text-sm text-gray-600">Chargement des commissions…</div>;
  if (error) return <div className="text-sm text-red-600">Erreur: {(error as any)?.message || String(error)}</div>;
  if (!data || data.error) {
    return (
      <div className="text-sm text-orange-600">
        Pas de données de commission.
        {data?.error ? <div className="mt-1">Détail: {data.error}</div> : null}
      </div>
    );
  }

  const c = data;
  return (
    <div className="text-sm grid grid-cols-2 gap-2 p-3 border rounded">
      <div>Client: {fmt(c.fee_client_cents)}</div>
      <div>Driver: {fmt(c.fee_driver_cents)}</div>
      <div>Restaurant: {fmt(c.fee_restaurant_cents)}</div>
      <div>Plateforme: {fmt(c.fee_platform_cents)}</div>
    </div>
  );
}
