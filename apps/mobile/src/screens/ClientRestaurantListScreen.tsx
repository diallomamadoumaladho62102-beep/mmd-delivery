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
  Image,
  useWindowDimensions,
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
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD,
  MMD_GOLD_BRIGHT,
  MMD_GOLD_DARK,
  MMD_MUTED,
  MMD_NAVY,
  MMD_WHITE,
  mmdLogoSize,
} from "../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientRestaurantList">;

type Restaurant = {
  id: string;
  name: string;
  address: string;
  phone?: string | null;
  cuisineType: string;
  locationLat: number;
  locationLng: number;
  imageUrl: string | null;
};

const ALL_CUISINES = "Tous";
const AVATARS_BUCKET = "avatars";

function resolveRestaurantImageUrl(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const normalized = raw.replace(/^\/+/, "");
  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(normalized);
  return data?.publicUrl || null;
}

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
  const { width, height } = useWindowDimensions();
  const logoSize = mmdLogoSize(width, height);
  const contentMaxWidth = width >= 768 ? 640 : undefined;

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
            "user_id, restaurant_name, address, phone, cuisine_type, status, is_accepting_orders, location_lat, location_lng, logo_url, avatar_url, cover_image_url"
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
            imageUrl:
              resolveRestaurantImageUrl(r?.cover_image_url) ||
              resolveRestaurantImageUrl(r?.logo_url) ||
              resolveRestaurantImageUrl(r?.avatar_url),
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
    <SafeAreaView style={{ flex: 1, backgroundColor: MMD_BLUE }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={t("client.restaurants.header.title", "Restaurants partenaires")}
        subtitle={t(
          "client.restaurants.header.subtitle",
          "Choisis un restaurant par catégorie ou recherche ton plat préféré."
        )}
        fallbackRoute="ClientHome"
        variant="brand"
      />

      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 8,
          width: "100%",
          maxWidth: contentMaxWidth,
          alignSelf: "center",
        }}
      >
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder={t(
            "client.restaurants.search.placeholder",
            "Rechercher restaurant, adresse ou cuisine..."
          )}
          placeholderTextColor="#6B7280"
          autoCorrect={false}
          style={{
            marginTop: 4,
            backgroundColor: MMD_NAVY,
            borderWidth: 1.5,
            borderColor: "rgba(255,255,255,0.3)",
            color: MMD_WHITE,
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 10,
            fontSize: 14,
            fontFamily: MMD_FONT.regular,
            minHeight: 42,
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
                  borderRadius: 20,
                  backgroundColor: MMD_GOLD,
                  borderWidth: 1,
                  borderColor: active ? "#22C55E" : "#E2E8F0",
                }}
              >
                <Text
                  style={{
                    color: MMD_NAVY,
                    fontSize: 13,
                    fontWeight: "800",
                    fontFamily: MMD_FONT.extrabold,
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
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <Image
            source={require("../../assets/brand/mmd-logo-ui.png")}
            style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2 }}
            resizeMode="contain"
            accessibilityLabel="MMD"
          />
          <Text
            style={{
              marginTop: 16,
              color: MMD_WHITE,
              fontSize: 28,
              fontWeight: "800",
              fontFamily: MMD_FONT.extrabold,
              textAlign: "center",
            }}
          >
            MMD DELIVERY
          </Text>
          <Text
            style={{
              marginTop: 8,
              color: MMD_GOLD_DARK,
              fontSize: 16,
              fontFamily: MMD_FONT.semibold,
              textAlign: "center",
            }}
          >
            {t("brand.tagline", "We Deliver With Heart ❤️")}
          </Text>
          <ActivityIndicator size="large" color={MMD_GOLD_BRIGHT} style={{ marginTop: 28 }} />
          <Text
            style={{
              marginTop: 12,
              color: MMD_WHITE,
              fontSize: 15,
              fontFamily: MMD_FONT.bold,
              textAlign: "center",
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
            width: "100%",
            maxWidth: contentMaxWidth,
            alignSelf: "center",
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={MMD_GOLD_BRIGHT} />
          }
        >
          {filteredRestaurants.length === 0 && !loading && (
            <View
              style={{
                marginTop: 40,
                padding: 16,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "rgba(255,215,0,0.25)",
                backgroundColor: MMD_NAVY,
              }}
            >
              <Text
                style={{
                  color: MMD_WHITE,
                  fontSize: 15,
                  fontWeight: "700",
                  fontFamily: MMD_FONT.bold,
                  marginBottom: 4,
                }}
              >
                {t("client.restaurants.empty.title", "Aucun restaurant disponible")}
              </Text>

              <Text style={{ color: MMD_MUTED, fontSize: 13, fontFamily: MMD_FONT.regular }}>
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
                marginTop: 16,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "rgba(255,215,0,0.25)",
                backgroundColor: MMD_NAVY,
                paddingBottom: 14,
                overflow: "hidden",
              }}
            >
              {restaurant.imageUrl ? (
                <Image
                  source={{ uri: restaurant.imageUrl }}
                  style={{ width: "100%", height: 140 }}
                  resizeMode="cover"
                  accessibilityLabel={restaurant.name}
                />
              ) : null}
              <View style={{ paddingTop: 12, paddingHorizontal: 14, gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <Text
                    style={{
                      color: MMD_WHITE,
                      fontSize: 17,
                      fontWeight: "700",
                      fontFamily: MMD_FONT.bold,
                      flex: 1,
                    }}
                    numberOfLines={2}
                  >
                    {restaurant.name}
                  </Text>

                  <View
                    style={{
                      backgroundColor: MMD_GOLD,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 12,
                      alignSelf: "flex-start",
                    }}
                  >
                    <Text
                      style={{
                        color: MMD_NAVY,
                        fontSize: 11,
                        fontWeight: "600",
                        fontFamily: MMD_FONT.semibold,
                      }}
                    >
                      {restaurant.cuisineType}
                    </Text>
                  </View>
                </View>

                <Text style={{ color: MMD_MUTED, fontSize: 13, fontFamily: MMD_FONT.regular }}>
                  {restaurant.address}
                </Text>

                {restaurant.phone ? (
                  <Text style={{ color: MMD_MUTED, fontSize: 12, fontFamily: MMD_FONT.regular }}>
                    Téléphone : {restaurant.phone}
                  </Text>
                ) : null}

                <Text
                  style={{
                    marginTop: 4,
                    color: MMD_GOLD_BRIGHT,
                    fontSize: 13,
                    fontWeight: "600",
                    fontFamily: MMD_FONT.semibold,
                  }}
                >
                  {t("client.restaurants.viewMenu", "Voir le menu →")}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default ClientRestaurantListScreen;