import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StatusBar,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";
import { useClientPlatformFeatures } from "../hooks/useClientPlatformFeatures";
import {
  coordinatesMatchMarketCountry,
  resolveMarketScopeFromFeatures,
} from "../lib/marketScope";
import ScreenHeader from "../components/navigation/ScreenHeader";

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientRestaurantList">;

type Restaurant = {
  id: string;
  name: string;
  address: string;
  phone?: string | null;
  cuisineType: string;
  locationLat: number;
  locationLng: number;
};

const ALL_CUISINES = "Tous";

function normalizeText(value: string) {
  return String(value || "").trim().toLowerCase();
}

function isValidCoordinate(latValue: unknown, lngValue: unknown) {
  const lat = Number(latValue);
  const lng = Number(lngValue);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function ClientRestaurantListScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [searchText, setSearchText] = useState("");
  const [selectedCuisine, setSelectedCuisine] = useState(ALL_CUISINES);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { features: platformFeatures } = useClientPlatformFeatures();
  const market = useMemo(
    () => resolveMarketScopeFromFeatures(platformFeatures),
    [platformFeatures]
  );

  const cuisines = useMemo(() => {
    const unique = Array.from(
      new Set(restaurants.map((r) => r.cuisineType).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    return [ALL_CUISINES, ...unique];
  }, [restaurants]);

  const filteredRestaurants = useMemo(() => {
    const query = normalizeText(searchText);

    return restaurants.filter((restaurant) => {
      const matchesCuisine =
        selectedCuisine === ALL_CUISINES ||
        restaurant.cuisineType === selectedCuisine;

      const matchesSearch =
        !query ||
        normalizeText(restaurant.name).includes(query) ||
        normalizeText(restaurant.address).includes(query) ||
        normalizeText(restaurant.cuisineType).includes(query);

      return matchesCuisine && matchesSearch;
    });
  }, [restaurants, searchText, selectedCuisine]);

  const fetchRestaurants = useCallback(
    async (showSpinner = true) => {
      try {
        if (showSpinner) setLoading(true);

        const { data, error } = await supabase
          .from("restaurant_profiles")
          .select(
            "user_id, restaurant_name, address, phone, cuisine_type, status, is_accepting_orders, location_lat, location_lng"
          )
          .eq("status", "approved")
          .eq("is_accepting_orders", true)
          .order("restaurant_name", { ascending: true });

        if (error) throw error;

        const list: Restaurant[] = (data ?? [])
          .filter((r: any) => {
            const name = String(r?.restaurant_name || "").trim();
            const address = String(r?.address || "").trim();
            const cuisineType = String(r?.cuisine_type || "").trim();

            const coordsOk = isValidCoordinate(r?.location_lat, r?.location_lng);
            const inMarket =
              market.scopeResolved &&
              Boolean(market.countryCode) &&
              coordsOk &&
              coordinatesMatchMarketCountry(
                Number(r.location_lat),
                Number(r.location_lng),
                market.countryCode
              );

            return (
              !!r?.user_id &&
              !!name &&
              !!address &&
              !!cuisineType &&
              coordsOk &&
              inMarket
            );
          })
          .map((r: any) => ({
            id: String(r.user_id),
            name: String(r.restaurant_name).trim(),
            address: String(r.address).trim(),
            phone: r.phone ?? null,
            cuisineType: String(r.cuisine_type).trim(),
            locationLat: Number(r.location_lat),
            locationLng: Number(r.location_lng),
          }));

        setRestaurants(list);
      } catch (err) {
        console.error("Erreur fetch restaurants (mobile):", err);
        setRestaurants([]);
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [market.countryCode, market.scopeResolved]
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
    (restaurant: Restaurant) => {
      navigation.navigate(
        "ClientRestaurantMenu",
        {
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          restaurantAddress: restaurant.address,
        } as any
      );
    },
    [navigation]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={t("client.restaurants.header.title", "Restaurants partenaires")}
        subtitle={t(
          "client.restaurants.header.subtitle",
          "Choisis un restaurant par catégorie ou recherche ton plat préféré."
        )}
        fallbackRoute="ClientHome"
        variant="dark"
      />

      <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 }}>
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder={t(
            "client.restaurants.search.placeholder",
            "Rechercher restaurant, adresse ou cuisine..."
          )}
          placeholderTextColor="#64748B"
          autoCorrect={false}
          style={{
            marginTop: 14,
            backgroundColor: "#111827",
            borderWidth: 1,
            borderColor: "#1F2937",
            color: "#F9FAFB",
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 11,
            fontSize: 14,
            fontWeight: "600",
          }}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 4 }}
        >
          {cuisines.map((cuisine) => {
            const active = cuisine === selectedCuisine;

            return (
              <TouchableOpacity
                key={cuisine}
                onPress={() => setSelectedCuisine(cuisine)}
                style={{
                  marginRight: 8,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 999,
                  backgroundColor: active ? "#22C55E" : "#111827",
                  borderWidth: 1,
                  borderColor: active ? "#22C55E" : "#1F2937",
                }}
              >
                <Text
                  style={{
                    color: active ? "#020617" : "#E5E7EB",
                    fontSize: 13,
                    fontWeight: "900",
                  }}
                >
                  {cuisine}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading && restaurants.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#22C55E" />
          <Text style={{ marginTop: 8, color: "#9CA3AF", fontSize: 13 }}>
            {t("client.restaurants.loading", "Chargement des restaurants…")}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22C55E" />
          }
        >
          {filteredRestaurants.length === 0 && !loading && (
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
                  "Aucun restaurant ne correspond à ce filtre pour le moment."
                )}
              </Text>
            </View>
          )}

          {filteredRestaurants.map((restaurant) => (
            <TouchableOpacity
              key={restaurant.id}
              onPress={() => handleOpenRestaurant(restaurant)}
              style={{
                marginTop: 12,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "#111827",
                backgroundColor: "#020617",
                padding: 14,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                <Text
                  style={{
                    color: "#F9FAFB",
                    fontSize: 16,
                    fontWeight: "700",
                    marginBottom: 4,
                    flex: 1,
                  }}
                >
                  {restaurant.name}
                </Text>

                <View
                  style={{
                    backgroundColor: "rgba(34,197,94,0.12)",
                    borderColor: "rgba(34,197,94,0.35)",
                    borderWidth: 1,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 999,
                    alignSelf: "flex-start",
                  }}
                >
                  <Text style={{ color: "#22C55E", fontSize: 11, fontWeight: "900" }}>
                    {restaurant.cuisineType}
                  </Text>
                </View>
              </View>

              <Text style={{ color: "#9CA3AF", fontSize: 13, marginBottom: 2 }}>
                {restaurant.address}
              </Text>

              {restaurant.phone ? (
                <Text style={{ color: "#6B7280", fontSize: 12, marginTop: 2 }}>
                  Téléphone : {restaurant.phone}
                </Text>
              ) : null}

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
    </SafeAreaView>
  );
}

export default ClientRestaurantListScreen;