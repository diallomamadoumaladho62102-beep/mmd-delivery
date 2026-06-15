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
      const response = await fetch("/api/errands/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          pickupAddress: "Pickup address required",
          dropoffAddress: "Dropoff address required",
          subtotal: safeSubtotal,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload.error ?? "create_errand_order failed"));
      }

      const orderId = String(payload.id ?? "").trim();
      if (!orderId) throw new Error("Order ID manquant après création.");

      router.push(`/orders/${orderId}?pay=1`);
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
