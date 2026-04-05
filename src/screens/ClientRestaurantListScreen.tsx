import React, { useEffect, useState, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";

type Nav = NativeStackNavigationProp<
  RootStackParamList,
  "ClientRestaurantList"
>;

type Restaurant = {
  id: string;
  name: string | null;
  address_line1?: string | null;
  city?: string | null;
  zip?: string | null;
};

export function ClientRestaurantListScreen() {
  const navigation = useNavigation<Nav>();

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchRestaurants(showSpinner = true) {
    try {
      if (showSpinner) setLoading(true);

      const { data, error } = await supabase
        .from("restaurant_profiles")
        .select("id, name, address_line1, city, zip")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (error) throw error;

      setRestaurants(data ?? []);
    } catch (err) {
      console.error("Erreur fetch restaurants (mobile):", err);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => {
    fetchRestaurants(true);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRestaurants(false);
    setRefreshing(false);
  }, []);

  function handleOpenRestaurant(r: Restaurant) {
    navigation.navigate("ClientRestaurantMenu", {
      restaurantId: r.id,
      restaurantName: r.name ?? "Restaurant",
    });
  }

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
          Restaurants partenaires
        </Text>
        <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
          Choisis un restaurant pour voir son menu et ajouter des plats.
        </Text>
      </View>

      {loading && restaurants.length === 0 ? (
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
            Chargement des restaurants…
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 24,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#22C55E"
            />
          }
        >
          {restaurants.length === 0 && !loading && (
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
                Aucun restaurant disponible
              </Text>
              <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
                Pour l’instant aucun restaurant n’est encore configuré dans
                MMD Delivery.
              </Text>
            </View>
          )}

          {restaurants.map((r) => (
            <TouchableOpacity
              key={r.id}
              onPress={() => handleOpenRestaurant(r)}
              style={{
                marginTop: 12,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "#111827",
                backgroundColor: "#020617",
                padding: 14,
              }}
            >
              <Text
                style={{
                  color: "#F9FAFB",
                  fontSize: 16,
                  fontWeight: "700",
                  marginBottom: 4,
                }}
              >
                {r.name ?? "Restaurant MMD"}
              </Text>
              <Text
                style={{
                  color: "#9CA3AF",
                  fontSize: 13,
                  marginBottom: 2,
                }}
              >
                {r.address_line1}
              </Text>
              <Text style={{ color: "#6B7280", fontSize: 12 }}>
                {r.city} {r.zip}
              </Text>

              <Text
                style={{
                  marginTop: 8,
                  color: "#3B82F6",
                  fontSize: 12,
                  fontWeight: "600",
                }}
              >
                Voir le menu →
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* RETOUR ESPACE CLIENT */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingBottom: 16,
          paddingTop: 8,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.navigate("ClientHome")}
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
            ← Retour à l’espace client
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
