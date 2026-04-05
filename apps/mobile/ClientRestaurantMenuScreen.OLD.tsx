import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import Constants from "expo-constants";
import { supabase } from "../lib/supabase";

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientRestaurantMenu">;
type Route = RouteProp<RootStackParamList, "ClientRestaurantMenu">;

type RestaurantItem = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  category?: string | null;
  restaurant_user_id: string;
};

type CartItem = {
  id: string;
  name: string;
  category: string | null;
  unit_price: number;
  quantity: number;
};

type ApiDeliveryPrice = {
  deliveryFee: number;
  platformFee: number;
  driverPayout: number;
};

type ApiCoords = {
  pickupLat?: number;
  pickupLng?: number;
  pickupLon?: number;

  dropoffLat?: number;
  dropoffLng?: number;
  dropoffLon?: number;
};

type MapboxDistanceResponse = {
  ok?: boolean;

  distanceMiles?: number;
  distance_miles_est?: number;

  etaMinutes?: number;
  eta_minutes_est?: number;

  deliveryPrice?: ApiDeliveryPrice;
  delivery_fee?: ApiDeliveryPrice;

  // ✅ coords "modernes"
  pickupLat?: number;
  pickupLng?: number;
  pickupLon?: number;

  dropoffLat?: number;
  dropoffLng?: number;
  dropoffLon?: number;

  // ✅ coords "snake_case"
  pickup_lat?: number;
  pickup_lng?: number;
  pickup_lng?: number;

  dropoff_lat?: number;
  dropoff_lng?: number;
  dropoff_lng?: number;

  // ✅ coords groupées
  coords?: ApiCoords;

  raw?: {
    distance_meters: number;
    duration_seconds: number;
  };
};

const API_BASE_URL_FROM_EXTRA =
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_WEB_BASE_URL ?? null;
const API_BASE_URL = API_BASE_URL_FROM_EXTRA || "http://192.168.1.203:3000";

console.log("MMD MOBILE API_BASE_URL =", API_BASE_URL);

// ✅ même formule officielle MMD que sur le mobile pickup/dropoff
function computeDeliveryPricing({
  distanceMiles,
  durationMinutes,
}: {
  distanceMiles: number;
  durationMinutes: number;
}): number {
  const BASE_FARE = 2.5;
  const PER_MILE = 0.9;
  const PER_MINUTE = 0.15;
  const MIN_FARE = 3.49;

  const raw =
    BASE_FARE + distanceMiles * PER_MILE + durationMinutes * PER_MINUTE;

  const rounded = Math.round(raw * 100) / 100;
  return Math.max(MIN_FARE, rounded);
}

