import React from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

import { supabase } from "../lib/supabase";
import { setSelectedRole } from "../lib/authRole";

// ✅ i18n
import { useTranslation } from "react-i18next";

type RoleSelectNav = NativeStackNavigationProp<RootStackParamList, "RoleSelect">;

export function RoleSelectScreen() {
  const navigation = useNavigation<RoleSelectNav>();
  const { t } = useTranslation(); // ✅ re-render on language change

  async function handlePress(role: "client" | "driver" | "restaurant") {
    // 1) mémoriser le rôle
    await setSelectedRole(role);

    // 2) vérifier la session
    const { data } = await supabase.auth.getSession();
    const isLoggedIn = !!data.session;

    // 3) redirection
    if (!isLoggedIn) {
      if (role === "client") {
        navigation.navigate("ClientAuth");
        return;
      }
      if (role === "driver") {
        navigation.navigate("DriverAuth");
        return;
      }
      // ✅ Restaurant: il y a RestaurantAuth dans le Stack
      navigation.navigate("RestaurantAuth");
      return;
    }

    // connecté -> home direct
    if (role === "client") navigation.navigate("ClientHome");
    if (role === "driver") navigation.navigate("DriverTabs"); // ✅ Driver home = DriverTabs
    if (role === "restaurant") navigation.navigate("RestaurantGate"); // ✅ passe par le gate (profil/approval)
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />
      <View
        style={{
          flex: 1,
          paddingHorizontal: 24,
          paddingTop: 32,
        }}
      >
        <Text
          style={{
            fontSize: 24,
            fontWeight: "700",
            color: "white",
            marginBottom: 12,
          }}
        >
          {t("roleSelect.title", "Choose your mode")}
        </Text>

        <Text
          style={{
            fontSize: 14,
            color: "#9CA3AF",
            marginBottom: 32,
          }}
        >
          {t(
            "roleSelect.subtitle",
            "Choose a role to access the corresponding interface."
          )}
        </Text>

        <TouchableOpacity
          style={{
            backgroundColor: "#EF4444",
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: "center",
            marginBottom: 16,
          }}
          onPress={() => handlePress("client")}
          activeOpacity={0.85}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
            {t("roleSelect.roles.client", "Client")}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: "#0EA5E9",
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: "center",
            marginBottom: 16,
          }}
          onPress={() => handlePress("driver")}
          activeOpacity={0.85}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
            {t("roleSelect.roles.driver", "Driver")}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: "#22C55E",
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: "center",
          }}
          onPress={() => handlePress("restaurant")}
          activeOpacity={0.85}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
            {t("roleSelect.roles.restaurant", "Restaurant")}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
