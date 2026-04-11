"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";

type AuthUser = {
  id: string;
  email?: string | null;
};

export default function CreateErrandPage() {
  const [subtotal, setSubtotal] = useState<number>(25);
  const [currency, setCurrency] = useState<string>("USD");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        console.warn("[create-errand] getUser error:", error.message);
        setUser(null);
        return;
      }
      setUser((data.user as any) ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      if (!mounted) return;
      setUser((sess?.user as any) ?? null);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  async function submit() {
    setErr(null);

    if (!user?.id) {
      setErr("Veuillez vous connecter d’abord.");
      return;
    }

    const safeSubtotal = Number.isFinite(subtotal) ? subtotal : 0;
    const safeCurrency = (currency || "USD").trim() || "USD";

    if (safeSubtotal <= 0) {
      setErr("Le montant doit être supérieur à 0.");
      return;
    }

    setPending(true);

    try {
      const { data, error } = await supabase
        .from("orders")
        .insert({
          type: "errand",
          subtotal: safeSubtotal,
          currency: safeCurrency,
          status: "pending",
        })
        .select("id")
        .maybeSingle();

      if (error) throw new Error(error.message);

      const orderId = data?.id as string | undefined;
      if (!orderId) throw new Error("Order ID manquant après insertion.");

      // ✅ pas de .catch() ici: on lit error et on ignore proprement
      {
        const { error: mErr } = await supabase.from("order_members").insert({
          order_id: orderId,
          user_id: user.id,
          role: "admin",
        });
        if (mErr) {
          console.warn("[create-errand] order_members insert failed:", mErr.message);
        }
      }

      {
        const { error: rErr } = await supabase.rpc("refresh_order_commissions", {
          p_order_id: orderId,
        });
        if (rErr) {
          console.warn("[create-errand] refresh_order_commissions failed:", rErr.message);
        }
      }

      router.push(`/orders/${orderId}/chat`);
    } catch (e: any) {
      setErr(e?.message || String(e));
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
            <a className="underline text-blue-700" href="/auth/sign-in-password">
              Se connecter (email + mot de passe)
            </a>
            <a className="underline text-blue-700" href="/auth/sign-in">
              Autres méthodes
            </a>
          </div>
        </div>
      )}

      <label className="block text-sm">Montant (subtotal)</label>
      <input
        type="number"
        className="w-full border rounded px-3 py-2"
        value={subtotal}
        onChange={(e) => setSubtotal(Number(e.target.value))}
      />

      <label className="block text-sm">Devise</label>
      <input
        className="w-full border rounded px-3 py-2"
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
      />

      {err && <div className="text-red-600 text-sm">Erreur: {err}</div>}

      <button
        onClick={submit}
        disabled={pending}
        className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
      >
        {pending ? "Création…" : "Créer"}
      </button>
    </div>
  );
}