export function ClientRestaurantMenuScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();

  const { restaurantId, restaurantName } = route.params;

  const [items, setItems] = useState<RestaurantItem[]>([]);
  const [loading, setLoading] = useState(false);

  // 🧺 panier
  const [cart, setCart] = useState<CartItem[]>([]);

  // 📍 adresses pickup / dropoff
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");

  // 🚗 estimation livraison
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);

  // ✅ coords à enregistrer dans orders (OBLIGATOIRES à cause de orders_coords_required)
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);

  // 🧾 création commande
  const [creating, setCreating] = useState(false);

  const currency = "USD";

  function getItemPrice(item: RestaurantItem): number {
    if (item.price_cents != null) {
      return item.price_cents / 100;
    }
    return 0;
  }

  // 🔹 Charger le menu du restaurant
  useEffect(() => {
    async function loadMenu() {
      try {
        setLoading(true);

        const { data, error } = await supabase
          .from("restaurant_items")
          .select(
            "id, name, description, price_cents, category, restaurant_user_id"
          )
          .eq("restaurant_user_id", restaurantId)
          .order("name", { ascending: true });

        if (error) throw error;

        setItems((data || []) as RestaurantItem[]);
      } catch (err) {
        console.error("Erreur fetch menu restaurant (mobile):", err);
        Alert.alert(
          "Erreur",
          "Impossible de charger le menu de ce restaurant pour le moment."
        );
      } finally {
        setLoading(false);
      }
    }

    loadMenu();
  }, [restaurantId]);

  // 🧺 Gestion du panier
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

  const subtotal = cart.reduce(
    (sum, item) => sum + item.unit_price * item.quantity,
    0
  );
  const tax = +(subtotal * 0.0888).toFixed(2);
  const total = subtotal + tax;

  // 🚗 1) Estimer distance / temps / frais livraison + coords
  async function handleEstimateDelivery() {
    if (cart.length === 0) {
      Alert.alert("Panier vide", "Ajoute au moins un plat avant l’estimation.");
      return;
    }

    if (!pickup.trim() || !dropoff.trim()) {
      Alert.alert(
        "Champs manquants",
        "Merci de saisir l’adresse pickup (restaurant) et l’adresse de livraison."
      );
      return;
    }

    if (!API_BASE_URL) {
      Alert.alert(
        "Configuration manquante",
        "API_BASE_URL n’est pas configurée."
      );
      return;
    }

    try {
      setEstimating(true);

      const url = `${API_BASE_URL}/api/mapbox/compute-distance`;
      console.log("MMD MOBILE fetch distance (restaurant) →", url);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickupAddress: pickup.trim(),
          dropoffAddress: dropoff.trim(),
        }),
      });

      const rawText = await res.text();
      console.log("MMD MOBILE distance raw (restaurant) =", rawText);

      if (!res.ok) {
        throw new Error(
          `Erreur API (${res.status}). Réponse: ${rawText.slice(0, 200)}`
        );
      }

      let json: MapboxDistanceResponse;
      try {
        json = JSON.parse(rawText);
      } catch {
        throw new Error(
          "Réponse invalide depuis /api/mapbox/compute-distance (pas du JSON)."
        );
      }

      const dMiles = json.distanceMiles ?? json.distance_miles_est ?? undefined;
      const tMinutes = json.etaMinutes ?? json.eta_minutes_est ?? undefined;

      if (
        typeof dMiles !== "number" ||
        Number.isNaN(dMiles) ||
        typeof tMinutes !== "number" ||
        Number.isNaN(tMinutes)
      ) {
        throw new Error("Réponse distance/temps invalide depuis l’API Mapbox.");
      }

      setDistanceMiles(dMiles);
      setEtaMinutes(tMinutes);

      // ✅ COORDS : accepter modern / snake_case / coords / Lon
      const pLat =
        json.pickupLat ??
        json.pickup_lat ??
        json.coords?.pickupLat ??
        undefined;

      const pLng =
        json.pickupLng ??
        json.pickupLon ??
        json.pickup_lng ??
        json.pickup_lng ??
        json.coords?.pickupLng ??
        json.coords?.pickupLon ??
        undefined;

      const dLat =
        json.dropoffLat ??
        json.dropoff_lat ??
        json.coords?.dropoffLat ??
        undefined;

      const dLng =
        json.dropoffLng ??
        json.dropoffLon ??
        json.dropoff_lng ??
        json.dropoff_lng ??
        json.coords?.dropoffLng ??
        json.coords?.dropoffLon ??
        undefined;

      const pickupOk =
        typeof pLat === "number" &&
        typeof pLng === "number" &&
        !Number.isNaN(pLat) &&
        !Number.isNaN(pLng);

      const dropoffOk =
        typeof dLat === "number" &&
        typeof dLng === "number" &&
        !Number.isNaN(dLat) &&
        !Number.isNaN(dLng);

      setPickupCoords(pickupOk ? { lat: pLat, lng: pLng } : null);
      setDropoffCoords(dropoffOk ? { lat: dLat, lng: dLng } : null);

      // 1️⃣ Essayer le prix renvoyé par l’API
      const feeFromApi =
        json.deliveryPrice?.deliveryFee ?? json.delivery_fee?.deliveryFee ?? null;

      // 2️⃣ Sinon, recalcul local avec formule officielle
      const feeLocal = computeDeliveryPricing({
        distanceMiles: dMiles,
        durationMinutes: tMinutes,
      });

      const finalFee =
        typeof feeFromApi === "number" && !Number.isNaN(feeFromApi)
          ? feeFromApi
          : feeLocal;

      setDeliveryFee(finalFee);

      Alert.alert(
        "Estimation MMD Delivery",
        [
          `Distance : ${dMiles.toFixed(2)} mi`,
          `Temps estimé : ${Math.round(tMinutes)} min`,
          `Frais de livraison : ${finalFee.toFixed(2)} USD`,
          "",
          `Pickup GPS : ${pickupOk ? `${pLat.toFixed(5)}, ${pLng.toFixed(5)}` : "—"}`,
          `Dropoff GPS : ${dropoffOk ? `${dLat.toFixed(5)}, ${dLng.toFixed(5)}` : "—"}`,
        ].join("\n")
      );
    } catch (err: any) {
      console.error("Erreur estimation livraison restaurant (mobile):", err);
      Alert.alert(
        "Erreur",
        err?.message ??
          "Impossible de calculer l’estimation de livraison pour le moment."
      );
    } finally {
      setEstimating(false);
    }
  }

  // 🧾 2) Créer la commande FOOD dans `orders`
  async function handleCreateOrder() {
    if (cart.length === 0) {
      Alert.alert("Panier vide", "Ajoute au moins un plat à ta commande.");
      return;
    }

    if (!pickup.trim() || !dropoff.trim()) {
      Alert.alert(
        "Champs manquants",
        "Merci de saisir l’adresse pickup et l’adresse de livraison."
      );
      return;
    }

    if (distanceMiles == null || etaMinutes == null || deliveryFee == null) {
      Alert.alert(
        "Estimation manquante",
        "Merci de calculer d’abord l’estimation de livraison, puis confirme la commande."
      );
      return;
    }

    // ✅ coords obligatoires à cause de orders_coords_required
    if (!pickupCoords || !dropoffCoords) {
      Alert.alert(
        "Coords manquantes",
        "Merci de refaire l’estimation pour récupérer les coordonnées GPS avant de créer la commande."
      );
      return;
    }

    try {
      setCreating(true);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        Alert.alert(
          "Connexion requise",
          "Merci de te connecter avant de créer une commande."
        );
        return;
      }

      const userId = sessionData.session.user.id;
      const etaMinutesInt = Math.round(etaMinutes);

      // 🔐 codes sécurité (comme sur le web)
      const pickupCode = Math.random().toString(36).slice(2, 8).toUpperCase();
      const dropoffCode = Math.floor(100000 + Math.random() * 900000).toString();

      const { data, error } = await supabase
        .from("orders")
        .insert({
          type: "food",
          status: "pending",
          restaurant_id: restaurantId,
          restaurant_name: restaurantName,
          created_by: userId,

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

          pickup_address: pickup.trim(),
          dropoff_address: dropoff.trim(),
          distance_miles: distanceMiles,
          eta_minutes: etaMinutesInt,
          delivery_fee: deliveryFee,

          // ✅ IMPORTANT: coords pour respecter orders_coords_required
          pickup_lat: pickupCoords.lat,
          pickup_lng: pickupCoords.lng,
          dropoff_lat: dropoffCoords.lat,
          dropoff_lng: dropoffCoords.lng,

          pickup_code: pickupCode,
          dropoff_code: dropoffCode,
        })
        .select("id")
        .single();

      if (error) {
        console.error("Erreur insert orders (restaurant mobile):", error);
        throw error;
      }

      const orderId = data?.id as string;

      // Optionnel : enregistrer les membres de la commande (client + resto)
      try {
        await supabase.from("order_members").insert([
          { order_id: orderId, user_id: userId, role: "client" },
          { order_id: orderId, user_id: restaurantId, role: "restaurant" },
        ]);
      } catch (e) {
        console.log("Erreur insert order_members (non bloquant):", e);
      }

      Alert.alert(
        "Commande créée ✅",
        `Ta commande au restaurant a bien été créée.\n\nID : ${orderId.slice(0, 8)}…`,
        [
          {
            text: "OK",
            onPress: () => {
              navigation.navigate("ClientOrderDetails", { orderId });
            },
          },
        ]
      );
    } catch (err: any) {
      console.error("Erreur création commande restaurant (mobile):", err);
      Alert.alert(
        "Erreur",
        err?.message ?? "Impossible de créer la commande pour le moment."
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* HEADER */}
        <View style={{ marginBottom: 16 }}>
          <Text
            style={{
              color: "#22C55E",
              fontSize: 14,
              fontWeight: "600",
              marginBottom: 4,
            }}
          >
            Espace client
          </Text>
          <Text
            style={{
              color: "white",
              fontSize: 24,
              fontWeight: "800",
              marginBottom: 4,
            }}
          >
            {restaurantName}
          </Text>
          <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
            Parcours le menu et ajoute des plats à ta commande MMD.
          </Text>
        </View>

        {/* MENU */}
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              color: "#F9FAFB",
              fontSize: 16,
              fontWeight: "700",
              marginBottom: 8,
            }}
          >
            Menu du restaurant
          </Text>

          {loading ? (
            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 16,
              }}
            >
              <ActivityIndicator size="small" color="#22C55E" />
              <Text
                style={{
                  marginTop: 8,
                  color: "#9CA3AF",
                  fontSize: 13,
                }}
              >
                Chargement du menu…
              </Text>
            </View>
          ) : items.length === 0 ? (
            <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
              Aucun plat pour l’instant. Le restaurant n’a pas encore configuré
              son menu dans MMD Delivery.
            </Text>
          ) : (
            items.map((item) => {
              const price = getItemPrice(item);
              return (
                <View
                  key={item.id}
                  style={{
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: "#111827",
                    padding: 12,
                    marginBottom: 10,
                  }}
                >
                  <Text
                    style={{
                      color: "#F9FAFB",
                      fontSize: 15,
                      fontWeight: "700",
                      marginBottom: 2,
                    }}
                  >
                    {item.name}
                  </Text>
                  {item.category && (
                    <Text
                      style={{
                        color: "#9CA3AF",
                        fontSize: 12,
                        marginBottom: 2,
                      }}
                    >
                      {item.category}
                    </Text>
                  )}
                  {item.description && (
                    <Text
                      style={{
                        color: "#6B7280",
                        fontSize: 12,
                        marginBottom: 6,
                      }}
                    >
                      {item.description}
                    </Text>
                  )}
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: "#F9FAFB",
                        fontSize: 14,
                        fontWeight: "700",
                      }}
                    >
                      {price.toFixed(2)} {currency}
                    </Text>
                    <TouchableOpacity
                      onPress={() => addToCart(item)}
                      style={{
                        backgroundColor: "#22C55E",
                        borderRadius: 999,
                        paddingVertical: 8,
                        paddingHorizontal: 20,
                      }}
                    >
                      <Text
                        style={{
                          color: "white",
                          fontSize: 13,
                          fontWeight: "700",
                        }}
                      >
                        Ajouter
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* ADRESSES LIVRAISON */}
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              color: "#F9FAFB",
              fontSize: 15,
              fontWeight: "700",
              marginBottom: 8,
            }}
          >
            Adresses pour la livraison
          </Text>

          <View style={{ marginBottom: 10 }}>
            <Text
              style={{
                color: "#9CA3AF",
                fontSize: 12,
                marginBottom: 4,
              }}
            >
              Adresse pickup (restaurant / point de départ)
            </Text>
            <TextInput
              value={pickup}
              onChangeText={setPickup}
              placeholder="Ex : 686 Vermont St Brooklyn NY 11207"
              placeholderTextColor="#4B5563"
              style={{
                backgroundColor: "#020617",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#374151",
                paddingHorizontal: 12,
                paddingVertical: 10,
                color: "white",
                fontSize: 14,
              }}
            />
          </View>

          <View>
            <Text
              style={{
                color: "#9CA3AF",
                fontSize: 12,
                marginBottom: 4,
              }}
            >
              Adresse de livraison (client)
            </Text>
            <TextInput
              value={dropoff}
              onChangeText={setDropoff}
              placeholder="Ex : Adresse du client"
              placeholderTextColor="#4B5563"
              style={{
                backgroundColor: "#020617",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#374151",
                paddingHorizontal: 12,
                paddingVertical: 10,
                color: "white",
                fontSize: 14,
              }}
            />
          </View>

          <TouchableOpacity
            onPress={handleEstimateDelivery}
            disabled={estimating || creating}
            style={{
              marginTop: 12,
              backgroundColor: estimating || creating ? "#4B5563" : "#22C55E",
              borderRadius: 999,
              paddingVertical: 10,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
            }}
          >
            {estimating && <ActivityIndicator color="#ffffff" />}
            <Text
              style={{
                color: "white",
                fontSize: 13,
                fontWeight: "700",
                marginLeft: estimating ? 8 : 0, // ✅ remplace "gap"
              }}
            >
              {estimating
                ? "Calcul en cours..."
                : "Calculer estimation livraison (MMD Delivery)"}
            </Text>
          </TouchableOpacity>

          {(distanceMiles != null || etaMinutes != null || deliveryFee != null) && (
            <View style={{ marginTop: 8 }}>
              <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                Distance :{" "}
                <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
                  {distanceMiles != null ? `${distanceMiles.toFixed(2)} mi` : "—"}
                </Text>
              </Text>
              <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                Temps estimé :{" "}
                <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
                  {etaMinutes != null ? `${Math.round(etaMinutes)} min` : "—"}
                </Text>
              </Text>
              <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                Frais de livraison :{" "}
                <Text style={{ color: "#E5E7EB", fontWeight: "700" }}>
                  {deliveryFee != null ? `${deliveryFee.toFixed(2)} USD` : "—"}
                </Text>
              </Text>

              <Text style={{ color: "#6B7280", fontSize: 11, marginTop: 6 }}>
                Pickup GPS :{" "}
                {pickupCoords
                  ? `${pickupCoords.lat.toFixed(5)}, ${pickupCoords.lng.toFixed(5)}`
                  : "—"}
              </Text>
              <Text style={{ color: "#6B7280", fontSize: 11 }}>
                Dropoff GPS :{" "}
                {dropoffCoords
                  ? `${dropoffCoords.lat.toFixed(5)}, ${dropoffCoords.lng.toFixed(5)}`
                  : "—"}
              </Text>
            </View>
          )}
        </View>

        {/* PANIER */}
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              color: "#F9FAFB",
              fontSize: 15,
              fontWeight: "700",
              marginBottom: 8,
            }}
          >
            Panier
          </Text>

          {cart.length === 0 ? (
            <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
              Ton panier est vide. Ajoute des plats depuis le menu.
            </Text>
          ) : (
            <>
              {cart.map((item) => (
                <View
                  key={item.id}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text
                      style={{
                        color: "#F9FAFB",
                        fontSize: 14,
                        fontWeight: "600",
                      }}
                    >
                      {item.name}
                    </Text>
                    {item.category && (
                      <Text
                        style={{
                          color: "#6B7280",
                          fontSize: 11,
                        }}
                      >
                        {item.category}
                      </Text>
                    )}
                    <Text
                      style={{
                        color: "#9CA3AF",
                        fontSize: 11,
                      }}
                    >
                      {item.unit_price.toFixed(2)} {currency} / unité
                    </Text>
                  </View>

                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                    }}
                  >
                    <TouchableOpacity
                      onPress={() => updateQuantity(item.id, item.quantity - 1)}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: "#4B5563",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: "#E5E7EB",
                          fontSize: 16,
                          fontWeight: "700",
                        }}
                      >
                        -
                      </Text>
                    </TouchableOpacity>

                    <Text
                      style={{
                        color: "#E5E7EB",
                        fontSize: 13,
                        fontWeight: "700",
                        minWidth: 18,
                        textAlign: "center",
                        marginHorizontal: 8, // ✅ remplace "gap"
                      }}
                    >
                      {item.quantity}
                    </Text>

                    <TouchableOpacity
                      onPress={() => updateQuantity(item.id, item.quantity + 1)}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: "#4B5563",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: "#E5E7EB",
                          fontSize: 16,
                          fontWeight: "700",
                        }}
                      >
                        +
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ marginLeft: 8 }}>
                    <Text
                      style={{
                        color: "#F9FAFB",
                        fontSize: 13,
                        fontWeight: "700",
                      }}
                    >
                      {(item.unit_price * item.quantity).toFixed(2)} {currency}
                    </Text>
                    <TouchableOpacity onPress={() => removeFromCart(item.id)}>
                      <Text
                        style={{
                          color: "#F97373",
                          fontSize: 11,
                          marginTop: 2,
                        }}
                      >
                        Supprimer
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: "#111827",
                  marginTop: 10,
                  paddingTop: 8,
                }}
              >
                <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 2 }}>
                  Sous-total :{" "}
                  <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
                    {subtotal.toFixed(2)} {currency}
                  </Text>
                </Text>
                <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 2 }}>
                  Taxes (~8.88%) :{" "}
                  <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
                    {tax.toFixed(2)} {currency}
                  </Text>
                </Text>
                <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                  Total (hors livraison) :{" "}
                  <Text style={{ color: "#E5E7EB", fontWeight: "700" }}>
                    {total.toFixed(2)} {currency}
                  </Text>
                </Text>
              </View>
            </>
          )}
        </View>

        {/* BOUTON VALIDER COMMANDE */}
        <TouchableOpacity
          onPress={handleCreateOrder}
          disabled={
            creating ||
            cart.length === 0 ||
            distanceMiles == null ||
            etaMinutes == null ||
            deliveryFee == null ||
            !pickupCoords ||
            !dropoffCoords
          }
          style={{
            backgroundColor:
              creating ||
              cart.length === 0 ||
              distanceMiles == null ||
              etaMinutes == null ||
              deliveryFee == null ||
              !pickupCoords ||
              !dropoffCoords
                ? "#4B5563"
                : "#3B82F6",
            borderRadius: 999,
            paddingVertical: 12,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "center",
            marginBottom: 12,
          }}
        >
          {creating && <ActivityIndicator color="#ffffff" />}
          <Text
            style={{
              color: "white",
              fontSize: 14,
              fontWeight: "700",
              marginLeft: creating ? 8 : 0, // ✅ remplace "gap"
            }}
          >
            {creating ? "Création de la commande…" : "Confirmer et créer la commande MMD"}
          </Text>
        </TouchableOpacity>

        {/* RETOUR LISTE RESTAURANTS */}
        <TouchableOpacity
          onPress={() => navigation.navigate("ClientRestaurantList")}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "#4B5563",
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: "#E5E7EB",
              fontSize: 13,
              fontWeight: "500",
            }}
          >
            ← Retour aux restaurants
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
