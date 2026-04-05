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
import { useTranslation } from "react-i18next";

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientRestaurantList">;

type Restaurant = {
  id: string;
  name: string | null;
  address?: string | null;
  phone?: string | null;
};

export function ClientRestaurantListScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRestaurants = useCallback(
    async (showSpinner = true) => {
      try {
        if (showSpinner) setLoading(true);

        const { data, error } = await supabase
          .from("restaurants")
          .select("id, name, address, created_at")
          .eq("is_active", true)
          .eq("is_verified", true)
          .order("name", { ascending: true });

        if (error) throw error;

        const list: Restaurant[] = (data ?? []).map((r: any) => ({
          id: r.id,
          name: r.name ?? null,
          address: r.address ?? null,
          phone: null,
        }));

        setRestaurants(list);

        if (list.length === 1) {
          const only = list[0];
          navigation.navigate(
            "ClientRestaurantMenu",
            {
              restaurantId: only.id,
              restaurantName:
                only.name ?? t("client.restaurants.defaultRestaurantName", "Restaurant"),
              restaurantAddress: only.address ?? "",
            } as any
          );
        }
      } catch (err) {
        console.error("Erreur fetch restaurants (mobile):", err);
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [navigation, t]
  );

  useEffect(() => {
    fetchRestaurants(true);
  }, [fetchRestaurants]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRestaurants(false);
    setRefreshing(false);
  }, [fetchRestaurants]);

  const handleOpenRestaurant = useCallback(
    (r: Restaurant) => {
      navigation.navigate(
        "ClientRestaurantMenu",
        {
          restaurantId: r.id,
          restaurantName:
            r.name ?? t("client.restaurants.defaultRestaurantName", "Restaurant"),
          restaurantAddress: r.address ?? "",
        } as any
      );
    },
    [navigation, t]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

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
          {t("client.restaurants.header.spaceClient", "Espace client")}
        </Text>
        <Text
          style={{
            color: "white",
            fontSize: 24,
            fontWeight: "800",
            marginBottom: 4,
          }}
        >
          {t("client.restaurants.header.title", "Restaurants partenaires")}
        </Text>
        <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
          {t(
            "client.restaurants.header.subtitle",
            "Choisis un restaurant pour voir son menu et ajouter des plats."
          )}
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
            {t("client.restaurants.loading", "Chargement des restaurants…")}
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
                {t("client.restaurants.empty.title", "Aucun restaurant disponible")}
              </Text>
              <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
                {t(
                  "client.restaurants.empty.body",
                  "Pour l’instant aucun restaurant n’est encore configuré dans MMD Delivery."
                )}
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
                {r.name ?? t("client.restaurants.defaultRestaurantLabel", "Restaurant MMD")}
              </Text>

              {r.address && (
                <Text
                  style={{
                    color: "#9CA3AF",
                    fontSize: 13,
                    marginBottom: 2,
                  }}
                >
                  {r.address}
                </Text>
              )}

              <Text
                style={{
                  marginTop: 8,
                  color: "#3B82F6",
                  fontSize: 12,
                  fontWeight: "600",
                }}
              >
                {t("client.restaurants.viewMenu", "Voir le menu →")}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

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
            ← {t("client.restaurants.backToClient", "Retour à l’espace client")}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}