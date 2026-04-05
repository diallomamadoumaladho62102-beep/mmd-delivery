"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type RestaurantProfileRow = {
  user_id: string;
  restaurant_name: string | null;
  city: string | null;
  address: string | null;
  cuisine_type: string | null;
};

type RestaurantItemRow = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  restaurant_user_id: string;
};

export default function RestaurantPublicMenuPage() {
  const params = useParams();
  const router = useRouter();
  const restaurantId = params.restaurantId as string | undefined; // slug = user_id

  const [restaurant, setRestaurant] = useState<RestaurantProfileRow | null>(
    null
  );
  const [items, setItems] = useState<RestaurantItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurantId) return;

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setErr(null);

        // Charger le restaurant par user_id
        const { data: rest, error: restError } = await supabase
          .from("restaurant_profiles")
          .select("user_id, restaurant_name, city, address, cuisine_type")
          .eq("user_id", restaurantId)
          .single();

        if (restError) {
          console.error("Restaurant error", restError);
          if (!cancelled) {
            setErr(restError.message);
            setRestaurant(null);
          }
        } else if (!rest) {
          if (!cancelled) {
            setRestaurant(null);
          }
        } else if (!cancelled) {
          setRestaurant(rest as RestaurantProfileRow);
        }

        // Charger le menu du restaurant via restaurant_user_id
        const { data: itemsData, error: itemsError } = await supabase
          .from("restaurant_items")
          .select("id, name, description, price_cents, restaurant_user_id")
          .eq("restaurant_user_id", restaurantId)
          .order("name", { ascending: true });

        if (!cancelled) {
          if (itemsError) {
            console.error("Items error", itemsError);
            setErr((prev) => prev ?? itemsError.message);
            setItems([]);
          } else {
            setItems((itemsData || []) as RestaurantItemRow[]);
          }
        }

        if (!cancelled) {
          setLoading(false);
        }
      } catch (e: any) {
        console.error("Unexpected error in RestaurantPublicMenuPage", e);
        if (!cancelled) {
          setErr("Erreur inattendue lors du chargement du restaurant.");
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  if (!restaurantId) {
    return <div className="p-4">Chargement…</div>;
  }

  if (loading) {
    return <div className="p-4">Chargement du restaurant…</div>;
  }

  if (!restaurant) {
    return (
      <div className="p-4">
        <button
          onClick={() => router.back()}
          className="text-sm text-blue-600 underline mb-2"
        >
          ← Retour
        </button>
        <p>Restaurant introuvable.</p>
        {err && <p className="text-sm text-red-600 mt-2">Détail : {err}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <button
        onClick={() => router.back()}
        className="text-sm text-blue-600 underline"
      >
        ← Retour
      </button>

      <h1 className="text-2xl font-semibold">
        {restaurant.restaurant_name || "Restaurant sans nom"}
      </h1>

      <p className="text-sm text-gray-600">
        {restaurant.address ? `${restaurant.address}, ` : ""}
        {restaurant.city || "Ville inconnue"}
      </p>

      {restaurant.cuisine_type && (
        <p className="text-sm text-gray-600">
          Cuisine : {restaurant.cuisine_type}
        </p>
      )}

      <h2 className="text-lg font-semibold mt-4">Plats disponibles</h2>

      {err && (
        <p className="text-sm text-red-600">
          Erreur lors du chargement du menu : {err}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-gray-600">
          Ce restaurant n&apos;a pas encore de menu configuré.
        </p>
      ) : (
        <div className="space-y-2 mt-2">
          {items.map((item) => {
            const priceDollars =
              item.price_cents != null ? item.price_cents / 100 : null;

            return (
              <div
                key={item.id}
                className="border rounded-lg p-3 bg-white text-sm flex items-center justify-between"
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  {item.description && (
                    <p className="text-xs text-gray-500">
                      {item.description}
                    </p>
                  )}
                </div>
                <p className="text-sm font-semibold">
                  {priceDollars != null
                    ? `${priceDollars.toFixed(2)} USD`
                    : "Prix non renseigné"}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <div className="pt-6">
        <button
          onClick={() =>
            router.push(`/orders/new?restaurantId=${restaurantId}`)
          }
          className="px-6 py-3 bg-green-600 text-white rounded-lg shadow-md text-sm font-semibold"
        >
          Créer une commande pour ce restaurant
        </button>
      </div>
    </div>
  );
}
