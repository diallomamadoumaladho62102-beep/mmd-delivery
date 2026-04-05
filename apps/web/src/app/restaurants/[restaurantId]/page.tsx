"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  is_available: boolean;
};

type RestaurantProfile = {
  restaurant_name: string | null;
  address: string | null;
  phone: string | null;
};

type CartItem = {
  item: MenuItem;
  quantity: number;
};

export default function RestaurantMenuPage() {
  const params = useParams<{ restaurantId: string }>();
  const router = useRouter();
  const restaurantId = params.restaurantId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantProfile | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);

  // 🛒 Panier
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [creatingOrder, setCreatingOrder] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        // 1) Profil du restaurant
        const { data: profile, error: profileError } = await supabase
          .from("restaurant_profiles")
          .select(
            `
            restaurant_name,
            address,
            phone
          `
          )
          .eq("user_id", restaurantId)
          .maybeSingle();

        if (profileError) throw profileError;
        setRestaurant(profile as RestaurantProfile | null);

        // 2) Menu du restaurant
        const { data: menuRows, error: menuError } = await supabase
          .from("restaurant_menu_items")
          .select(
            `
            id,
            name,
            description,
            category,
            price,
            is_available
          `
          )
          .eq("restaurant_id", restaurantId)
          .order("category", { ascending: true })
          .order("name", { ascending: true });

        if (menuError) throw menuError;

        setItems((menuRows ?? []) as MenuItem[]);
      } catch (e: any) {
        console.error("Erreur chargement menu restaurant (web):", e);
        setError(
          e?.message ??
            "Impossible de charger le menu pour ce restaurant pour le moment."
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [restaurantId]);

  const title =
    restaurant?.restaurant_name ?? "Menu du restaurant MMD Delivery";

  // 🧮 Calcul total / sous-total
  const subtotal = useMemo(() => {
    return Object.values(cart).reduce((sum, cartItem) => {
      return sum + cartItem.item.price * cartItem.quantity;
    }, 0);
  }, [cart]);

  const taxRate = 0.08875; // ~8.875% NYC (pour test)
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  const totalItems = useMemo(() => {
    return Object.values(cart).reduce(
      (sum, cartItem) => sum + cartItem.quantity,
      0
    );
  }, [cart]);

  function handleAdd(item: MenuItem) {
    setCart((prev) => {
      const existing = prev[item.id];
      const newQty = (existing?.quantity ?? 0) + 1;
      return {
        ...prev,
        [item.id]: { item, quantity: newQty },
      };
    });
  }

  function handleRemove(item: MenuItem) {
    setCart((prev) => {
      const existing = prev[item.id];
      if (!existing) return prev;

      const newQty = existing.quantity - 1;
      if (newQty <= 0) {
        const { [item.id]: _, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [item.id]: { item, quantity: newQty },
      };
    });
  }

  const cartIsEmpty = totalItems === 0;

  // ✅ Création de la commande "food" comme sur mobile
  async function handleCreateOrder() {
    if (!restaurantId) return;
    if (cartIsEmpty) return;

    try {
      setCreatingOrder(true);
      setError(null);

      // 1) Vérifier que le client est connecté
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        setError("Tu dois être connecté pour passer une commande.");
        setCreatingOrder(false);
        return;
      }
      const userId = sessionData.session.user.id;

      // 2) Construire items_json
      const itemsJson = Object.values(cart).map((c) => ({
        name: c.item.name,
        category: c.item.category,
        quantity: c.quantity,
        unit_price: c.item.price,
        line_total: c.item.price * c.quantity,
      }));

      const roundedSubtotal = Number(subtotal.toFixed(2));
      const roundedTax = Number(tax.toFixed(2));
      const roundedTotal = Number(total.toFixed(2));

      // 3) Insérer dans orders
      const { data: insertData, error: insertError } = await supabase
        .from("orders")
        .insert({
          type: "food", // 👈 type "food" pour les menus
          status: "pending",
          restaurant_id: restaurantId,
          restaurant_name: restaurant?.restaurant_name ?? null,
          pickup_address: restaurant?.address ?? null,
          dropoff_address: null,
          items_json: itemsJson,
          subtotal: roundedSubtotal,
          tax: roundedTax,
          total: roundedTotal,
          currency: "USD",
          created_by: userId,
        })
        .select()
        .single();

      if (insertError || !insertData) {
        console.error("Erreur création commande restaurant (web):", insertError);
        throw insertError ?? new Error("Création de la commande échouée.");
      }

      const orderId = (insertData as any).id as string;

      // 4) Enregistrer le client comme membre de la commande (chat / suivi)
      try {
        await supabase.rpc("join_order", {
          p_order_id: orderId,
          p_role: "client",
        });
      } catch (e) {
        console.warn("Erreur join_order côté client (web):", e);
      }

      // 5) Vider panier + redirection vers page commande
      setCart({});
      router.push(`/orders/${orderId}`);
    } catch (e: any) {
      console.error("Erreur handleCreateOrder (web):", e);
      setError(
        e?.message ??
          "Impossible de créer la commande pour le moment. Réessaie plus tard."
      );
    } finally {
      setCreatingOrder(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      {/* HEADER */}
      <header className="space-y-1">
        <p className="text-sm font-semibold text-emerald-500">Espace client</p>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-600">
          Choisis tes plats, ajuste les quantités et valide ta commande en
          quelques secondes.
        </p>

        {restaurant?.address && (
          <p className="text-xs text-gray-500 mt-1">
            Adresse : {restaurant.address}
          </p>
        )}
        {restaurant?.phone && (
          <p className="text-xs text-gray-500">Téléphone : {restaurant.phone}</p>
        )}
      </header>

      {/* Boutons retour */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/client"
          className="inline-flex items-center px-3 py-1.5 rounded-full border text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          ← Retour à l’espace client
        </Link>
        <Link
          href="/restaurants"
          className="inline-flex items-center px-3 py-1.5 rounded-full border text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          ← Retour à la liste des restaurants
        </Link>
      </div>

      {/* Erreur */}
      {error && (
        <div className="border border-red-200 bg-red-50 text-xs text-red-700 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Chargement */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <div className="h-5 w-5 animate-spin rounded-full border border-emerald-500 border-t-transparent" />
          <p className="text-xs text-gray-500">Chargement du menu…</p>
        </div>
      )}

      {/* Contenu du menu */}
      {!loading && !error && (
        <>
          {items.length === 0 ? (
            <div className="border rounded-xl px-4 py-3 bg-slate-950/90 text-sm text-slate-100">
              <p className="font-semibold mb-1">
                Aucun plat configuré pour ce restaurant.
              </p>
              <p className="text-xs text-slate-300">
                Le propriétaire du restaurant doit d&apos;abord ajouter des
                plats dans son menu MMD Delivery.
              </p>
            </div>
          ) : (
            <section className="space-y-3">
              {items.map((item) => {
                const cartItem = cart[item.id];
                const qty = cartItem?.quantity ?? 0;

                return (
                  <div
                    key={item.id}
                    className="border border-slate-800 bg-slate-950/90 rounded-2xl px-4 py-3 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-50">
                          {item.name}
                        </p>
                        {item.category && (
                          <p className="text-[11px] text-slate-400">
                            {item.category}
                          </p>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-emerald-400">
                        {item.price.toFixed(2)} USD
                      </p>
                    </div>

                    {item.description && (
                      <p className="text-xs text-slate-300">
                        {item.description}
                      </p>
                    )}

                    {!item.is_available && (
                      <p className="text-[11px] text-red-300">
                        Indisponible pour le moment.
                      </p>
                    )}

                    {/* Contrôles quantité */}
                    {item.is_available && (
                      <div className="flex items-center justify-between gap-3 mt-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleRemove(item)}
                            disabled={qty === 0}
                            className="w-7 h-7 flex items-center justify-center rounded-full border border-slate-600 text-slate-100 text-sm disabled:opacity-40"
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-sm text-slate-50">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleAdd(item)}
                            className="w-7 h-7 flex items-center justify-center rounded-full bg-emerald-500 text-white text-sm"
                          >
                            +
                          </button>
                        </div>

                        {qty > 0 && (
                          <p className="text-[11px] text-slate-300">
                            Ligne :{" "}
                            <span className="font-semibold">
                              {(item.price * qty).toFixed(2)} USD
                            </span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}

      {/* Récapitulatif panier */}
      {!loading && (
        <section className="border rounded-xl px-4 py-3 bg-white space-y-2">
          <h2 className="text-sm font-semibold">Récapitulatif de ta commande</h2>

          {cartIsEmpty ? (
            <p className="text-xs text-gray-500">
              Ajoute au moins un plat pour pouvoir valider ta commande.
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-600">
                Nombre d&apos;articles :{" "}
                <span className="font-semibold">{totalItems}</span>
              </p>
              <p className="text-xs text-gray-600">
                Sous-total :{" "}
                <span className="font-semibold">
                  {subtotal.toFixed(2)} USD
                </span>
              </p>
              <p className="text-xs text-gray-600">
                Taxes (approx.) :{" "}
                <span className="font-semibold">{tax.toFixed(2)} USD</span>
              </p>
              <p className="text-xs text-gray-900">
                Total estimé :{" "}
                <span className="font-semibold">
                  {total.toFixed(2)} USD
                </span>
              </p>
            </>
          )}

          <button
            type="button"
            disabled={cartIsEmpty || creatingOrder}
            onClick={handleCreateOrder}
            className="mt-2 inline-flex items-center justify-center px-4 py-2 rounded-full text-sm font-semibold text-white bg-emerald-600 disabled:opacity-50"
          >
            {creatingOrder
              ? "Création de la commande…"
              : cartIsEmpty
              ? "Ajoute des plats pour continuer"
              : "Valider la commande"}
          </button>

          <p className="text-[11px] text-gray-500 mt-1">
            Après validation, tu seras redirigé vers la page de la commande pour
            suivre le statut, le chauffeur et utiliser le chat.
          </p>
        </section>
      )}
    </main>
  );
}
