"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type Restaurant = {
  id: string;
  name: string | null;
  address?: string | null;
  phone?: string | null;
};

export default function RestaurantsPage() {
  const router = useRouter();

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchRestaurants(showSpinner = true) {
    try {
      if (showSpinner) setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("restaurant_profiles")
        .select("user_id, restaurant_name, address, phone")
        .order("restaurant_name", { ascending: true });

      if (error) throw error;

      const list: Restaurant[] = (data ?? []).map((r: any) => ({
        id: r.user_id,
        name: r.restaurant_name ?? null,
        address: r.address ?? null,
        phone: r.phone ?? null,
      }));

      setRestaurants(list);

      // 🎯 Comme sur mobile : s'il n'y a QU'UN restaurant, on va direct sur son menu
      if (list.length === 1) {
        const only = list[0];
        router.push(`/restaurants/${only.id}`);
      }
    } catch (err: any) {
      console.error("Erreur fetch restaurants (web):", err);
      setError(
        err?.message ?? "Impossible de charger la liste des restaurants."
      );
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => {
    void fetchRestaurants(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRestaurants(false);
    setRefreshing(false);
  }, []);

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      {/* HEADER */}
      <header className="space-y-1">
        <p className="text-sm font-semibold text-emerald-500">Espace client</p>
        <h1 className="text-2xl font-bold text-gray-900">
          Restaurants partenaires
        </h1>
        <p className="text-sm text-gray-600">
          Choisis un restaurant pour voir son menu et ajouter des plats à ta
          commande MMD.
        </p>
      </header>

      {/* Bouton retour espace client */}
      <div>
        <Link
          href="/client"
          className="inline-flex items-center px-3 py-1.5 rounded-full border text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          ← Retour à l’espace client
        </Link>
      </div>

      {/* Messages / erreurs */}
      {error && (
        <div className="border border-red-200 bg-red-50 text-xs text-red-700 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Bouton rafraîchir */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-700 font-semibold">
          Liste des restaurants
        </p>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="text-xs text-blue-600 hover:underline disabled:opacity-50"
        >
          {refreshing || loading ? "Actualisation…" : "Rafraîchir"}
        </button>
      </div>

      {/* Contenu */}
      {loading && restaurants.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <div className="h-5 w-5 animate-spin rounded-full border border-emerald-500 border-t-transparent" />
          <p className="text-xs text-gray-500">
            Chargement des restaurants…
          </p>
        </div>
      ) : restaurants.length === 0 ? (
        <div className="border rounded-xl px-4 py-3 bg-slate-950/90 text-sm text-slate-100">
          <p className="font-semibold mb-1">Aucun restaurant disponible</p>
          <p className="text-xs text-slate-300">
            Pour l’instant aucun restaurant n’est encore configuré dans MMD
            Delivery.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {restaurants.map((r) => (
            <Link
              key={r.id}
              href={`/restaurants/${r.id}`}
              className="block border border-slate-800 bg-slate-950/90 rounded-2xl px-4 py-3 hover:border-emerald-500 transition"
            >
              <p className="text-sm font-semibold text-slate-50">
                {r.name ?? "Restaurant MMD"}
              </p>
              {r.address && (
                <p className="text-xs text-slate-300 mt-0.5">{r.address}</p>
              )}
              {r.phone && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Téléphone : {r.phone}
                </p>
              )}

              <p className="text-[11px] text-blue-400 font-semibold mt-2">
                Voir le menu →
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
