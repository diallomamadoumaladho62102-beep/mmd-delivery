"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import {
  computeDeliveryPricing,
  type DeliveryPricingResult,
} from "@/lib/deliveryPricing";
import { getZoneBoostFromCoords } from "@/lib/driverZones";
import { createFoodOrderWithDelivery } from "@/lib/createFoodOrderWithDelivery";

type Profile = {
  id: string;
  full_name: string | null;
  role: string | null;
};

type RestaurantProfile = {
  user_id: string;
  restaurant_name: string | null;
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

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePromoCode(value: string) {
  const text = value.trim().toUpperCase();
  return text || null;
}

function getItemPrice(item: RestaurantItem): number {
  return item.price_cents != null ? item.price_cents / 100 : 0;
}

async function geocodeAddress(address: string) {
  if (!MAPBOX_TOKEN) {
    throw new Error("Token Mapbox manquant (NEXT_PUBLIC_MAPBOX_TOKEN).");
  }

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    address
  )}.json?access_token=${MAPBOX_TOKEN}&limit=1`;

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Mapbox geocoding HTTP ${res.status}. ${text || "Vérifie le token ou les restrictions."}`
    );
  }

  const json = await res.json();
  const feature = json.features?.[0];

  if (!feature || !Array.isArray(feature.center) || feature.center.length < 2) {
    throw new Error("Adresse introuvable.");
  }

  const [lon, lat] = feature.center;

  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
    throw new Error("Coordonnées Mapbox invalides.");
  }

  return { lat, lon };
}

