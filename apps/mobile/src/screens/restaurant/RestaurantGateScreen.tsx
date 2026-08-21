import React, { useEffect, useState } from "react";
import { Pressable, StatusBar, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useTranslation } from "react-i18next";
import { RestaurantBrandLoadingState } from "../../components/restaurant/RestaurantBrandLoadingState";
import {
  BOOT_AUTH_TIMEOUT_MS,
  withTimeout,
} from "../../lib/bootFailOpen";
import { MMD_BLUE, MMD_FONT, MMD_WHITE } from "../../theme/mmdUi";

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

/** Figma Restaurant Gate / Loading 343:5489 — routing logic unchanged. */
export default function RestaurantGateScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [stuck, setStuck] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;

    const routeRestaurant = async () => {
      setStuck(false);
      try {
        await withTimeout(
          (async () => {
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

            const restaurantProfile =
              (profile as RestaurantProfileGate | null) ?? null;

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

            navigation.replace("RestaurantCommandCenter");
          })(),
          BOOT_AUTH_TIMEOUT_MS,
          "restaurant_gate",
        );
      } catch (error) {
        console.log("RestaurantGate unexpected error:", error);
        if (!mounted) return;
        setStuck(true);
      }
    };

    void routeRestaurant();

    return () => {
      mounted = false;
    };
  }, [navigation, attempt]);

  if (stuck) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: MMD_BLUE }}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            paddingHorizontal: 28,
            gap: 16,
          }}
        >
          <Text
            style={{
              color: MMD_WHITE,
              fontFamily: MMD_FONT.bold,
              fontSize: 18,
              textAlign: "center",
            }}
          >
            {t(
              "restaurant.gate.timeoutTitle",
              "Unable to open restaurant area",
            )}
          </Text>
          <Text
            style={{
              color: "rgba(255,255,255,0.85)",
              fontFamily: MMD_FONT.regular,
              fontSize: 14,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            {t(
              "restaurant.gate.timeoutBody",
              "Network is slow or unavailable. You can retry or go back to sign in.",
            )}
          </Text>
          <Pressable
            onPress={() => setAttempt((n) => n + 1)}
            style={{
              marginTop: 8,
              backgroundColor: MMD_WHITE,
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
            }}
            accessibilityRole="button"
            accessibilityLabel={t("common.retry", "Retry")}
          >
            <Text
              style={{
                color: MMD_BLUE,
                fontFamily: MMD_FONT.bold,
                fontSize: 16,
              }}
            >
              {t("common.retry", "Retry")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.replace("RestaurantAuth")}
            style={{
              paddingVertical: 12,
              alignItems: "center",
            }}
            accessibilityRole="button"
            accessibilityLabel={t("common.back", "Back")}
          >
            <Text
              style={{
                color: MMD_WHITE,
                fontFamily: MMD_FONT.semibold,
                fontSize: 15,
              }}
            >
              {t("common.back", "Back")}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: MMD_BLUE }}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <RestaurantBrandLoadingState
        title={t("restaurant.gate.loading", "Loading Restaurant...")}
        logoAtBottom
        showCardLogo
      />
    </SafeAreaView>
  );
}
