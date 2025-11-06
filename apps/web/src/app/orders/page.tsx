import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

export default async function OrdersPage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // côté serveur, OK
  );
  const { data, error } = await supabase
    .from("orders")
    .select("id,status,created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return <div className="p-6 text-red-600">Erreur: {error.message}</div>;

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Mes commandes</h1>
      <div className="space-y-2">
        {(data ?? []).map(o => (
          <div key={o.id} className="flex items-center justify-between border rounded p-3">
            <div>
              <div className="font-mono text-sm">{o.id.slice(0,8)} — {o.status}</div>
              <div className="text-xs text-gray-500">{new Date(o.created_at).toLocaleString()}</div>
            </div>
            <Link href={`/orders/${o.id}`} className="px-3 py-2 bg-black text-white rounded text-sm">
              Ouvrir
            </Link>
          </div>
        ))}
        {(!data || data.length === 0) && <div className="text-gray-500">Aucune commande.</div>}
      </div>
    </main>
  );
}
