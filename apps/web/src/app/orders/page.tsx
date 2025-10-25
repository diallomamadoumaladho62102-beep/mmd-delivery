"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseBrowser";

type Order = { id: string; status: string; created_at: string };

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrders = async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user) return;

      const { data, error } = await supabase
        .from("orders")
        .select("id, status, created_at")
        .eq("client_id", user.user.id)
        .order("created_at", { ascending: false });

      if (!error && data) setOrders(data);
      setLoading(false);
    };

    fetchOrders();
  }, []);

  if (loading) return <main className="p-6">Chargement...</main>;

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Mes commandes</h1>
      {orders.length === 0 ? (
        <p>Aucune commande trouvée.</p>
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/orders/${o.id}/chat`} className="underline">
                {o.id.slice(0, 8)} — {o.status}
              </Link>{" "}
              <span className="text-xs opacity-70">
                {new Date(o.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
