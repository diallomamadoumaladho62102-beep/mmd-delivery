import React from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Image,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

import { supabase } from "../lib/supabase";
import { setSelectedRole } from "../lib/authRole";
import { useTranslation } from "react-i18next";

type RoleSelectNav = NativeStackNavigationProp<RootStackParamList, "RoleSelect">;

export function RoleSelectScreen() {
  const navigation = useNavigation<RoleSelectNav>();
  const { t } = useTranslation();

  async function handlePress(role: "client" | "driver" | "restaurant") {
    await setSelectedRole(role);

    const { data } = await supabase.auth.getSession();
    const isLoggedIn = !!data.session;

    if (!isLoggedIn) {
      if (role === "client") {
        navigation.navigate("ClientAuth");
        return;
      }
      if (role === "driver") {
        navigation.navigate("DriverAuth");
        return;
      }
      navigation.navigate("RestaurantAuth");
      return;
    }

    if (role === "client") {
      navigation.navigate("ClientHome");
      return;
    }

    if (role === "driver") {
      navigation.navigate("DriverTabs");
      return;
    }

    navigation.navigate("RestaurantGate");
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <View
        style={{
          flex: 1,
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: 24,
          justifyContent: "center",
        }}
      >
        <View
          style={{
            alignItems: "center",
            marginBottom: 36,
          }}
        >
          <Image
            source={require("../../assets/icon.png")}
            style={{
              width: 96,
              height: 96,
              marginBottom: 16,
              borderRadius: 24,
            }}
            resizeMode="contain"
          />

          <Text
            style={{
              fontSize: 28,
              fontWeight: "800",
              color: "white",
              marginBottom: 8,
            }}
          >
            MMD Delivery
          </Text>

          <Text
            style={{
              fontSize: 15,
              color: "#CBD5E1",
              textAlign: "center",
              marginBottom: 6,
            }}
          >
            We deliver with heart ❤️
          </Text>

          <Text
            style={{
              fontSize: 14,
              color: "#94A3B8",
              textAlign: "center",
            }}
          >
            Fast, simple and reliable 🚀
          </Text>
        </View>

        <View
          style={{
            backgroundColor: "#0F172A",
            borderRadius: 20,
            padding: 20,
            borderWidth: 1,
            borderColor: "#1E293B",
          }}
        >
          <Text
            style={{
              fontSize: 24,
              fontWeight: "700",
              color: "white",
              marginBottom: 12,
              textAlign: "center",
            }}
          >
            {t("roleSelect.title", "Choose your mode")}
          </Text>

          <Text
            style={{
              fontSize: 14,
              color: "#9CA3AF",
              marginBottom: 28,
              textAlign: "center",
              lineHeight: 20,
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
              paddingVertical: 15,
              borderRadius: 14,
              alignItems: "center",
              marginBottom: 14,
              shadowColor: "#000",
              shadowOpacity: 0.2,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
            onPress={() => handlePress("client")}
            activeOpacity={0.85}
          >
            <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
              {t("roleSelect.roles.client", "Client")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              backgroundColor: "#0EA5E9",
              paddingVertical: 15,
              borderRadius: 14,
              alignItems: "center",
              marginBottom: 14,
              shadowColor: "#000",
              shadowOpacity: 0.2,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
            onPress={() => handlePress("driver")}
            activeOpacity={0.85}
          >
            <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
              {t("roleSelect.roles.driver", "Driver")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              backgroundColor: "#22C55E",
              paddingVertical: 15,
              borderRadius: 14,
              alignItems: "center",
              shadowColor: "#000",
              shadowOpacity: 0.2,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
            onPress={() => handlePress("restaurant")}
            activeOpacity={0.85}
          >
            <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
              {t("roleSelect.roles.restaurant", "Restaurant")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}