async function getDistanceAndDuration(
  pickupAddress: string,
  dropoffAddress: string
) {
  const pickupPoint = await geocodeAddress(pickupAddress);
  const dropoffPoint = await geocodeAddress(dropoffAddress);

  const R = 3958.8;
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

  const avgSpeedMph = 18;
  const durationMinutes = (distanceMiles / avgSpeedMph) * 60;

  return {
    distanceMiles,
    durationMinutes,
    pickupLat: pickupPoint.lat,
    pickupLon: pickupPoint.lon,
    dropoffLat: dropoffPoint.lat,
    dropoffLon: dropoffPoint.lon,
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

  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [promoCode, setPromoCode] = useState("");

  const [distancePreview, setDistancePreview] = useState<number | null>(null);
  const [etaPreview, setEtaPreview] = useState<number | null>(null);
  const [pricingPreview, setPricingPreview] =
    useState<DeliveryPricingResult | null>(null);

  const [computingPreview, setComputingPreview] = useState(false);
  const [zoneBoostLabelPreview, setZoneBoostLabelPreview] = useState<
    string | null
  >(null);

  const [pickupCoordsPreview, setPickupCoordsPreview] = useState<{
    lat: number;
    lon: number;
  } | null>(null);

  const [dropoffCoordsPreview, setDropoffCoordsPreview] = useState<{
    lat: number;
    lon: number;
  } | null>(null);

  const currency = "USD";

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
        .select("user_id, restaurant_name")
        .order("restaurant_name", { ascending: true });

      if (restError) {
        if (!cancelled) {
          setErr(restError.message);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setRestaurants((restData || []) as RestaurantProfile[]);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const presetId = searchParams?.get("restaurantId");
    if (presetId) {
      setSelectedRestaurantId(presetId);
    }
  }, [searchParams]);

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

  const selectedRestaurant = useMemo(
    () => restaurants.find((r) => r.user_id === selectedRestaurantId) ?? null,
    [restaurants, selectedRestaurantId]
  );

  const subtotal = useMemo(
    () => round2(cart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)),
    [cart]
  );

  const tax = useMemo(() => round2(subtotal * 0.0888), [subtotal]);
  const totalExcludingDelivery = useMemo(() => round2(subtotal + tax), [subtotal, tax]);

  const deliveryFeePreview = pricingPreview?.deliveryFee ?? null;
  const estimatedGrandTotal = useMemo(() => {
    if (deliveryFeePreview == null) return null;
    return round2(totalExcludingDelivery + deliveryFeePreview);
  }, [deliveryFeePreview, totalExcludingDelivery]);

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

  async function handleComputeDeliveryPreview() {
    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      setErr(
        "Merci de saisir l’adresse pickup et l’adresse de livraison pour calculer la livraison."
      );
      return;
    }

    setErr(null);
    setComputingPreview(true);
    setZoneBoostLabelPreview(null);

    try {
      const {
        distanceMiles,
        durationMinutes,
        pickupLat,
        pickupLon,
        dropoffLat,
        dropoffLon,
      } = await getDistanceAndDuration(
        pickupAddress.trim(),
        dropoffAddress.trim()
      );

      setPickupCoordsPreview({ lat: pickupLat, lon: pickupLon });
      setDropoffCoordsPreview({ lat: dropoffLat, lon: dropoffLon });

      let pricing = computeDeliveryPricing({
        distanceMiles,
        durationMinutes,
      });

      if (pickupLat != null && pickupLon != null) {
        const { zone, multiplier } = getZoneBoostFromCoords(pickupLat, pickupLon);

        if (multiplier > 1 && pricing.deliveryFee != null) {
          pricing = {
            ...pricing,
            deliveryFee: round2(pricing.deliveryFee * multiplier),
            driverPayout:
              pricing.driverPayout != null
                ? round2(pricing.driverPayout * multiplier)
                : pricing.driverPayout,
            platformFee:
              pricing.platformFee != null
                ? round2(pricing.platformFee * multiplier)
                : pricing.platformFee,
          };

          const label = `x${multiplier.toFixed(1)}`;
          setZoneBoostLabelPreview(
            zone ? `${zone.name} ${label}` : `Boost de zone ${label}`
          );
        }
      }

      setDistancePreview(round2(distanceMiles));
      setEtaPreview(Math.max(0, Math.round(durationMinutes)));
      setPricingPreview(pricing);
    } catch (e: unknown) {
      const message =
        e instanceof Error
          ? e.message
          : "Impossible de calculer la distance/prix pour le moment.";

      setErr(message);
      setZoneBoostLabelPreview(null);
      setPickupCoordsPreview(null);
      setDropoffCoordsPreview(null);
      setDistancePreview(null);
      setEtaPreview(null);
      setPricingPreview(null);
    } finally {
      setComputingPreview(false);
    }
  }

  async function ensureCoords() {
    if (
      pickupCoordsPreview?.lat != null &&
      pickupCoordsPreview?.lon != null &&
      dropoffCoordsPreview?.lat != null &&
      dropoffCoordsPreview?.lon != null
    ) {
      return {
        pickupLat: pickupCoordsPreview.lat,
        pickupLng: pickupCoordsPreview.lon,
        dropoffLat: dropoffCoordsPreview.lat,
        dropoffLng: dropoffCoordsPreview.lon,
      };
    }

    const result = await getDistanceAndDuration(
      pickupAddress.trim(),
      dropoffAddress.trim()
    );

    setPickupCoordsPreview({ lat: result.pickupLat, lon: result.pickupLon });
    setDropoffCoordsPreview({ lat: result.dropoffLat, lon: result.dropoffLon });
    setDistancePreview(round2(result.distanceMiles));
    setEtaPreview(Math.max(0, Math.round(result.durationMinutes)));

    return {
      pickupLat: result.pickupLat,
      pickupLng: result.pickupLon,
      dropoffLat: result.dropoffLat,
      dropoffLng: result.dropoffLon,
    };
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!profile) {
      setErr("Profil introuvable.");
      return;
    }

    if (!selectedRestaurantId || !selectedRestaurant) {
      setErr("Choisis un restaurant.");
      return;
    }

    if (cart.length === 0) {
      setErr("Ton panier est vide.");
      return;
    }

    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      setErr("Merci de renseigner les adresses pickup et livraison.");
      return;
    }

    setSubmitting(true);
    setErr(null);

    try {
      const coords = await ensureCoords();

      const result = await createFoodOrderWithDelivery({
        clientId: profile.id,
        restaurantUserId: selectedRestaurantId,
        restaurantName: selectedRestaurant.restaurant_name ?? "Restaurant",
        pickupAddress: pickupAddress.trim(),
        pickupLat: coords.pickupLat,
        pickupLng: coords.pickupLng,
        dropoffAddress: dropoffAddress.trim(),
        dropoffLat: coords.dropoffLat,
        dropoffLng: coords.dropoffLng,
        items: cart.map((c) => ({
          name: c.name,
          category: c.category,
          quantity: c.quantity,
          unit_price: c.unit_price,
        })),
        subtotal,
        tax,
        currency,
        promoCode: normalizePromoCode(promoCode),
      });

      const orderId = result.orderId;

      const { error: membersError } = await supabase.from("order_members").upsert(
        [
          { order_id: orderId, user_id: profile.id, role: "client" },
          { order_id: orderId, user_id: selectedRestaurantId, role: "restaurant" },
        ],
        {
          onConflict: "order_id,user_id",
          ignoreDuplicates: false,
        }
      );

      if (membersError) {
        throw new Error(
          `Commande créée, mais ajout order_members échoué: ${membersError.message}`
        );
      }

      router.push(`/orders/${orderId}`);
    } catch (e: unknown) {
      const message =
        e instanceof Error
          ? e.message
          : "Erreur inattendue lors de la création de la commande.";

      setErr(message);
    } finally {
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
          <span className="font-medium">{profile.full_name || profile.id}</span> — rôle :
          client
        </p>
      )}

      {err && <p className="text-sm text-red-600">Erreur : {err}</p>}

      <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
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
                  {r.restaurant_name ?? r.user_id}
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
                        <p className="text-xs text-gray-500">{item.category}</p>
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

        <section className="space-y-3">
          <div className="border rounded-lg p-3 bg-white space-y-2 text-sm">
            <h2 className="text-sm font-semibold mb-1">
              Adresses pour la livraison
            </h2>

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

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Code promo
              </label>
              <input
                type="text"
                className="w-full border rounded-lg px-3 py-2 text-xs uppercase"
                placeholder="Ex : SAVE10"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                maxLength={32}
              />
              <p className="text-[11px] text-gray-500 mt-1">
                La promo finale est validée côté serveur au moment de créer la commande.
              </p>
            </div>

            <button
              type="button"
              onClick={handleComputeDeliveryPreview}
              disabled={computingPreview}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50"
            >
              {computingPreview
                ? "Calcul de la livraison…"
                : "Calculer estimation livraison"}
            </button>

            {(pickupCoordsPreview || dropoffCoordsPreview) && (
              <div className="text-[11px] text-gray-500 border rounded p-2 bg-gray-50">
                <div>
                  Pickup coords:{" "}
                  {pickupCoordsPreview
                    ? `${pickupCoordsPreview.lat.toFixed(
                        5
                      )}, ${pickupCoordsPreview.lon.toFixed(5)}`
                    : "—"}
                </div>
                <div>
                  Dropoff coords:{" "}
                  {dropoffCoordsPreview
                    ? `${dropoffCoordsPreview.lat.toFixed(
                        5
                      )}, ${dropoffCoordsPreview.lon.toFixed(5)}`
                    : "—"}
                </div>
              </div>
            )}
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
                        <p className="text-xs text-gray-500">{item.category}</p>
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
                          updateQuantity(item.id, Number(e.target.value) || 1)
                        }
                        className="w-16 border rounded-lg px-2 py-1 text-xs"
                      />
                      <p className="text-xs font-semibold">
                        {(item.unit_price * item.quantity).toFixed(2)} {currency}
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
              {totalExcludingDelivery.toFixed(2)} {currency}
            </p>
          </div>

          <div className="border rounded-lg p-3 bg-white space-y-1 text-sm">
            <h2 className="text-sm font-semibold mb-1">Livraison estimée</h2>

            <p className="text-[11px] text-gray-500 mb-1">
              Utilise le bouton ci-dessus pour estimer la distance et le prix.
            </p>

            <p>
              <span className="font-medium">Distance :</span>{" "}
              {distancePreview != null ? `${distancePreview.toFixed(2)} mi` : "—"}
            </p>
            <p>
              <span className="font-medium">Temps estimé :</span>{" "}
              {etaPreview != null ? `${etaPreview} min` : "—"}
            </p>
            <p>
              <span className="font-medium">Frais de livraison :</span>{" "}
              {deliveryFeePreview != null
                ? `${deliveryFeePreview.toFixed(2)} ${currency}`
                : "—"}
            </p>

            {zoneBoostLabelPreview && (
              <p className="text-[11px] text-amber-600">
                Bonus de zone appliqué : {zoneBoostLabelPreview}
              </p>
            )}

            <p className="font-semibold pt-1">
              Total estimé avec livraison :{" "}
              {estimatedGrandTotal != null
                ? `${estimatedGrandTotal.toFixed(2)} ${currency}`
                : "—"}
            </p>

            {promoCode.trim() && (
              <p className="text-[11px] text-gray-500">
                Le code promo <span className="font-medium">{promoCode.trim().toUpperCase()}</span>{" "}
                sera validé côté serveur lors de la création.
              </p>
            )}
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
