"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";

export default function CreateErrandPage() {
  const [subtotal, setSubtotal] = useState<number>(25);
  const [currency, setCurrency] = useState<string>("USD");
  const [err, setErr] = useState<string|null>(null);
  const [pending, setPending] = useState(false);
  const [user, setUser] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => setUser(sess?.user ?? null));
    return () => { sub?.subscription?.unsubscribe?.(); };
  }, []);

  async function submit() {
    setErr(null);
    if (!user) { setErr("Veuillez vous connecter d’abord."); return; }
    setPending(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .insert({ type: "errand", subtotal, currency, status: "pending" })
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);

      const orderId = data?.id as string;
      await supabase.from("order_members")
        .insert({ order_id: orderId, user_id: user.id, role: "admin" })
        .catch(()=>{});

      await supabase.rpc("refresh_order_commissions", { p_order_id: orderId }).catch(()=>{});
      router.push(`/orders/${orderId}/chat`);
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-6 border rounded-xl mt-6 space-y-3">
      <h1 className="text-xl font-bold">Créer une commande (Errand)</h1>

      {!user && (
        <div className="p-3 border rounded-lg bg-yellow-50 text-sm">
          <div className="font-medium mb-1">Non connecté</div>
          <div className="flex gap-4">
            <a className="underline text-blue-700" href="/auth/sign-in-password">Se connecter (email + mot de passe)</a>
            <a className="underline text-blue-700" href="/auth/sign-in">Autres méthodes</a>
          </div>
        </div>
      )}

      <label className="block text-sm">Montant (subtotal)</label>
      <input type="number" className="w-full border rounded px-3 py-2" value={subtotal} onChange={e=>setSubtotal(Number(e.target.value))} />
      <label className="block text-sm">Devise</label>
      <input className="w-full border rounded px-3 py-2" value={currency} onChange={e=>setCurrency(e.target.value)} />

      {err && <div className="text-red-600 text-sm">Erreur: {err}</div>}

      <button onClick={submit} disabled={pending} className="px-4 py-2 rounded bg-black text-white disabled:opacity-50">
        {pending ? "Création…" : "Créer"}
      </button>
    </div>
  );
}

