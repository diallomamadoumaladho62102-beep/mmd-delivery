"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import {
  computeDeliveryPricing,
  type DeliveryPricingResult,
} from "@/lib/deliveryPricing";

type Profile = {
  id: string;
  full_name: string | null;
  role: string | null;
};

type RestaurantProfile = {
  user_id: string;
  restaurant_name: string;
};

type RestaurantItem = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  restaurant_user_id: string;
  category?: string | null;
};

type CartItem = {
  id: string;
  name: string;
  category: string | null;
  unit_price: number;
  quantity: number;
};

// ✅ Ton token Mapbox public (le même que sur le mobile)
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// 🌍 Geocoding d'une adresse avec Mapbox (WEB)
async function geocodeAddress(address: string) {
  if (!MAPBOX_TOKEN) {
    throw new Error("Token Mapbox manquant (NEXT_PUBLIC_MAPBOX_TOKEN).");
  }

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    address
  )}.json?access_token=${MAPBOX_TOKEN}&limit=1`;

  console.log("[MMD] Mapbox geocoding URL =", url);

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[MMD] Mapbox geocoding error:", res.status, text);
    throw new Error(
      `Mapbox geocoding HTTP ${res.status} (web) – vérifie le token / les restrictions.`
    );
  }

  const json = await res.json();
  console.log("[MMD] Mapbox geocoding JSON =", json);

  const feature = json.features?.[0];

  if (!feature || !feature.center) {
    throw new Error("Adresse introuvable (web).");
  }

  const [lon, lat] = feature.center;
  return { lat, lon };
}

// 🚗 Distance + durée (WEB) SANS API Directions – Haversine + vitesse moyenne
async function getDistanceAndDuration(
  pickupAddress: string,
  dropoffAddress: string
) {
  // 1) On géocode les deux adresses (ça, on sait que ça marche chez toi)
  const pickupPoint = await geocodeAddress(pickupAddress);
  const dropoffPoint = await geocodeAddress(dropoffAddress);

  // 2) Distance "à vol d’oiseau" avec la formule de Haversine
  const R = 3958.8; // rayon de la Terre en miles
  const toRad = (x: number) => (x * Math.PI) / 180;

  const dLat = toRad(dropoffPoint.lat - pickupPoint.lat);
  const dLon = toRad(dropoffPoint.lon - pickupPoint.lon);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(pickupPoint.lat)) *
      Math.cos(toRad(dropoffPoint.lat)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceMiles = R * c;

  // 3) Estimation du temps de trajet (ex : 18 mph de moyenne en ville)
  const avgSpeedMph = 18; // tu pourras ajuster
  const durationMinutes = (distanceMiles / avgSpeedMph) * 60;

  console.log("[MMD] Haversine distance =", distanceMiles, "miles");
  console.log("[MMD] Estimated duration =", durationMinutes, "minutes");

  return {
    distanceMiles,
    durationMinutes,
  };
}

export default function NewOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [restaurants, setRestaurants] = useState<RestaurantProfile[]>([]);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string>("");
  const [menuItems, setMenuItems] = useState<RestaurantItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 🆕 Adresses pour Mapbox (WEB)
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");

  // 🆕 Prévisualisation livraison
  const [distancePreview, setDistancePreview] = useState<number | null>(null);
  const [etaPreview, setEtaPreview] = useState<number | null>(null);
  const [pricingPreview, setPricingPreview] =
    useState<DeliveryPricingResult | null>(null);
  const [computingPreview, setComputingPreview] = useState(false);

  const currency = "USD";

  // Prix en $ à partir de price_cents
  function getItemPrice(item: RestaurantItem): number {
    if (item.price_cents != null) {
      return item.price_cents / 100;
    }
    return 0;
  }

  // 1) Chargement profil + liste de restaurants
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      const { data: userData, error: userError } =
        await supabase.auth.getUser();
      if (userError || !userData.user) {
        if (!cancelled) {
          setErr("Tu dois être connecté pour créer une commande.");
          setLoading(false);
        }
        return;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("id", userData.user.id)
        .maybeSingle();

      if (!cancelled) {
        setProfile(
          prof
            ? (prof as Profile)
            : {
                id: userData.user.id,
                full_name: userData.user.email ?? null,
                role: null,
              }
        );
      }

      const { data: restData, error: restError } = await supabase
        .from("restaurant_profiles")
        .select("user_id, restaurant_name");

      console.log("DEBUG /orders/new restaurants query:", {
        restData,
        restError,
      });

      if (restError) {
        if (!cancelled) {
          setErr(restError.message);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        const list = (restData || []) as RestaurantProfile[];
        setRestaurants(list);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  // 2) Pré-sélection depuis ?restaurantId=...
  useEffect(() => {
    const presetId = searchParams?.get("restaurantId");
    if (presetId) {
      setSelectedRestaurantId(presetId);
    }
  }, [searchParams]);

  // 3) Charger le menu DU resto sélectionné
  useEffect(() => {
    if (!selectedRestaurantId) {
      setMenuItems([]);
      return;
    }

    let cancelled = false;

    async function loadMenu() {
      setErr(null);

      const { data, error } = await supabase
        .from("restaurant_items")
        .select(
          "id, name, description, price_cents, restaurant_user_id, category"
        )
        .eq("restaurant_user_id", selectedRestaurantId)
        .order("name", { ascending: true });

      console.log("DEBUG /orders/new menu query:", {
        data,
        error,
        selectedRestaurantId,
      });

      if (!cancelled) {
        if (error) {
          setErr(error.message);
          setMenuItems([]);
        } else {
          setMenuItems((data || []) as RestaurantItem[]);
        }
      }
    }

    loadMenu();

    return () => {
      cancelled = true;
    };
  }, [selectedRestaurantId]);

  const subtotal = useMemo(
    () =>
      cart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0),
    [cart]
  );

  const tax = useMemo(() => +(subtotal * 0.0888).toFixed(2), [subtotal]);
  const total = useMemo(() => subtotal + tax, [subtotal, tax]);

  function addToCart(item: RestaurantItem) {
    const price = getItemPrice(item);

    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          category: item.category ?? null,
          unit_price: price,
          quantity: 1,
        },
      ];
    });
  }

  function updateQuantity(id: string, quantity: number) {
    setCart((prev) =>
      prev
        .map((c) => (c.id === id ? { ...c, quantity } : c))
        .filter((c) => c.quantity > 0)
    );
  }

  function removeFromCart(id: string) {
    setCart((prev) => prev.filter((c) => c.id !== id));
  }

  // 🆕 Bouton "Calculer estimation livraison" (Mapbox + formule MMD)
  async function handleComputeDeliveryPreview() {
    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      setErr(
        "Merci de saisir l’adresse pickup et l’adresse de livraison pour calculer la livraison."
      );
      return;
    }

    setErr(null);
    setComputingPreview(true);

    try {
      const { distanceMiles, durationMinutes } = await getDistanceAndDuration(
        pickupAddress.trim(),
        dropoffAddress.trim()
      );

      const pricing = computeDeliveryPricing({
        distanceMiles,
        durationMinutes,
      });

      setDistancePreview(Number(distanceMiles.toFixed(2)));
      setEtaPreview(Math.round(durationMinutes));
      setPricingPreview(pricing);
    } catch (e: any) {
      console.error("Erreur estimation livraison (web):", e);
      setErr(
        e?.message ||
          "Impossible de calculer la distance/prix avec Mapbox pour le moment."
      );
    } finally {
      setComputingPreview(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile) {
      setErr("Profil introuvable.");
      return;
    }
    if (!selectedRestaurantId) {
      setErr("Choisis un restaurant.");
      return;
    }
    if (cart.length === 0) {
      setErr("Ton panier est vide.");
      return;
    }

    setSubmitting(true);
    setErr(null);

    try {
      const { data: restProfile } = await supabase
        .from("restaurant_profiles")
        .select("restaurant_name")
        .eq("user_id", selectedRestaurantId)
        .maybeSingle();

      // 🔐 Codes sécurité
      const pickupCode = Math.random().toString(36).slice(2, 8).toUpperCase();
      const dropoffCode = Math.floor(
        100000 + Math.random() * 900000
      ).toString();

      // 🌍 Calcul distance + durée + frais livraison AVANT insertion
      let distanceMiles: number | null = null;
      let etaMinutes: number | null = null;
      let pricing: DeliveryPricingResult | null = null;

      if (pickupAddress.trim() && dropoffAddress.trim()) {
        try {
          const result = await getDistanceAndDuration(
            pickupAddress.trim(),
            dropoffAddress.trim()
          );
          distanceMiles = Number(result.distanceMiles.toFixed(2));
          etaMinutes = Math.round(result.durationMinutes);
          pricing = computeDeliveryPricing({
            distanceMiles,
            durationMinutes: result.durationMinutes,
          });
        } catch (mapErr) {
          console.error("Erreur Mapbox dans handleSubmit (web):", mapErr);
          // On laisse distance/prix à null → commande quand même créée
        }
      }

      const deliveryFee = pricing?.deliveryFee ?? null;
      const driverPayout = pricing?.driverPayout ?? null;
      const platformFee = pricing?.platformFee ?? null;

      const { data: insertOrder, error: insertError } = await supabase
        .from("orders")
        .insert({
          kind: "food",
          user_id: profile.id,
          created_by: profile.id,
          restaurant_id: selectedRestaurantId,
          restaurant_name: restProfile?.restaurant_name ?? null,
          items_json: cart.map((c) => ({
            name: c.name,
            category: c.category,
            quantity: c.quantity,
            unit_price: c.unit_price,
            line_total: c.unit_price * c.quantity,
          })),
          subtotal,
          tax,
          total,
          currency,
          status: "pending",

          // 🌍 Données livraison (web)
          pickup_address: pickupAddress.trim() || null,
          dropoff_address: dropoffAddress.trim() || null,
          distance_miles: distanceMiles,
          eta_minutes: etaMinutes,
          delivery_fee: deliveryFee,

          // 💸 Split MMD / chauffeur (web)
          driver_delivery_payout: driverPayout,
          platform_delivery_fee: platformFee,

          // 🔐 Codes sécurité
          pickup_code: pickupCode,
          dropoff_code: dropoffCode,
        })
        .select("id")
        .single();

      if (insertError || !insertOrder) {
        throw insertError ?? new Error("Insertion de la commande échouée.");
      }

      const orderId = insertOrder.id as string;

      await supabase.from("order_members").insert([
        { order_id: orderId, user_id: profile.id, role: "client" },
        { order_id: orderId, user_id: selectedRestaurantId, role: "restaurant" },
      ]);

      router.push(`/orders/${orderId}`);
    } catch (e: any) {
      console.error(e);
      setErr(
        e.message ?? "Erreur inattendue lors de la création de la commande."
      );
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold">Créer une nouvelle commande</h1>
        <p className="text-sm text-gray-600 mt-2">
          Chargement des restaurants et de ton profil…
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <h1 className="text-2xl font-bold">Créer une nouvelle commande</h1>

      {profile && (
        <p className="text-xs text-gray-600 mb-2">
          Connecté en tant que{" "}
          <span className="font-medium">
            {profile.full_name || profile.id}
          </span>{" "}
          — rôle : client
        </p>
      )}

      <div className="text-[11px] text-gray-500 bg-gray-50 border rounded p-2">
        <div>DEBUG restaurants.length = {restaurants.length}</div>
        {restaurants.map((r) => (
          <div key={r.user_id}>
            • id: {r.user_id} — nom: {r.restaurant_name}
          </div>
        ))}
        {err && <div>DEBUG err = {err}</div>}
      </div>

      {err && <p className="text-sm text-red-600">Erreur : {err}</p>}

      <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
        {/* COLONNE GAUCHE : resto + menu */}
        <section className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Restaurant
            </label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={selectedRestaurantId}
              onChange={(e) => setSelectedRestaurantId(e.target.value)}
            >
              <option value="">– Choisir un restaurant –</option>
              {restaurants.map((r) => (
                <option key={r.user_id} value={r.user_id}>
                  {r.restaurant_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <h2 className="text-sm font-semibold mb-2">Menu du restaurant</h2>
            {!selectedRestaurantId && (
              <p className="text-xs text-gray-500">
                Choisis un restaurant pour voir son menu.
              </p>
            )}
            {selectedRestaurantId && menuItems.length === 0 && (
              <p className="text-xs text-gray-500">
                Ce restaurant n&apos;a pas encore de menu configuré.
              </p>
            )}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {menuItems.map((item) => {
                const price = getItemPrice(item);
                return (
                  <div
                    key={item.id}
                    className="border rounded-lg p-2 flex items-center justify-between text-sm"
                  >
                    <div>
                      <p className="font-medium">{item.name}</p>
                      {item.category && (
                        <p className="text-xs text-gray-500">
                          {item.category}
                        </p>
                      )}
                      {item.description && (
                        <p className="text-xs text-gray-500">
                          {item.description}
                        </p>
                      )}
                      <p className="text-xs text-gray-600">
                        {price.toFixed(2)} {currency}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addToCart(item)}
                      className="px-3 py-1.5 rounded-lg bg-black text-white text-xs font-semibold"
                    >
                      Ajouter
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* COLONNE DROITE : adresses + panier + livraison */}
        <section className="space-y-3">
          {/* 🆕 Adresses pour Mapbox */}
          <div className="border rounded-lg p-3 bg-white space-y-2 text-sm">
            <h2 className="text-sm font-semibold mb-1">
              Adresses pour la livraison (Mapbox)
            </h2>
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Adresse pickup (restaurant / point de départ)
                </label>
                <input
                  type="text"
                  className="w-full border rounded-lg px-3 py-2 text-xs"
                  placeholder="Ex : 686 Vermont St, Brooklyn, NY 11207"
                  value={pickupAddress}
                  onChange={(e) => setPickupAddress(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Adresse de livraison (client)
                </label>
                <input
                  type="text"
                  className="w-full border rounded-lg px-3 py-2 text-xs"
                  placeholder="Ex : 1112 Flatbush Ave, Brooklyn, NY 11226"
                  value={dropoffAddress}
                  onChange={(e) => setDropoffAddress(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={handleComputeDeliveryPreview}
                disabled={computingPreview}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50"
              >
                {computingPreview
                  ? "Calcul de la livraison…"
                  : "Calculer estimation livraison (Mapbox)"}
              </button>
            </div>
          </div>

          <div className="border rounded-lg p-3 bg-white">
            <h2 className="text-sm font-semibold mb-2">Panier</h2>
            {cart.length === 0 ? (
              <p className="text-xs text-gray-500">
                Ton panier est vide. Ajoute des plats depuis le menu.
              </p>
            ) : (
              <div className="space-y-2">
                {cart.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{item.name}</p>
                      {item.category && (
                        <p className="text-xs text-gray-500">
                          {item.category}
                        </p>
                      )}
                      <p className="text-xs text-gray-500">
                        {item.unit_price.toFixed(2)} {currency} / unité
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) =>
                          updateQuantity(
                            item.id,
                            Number(e.target.value) || 1
                          )
                        }
                        className="w-16 border rounded-lg px-2 py-1 text-xs"
                      />
                      <p className="text-xs font-semibold">
                        {(item.unit_price * item.quantity).toFixed(2)}{" "}
                        {currency}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border rounded-lg p-3 bg-white space-y-1 text-sm">
            <p>
              <span className="font-medium">Sous-total :</span>{" "}
              {subtotal.toFixed(2)} {currency}
            </p>
            <p>
              <span className="font-medium">Taxes (~8.88%) :</span>{" "}
              {tax.toFixed(2)} {currency}
            </p>
            <p>
              <span className="font-medium">Total (hors livraison) :</span>{" "}
              {total.toFixed(2)} {currency}
            </p>
          </div>

          {/* 🆕 Bloc livraison basé sur la dernière estimation */}
          <div className="border rounded-lg p-3 bg-white space-y-1 text-sm">
            <h2 className="text-sm font-semibold mb-1">
              Livraison (formule officielle MMD + Mapbox)
            </h2>
            <p className="text-[11px] text-gray-500 mb-1">
              Utilise le bouton ci-dessus pour estimer la distance et le prix.
            </p>
            <p>
              <span className="font-medium">Distance :</span>{" "}
              {distancePreview != null
                ? `${distancePreview.toFixed(2)} mi`
                : "—"}
            </p>
            <p>
              <span className="font-medium">Temps estimé :</span>{" "}
              {etaPreview != null ? `${etaPreview} min` : "—"}
            </p>
            <p>
              <span className="font-medium">Frais de livraison :</span>{" "}
              {pricingPreview
                ? `${pricingPreview.deliveryFee.toFixed(2)} ${currency}`
                : "—"}
            </p>
            <p className="font-semibold pt-1">
              Total estimé avec livraison :{" "}
              {pricingPreview
                ? `${(total + pricingPreview.deliveryFee).toFixed(
                    2
                  )} ${currency}`
                : "—"}
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting || cart.length === 0 || !selectedRestaurantId}
            className="w-full mt-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Création de la commande…" : "Créer la commande"}
          </button>
        </section>
      </form>
    </main>
  );
}
