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
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";

type Nav = NativeStackNavigationProp<
  RootStackParamList,
  "ClientRestaurantMenu"
>;

type RouteParams = {
  restaurantId: string;
  restaurantName: string;
};

type RestaurantItem = {
  id: string;
  name: string | null;
  description?: string | null;
  category?: string | null;
  price?: number | null;
  price_cents?: number | null;
};

type CartLine = {
  item: RestaurantItem;
  quantity: number;
  unitPrice: number;
};

function getItemPrice(item: RestaurantItem): number {
  if (typeof item.price === "number") return item.price;
  if (typeof item.price_cents === "number")
    return Math.round(item.price_cents) / 100;
  return 0;
}

export function ClientRestaurantMenuScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<Nav>();

  const { restaurantId, restaurantName } = route.params as RouteParams;

  const [items, setItems] = useState<RestaurantItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);

  async function fetchMenu() {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("restaurant_items")
        .select("id, name, description, category, price, price_cents")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .order("category", { ascending: true })
        .order("name", { ascending: true });

      if (error) throw error;

      setItems(data ?? []);
    } catch (err) {
      console.error("Erreur fetch menu restaurant (mobile):", err);
      Alert.alert(
        "Erreur",
        "Impossible de charger le menu pour ce restaurant."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMenu();
  }, [restaurantId]);

  function handleAddToCart(item: RestaurantItem) {
    const price = getItemPrice(item);
    if (price <= 0) {
      Alert.alert(
        "Prix manquant",
        "Ce plat n’a pas de prix configuré pour le moment."
      );
      return;
    }

    setCart((prev) => {
      const existing = prev.find((l) => l.item.id === item.id);
      if (existing) {
        return prev.map((l) =>
          l.item.id === item.id
            ? { ...l, quantity: l.quantity + 1 }
            : l
        );
      }
      return [
        ...prev,
        {
          item,
          quantity: 1,
          unitPrice: price,
        },
      ];
    });
  }

  function handleRemoveFromCart(itemId: string) {
    setCart((prev) => {
      const existing = prev.find((l) => l.item.id === itemId);
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        return prev.filter((l) => l.item.id !== itemId);
      }
      return prev.map((l) =>
        l.item.id === itemId
          ? { ...l, quantity: l.quantity - 1 }
          : l
      );
    });
  }

  const subtotal = cart.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0
  );

  function handleContinue() {
    if (cart.length === 0) {
      Alert.alert(
        "Panier vide",
        "Ajoute au moins un plat avant de continuer."
      );
      return;
    }

    // Pour l’instant on affiche juste un résumé.
    // Plus tard on branchera ça sur la vraie création de commande food.
    const lines = cart.map(
      (l) =>
        `${l.quantity}× ${l.item.name ?? "Plat"} — ${(l.unitPrice * l.quantity).toFixed(
          2
        )} USD`
    );

    Alert.alert(
      "Panier restaurant",
      [
        `Restaurant : ${restaurantName}`,
        "",
        ...lines,
        "",
        `Sous-total : ${subtotal.toFixed(2)} USD`,
        "",
        "Prochaine étape : saisir l’adresse et créer la commande food (à implémenter).",
      ].join("\n")
    );
  }

  // Regrouper par catégorie pour un affichage propre
  const groupedByCategory: { [cat: string]: RestaurantItem[] } = {};
  for (const it of items) {
    const cat = (it.category || "Autres").trim();
    if (!groupedByCategory[cat]) groupedByCategory[cat] = [];
    groupedByCategory[cat].push(it);
  }
  const categories = Object.keys(groupedByCategory);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      {/* HEADER */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 8,
        }}
      >
        <Text
          style={{
            color: "#22C55E",
            fontSize: 13,
            fontWeight: "600",
            marginBottom: 2,
          }}
        >
          Restaurant
        </Text>
        <Text
          style={{
            color: "white",
            fontSize: 22,
            fontWeight: "800",
            marginBottom: 4,
          }}
        >
          {restaurantName}
        </Text>
        <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
          Parcours le menu et ajoute des plats à ton panier.
        </Text>
      </View>

      {loading ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator size="large" color="#22C55E" />
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
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 120, // place pour le panier
          }}
        >
          {categories.length === 0 && (
            <View
              style={{
                marginTop: 40,
                padding: 16,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "#111827",
                backgroundColor: "#020617",
              }}
            >
              <Text
                style={{
                  color: "#E5E7EB",
                  fontSize: 15,
                  fontWeight: "600",
                  marginBottom: 4,
                }}
              >
                Aucun plat disponible
              </Text>
              <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
                Le menu de ce restaurant n’est pas encore configuré dans
                MMD Delivery.
              </Text>
            </View>
          )}

          {categories.map((cat) => (
            <View key={cat} style={{ marginTop: 18 }}>
              <Text
                style={{
                  color: "#F9FAFB",
                  fontSize: 16,
                  fontWeight: "700",
                  marginBottom: 8,
                }}
              >
                {cat}
              </Text>

              {groupedByCategory[cat].map((item) => {
                const price = getItemPrice(item);

                return (
                  <View
                    key={item.id}
                    style={{
                      marginBottom: 10,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: "#111827",
                      backgroundColor: "#020617",
                      padding: 12,
                    }}
                  >
                    <Text
                      style={{
                        color: "#E5E7EB",
                        fontSize: 15,
                        fontWeight: "600",
                        marginBottom: 2,
                      }}
                    >
                      {item.name ?? "Plat"}
                    </Text>
                    {item.description ? (
                      <Text
                        style={{
                          color: "#9CA3AF",
                          fontSize: 12,
                          marginBottom: 4,
                        }}
                      >
                        {item.description}
                      </Text>
                    ) : null}

                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 4,
                      }}
                    >
                      <Text
                        style={{
                          color: "#F97316",
                          fontSize: 14,
                          fontWeight: "700",
                        }}
                      >
                        {price > 0
                          ? `${price.toFixed(2)} USD`
                          : "Prix à venir"}
                      </Text>

                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => handleRemoveFromCart(item.id)}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: "#4B5563",
                          }}
                        >
                          <Text
                            style={{
                              color: "#9CA3AF",
                              fontSize: 14,
                              fontWeight: "700",
                            }}
                          >
                            −
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => handleAddToCart(item)}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 999,
                            backgroundColor: "#22C55E",
                          }}
                        >
                          <Text
                            style={{
                              color: "white",
                              fontSize: 14,
                              fontWeight: "700",
                            }}
                          >
                            +
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      {/* BARRE PANIER */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderTopWidth: 1,
          borderTopColor: "#111827",
          backgroundColor: "#020617",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            marginBottom: 8,
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: "#E5E7EB",
              fontSize: 14,
              fontWeight: "600",
            }}
          >
            Panier ({cart.reduce((s, l) => s + l.quantity, 0)} plat
            {cart.reduce((s, l) => s + l.quantity, 0) > 1 ? "s" : ""})
          </Text>
          <Text
            style={{
              color: "#F9FAFB",
              fontSize: 16,
              fontWeight: "800",
            }}
          >
            {subtotal.toFixed(2)} USD
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleContinue}
          disabled={cart.length === 0}
          style={{
            borderRadius: 999,
            paddingVertical: 12,
            alignItems: "center",
            backgroundColor:
              cart.length === 0 ? "#4B5563" : "#3B82F6",
          }}
        >
          <Text
            style={{
              color: "white",
              fontSize: 14,
              fontWeight: "700",
            }}
          >
            {cart.length === 0
              ? "Ajouter des plats au panier"
              : "Continuer (adresse + livraison)"}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
