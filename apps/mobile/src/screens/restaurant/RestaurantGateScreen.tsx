import React, { useEffect } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { supabase } from "../../lib/supabase";
import { useTranslation } from "react-i18next";

type Props = { navigation: any };

export default function RestaurantGateScreen({ navigation }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const {
          data: { user },
          error: uerr,
        } = await supabase.auth.getUser();

        if (!mounted) return;

        if (uerr) {
          console.log("getUser error", uerr);
          navigation.replace("RestaurantAuth");
          return;
        }

        if (!user) {
          navigation.replace("RestaurantAuth");
          return;
        }

        const { data: profile, error } = await supabase
          .from("restaurant_profiles")
          .select("user_id,status")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!mounted) return;

        // ✅ If error (RLS/policy/etc) => force setup flow
        if (error) {
          console.log("profile check error", error.message, error.details, error.hint);
          navigation.replace("RestaurantSetup");
          return;
        }

        // -> profile missing
        if (!profile) {
          navigation.replace("RestaurantSetup");
          return;
        }

        // -> profile exists but not approved
        if ((profile as any).status !== "approved") {
          // If you don't have RestaurantPending screen, stay on Setup
          navigation.replace("RestaurantSetup");
          return;
        }

        // ✅ profile OK
        // IMPORTANT: do not force "RestaurantMenu" otherwise you are stuck on Menu/Products.
        // Send to restaurant home, then choose: Orders / Menu / Earnings.
        navigation.replace("RestaurantHome");
      } catch (e) {
        console.log("RestaurantGate unexpected error:", e);
        if (!mounted) return;
        navigation.replace("RestaurantAuth");
      }
    })();

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
