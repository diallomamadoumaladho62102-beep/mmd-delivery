"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseBrowser";
import Link from "next/link";
import { useRouter } from "next/navigation";

type User = { id: string };

export default function CreateOrderPage() {
  const [user, setUser] = useState<User | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push("/auth");
      else setUser(data.user as any);
    });
  }, [router]);

  const ensureProfile = async (userId: string) => {
    const { error } = await supabase.from("profiles").upsert({ id: userId, role: "client" });
    if (error) throw error;
  };

  const createOrder = async () => {
    try {
      setError(null);
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Pas connecté. Va sur /auth");
      await ensureProfile(uid);

      const { data, error } = await supabase
        .from("orders")
        .insert({
          client_id: uid,
          pickup_address: "123 Test St, New York, NY",
          dropoff_address: "456 Demo Ave, Brooklyn, NY",
          status: "pending",
          restaurant_id: "demo-restaurant",
          total_amount: 16.0,
          delivery_fee: 3.0
        })
        .select("id")
        .single();

      if (error) throw error;
      setOrderId(data.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!user) {
    return <main className="p-6"><h1 className="text-xl">Vérification de la connexion…</h1></main>;
  }

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Créer une commande (démo)</h1>
      <button onClick={createOrder} className="rounded-xl px-4 py-2 border">Créer la commande</button>
      {orderId && (
        <p className="mt-2">
          Commande créée ✅ →{" "}
          <Link className="underline" href={`/orders/${orderId}/chat`}>ouvrir le chat</Link>
        </p>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </main>
  );
}
