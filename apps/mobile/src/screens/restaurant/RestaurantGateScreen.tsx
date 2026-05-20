import React, { useEffect } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { supabase } from "../../lib/supabase";
import { useTranslation } from "react-i18next";

type Props = { navigation: any };

type RestaurantProfileGate = {
  user_id: string;
  status: string | null;
  restaurant_name?: string | null;
  address?: string | null;
  location_lat?: number | string | null;
  location_lng?: number | string | null;
};

function hasValidCoordinate(latValue: unknown, lngValue: unknown) {
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

function isProfileComplete(profile: RestaurantProfileGate | null) {
  if (!profile) return false;

  const name = String(profile.restaurant_name || "").trim();
  const address = String(profile.address || "").trim();

  return Boolean(
    name &&
      address &&
      hasValidCoordinate(profile.location_lat, profile.location_lng)
  );
}

export default function RestaurantGateScreen({ navigation }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    let mounted = true;

    const routeRestaurant = async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (!mounted) return;

        if (userError || !user) {
          navigation.replace("RestaurantAuth");
          return;
        }

        const { data: roleProfile, error: roleError } = await supabase
          .from("profiles")
          .select("id,role")
          .eq("id", user.id)
          .maybeSingle();

        if (!mounted) return;

        if (roleError) {
          console.log("RestaurantGate role check error:", roleError.message);
          navigation.replace("RestaurantAuth");
          return;
        }

        const role = String((roleProfile as any)?.role || "")
          .trim()
          .toLowerCase();

        if (role === "driver") {
          navigation.reset({
            index: 0,
            routes: [{ name: "DriverTabs" }],
          });
          return;
        }

        if (role === "client") {
          navigation.reset({
            index: 0,
            routes: [{ name: "ClientHome" }],
          });
          return;
        }

        if (role && role !== "restaurant") {
          navigation.replace("RoleSelect");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("restaurant_profiles")
          .select(
            "user_id,status,restaurant_name,address,location_lat,location_lng"
          )
          .eq("user_id", user.id)
          .maybeSingle();

        if (!mounted) return;

        if (profileError) {
          console.log(
            "RestaurantGate profile check error:",
            profileError.message,
            profileError.details,
            profileError.hint
          );
          navigation.replace("RestaurantSetup");
          return;
        }

        const restaurantProfile = (profile as RestaurantProfileGate | null) ?? null;

        if (!isProfileComplete(restaurantProfile)) {
          navigation.replace("RestaurantSetup");
          return;
        }

        const status = String(restaurantProfile?.status || "")
          .trim()
          .toLowerCase();

        if (status !== "approved") {
          navigation.replace("RestaurantSetup");
          return;
        }

        navigation.replace("RestaurantHome");
      } catch (error) {
        console.log("RestaurantGate unexpected error:", error);
        if (!mounted) return;
        navigation.replace("RestaurantAuth");
      }
    };

    void routeRestaurant();

    return () => {
      mounted = false;
    };
  }, [navigation]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
      <Text style={{ marginTop: 8 }}>
        {t("restaurant.gate.loading", "Chargement restaurant…")}
      </Text>
    </View>
  );
}