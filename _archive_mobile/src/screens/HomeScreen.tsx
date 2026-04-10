import React from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useTranslation } from "react-i18next";

type HomeScreenNavigation = NativeStackNavigationProp<RootStackParamList, "Home">;

export function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigation>();
  const { t } = useTranslation(); // ✅ re-render on language change

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0F172A" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        <Text
          style={{
            fontSize: 32,
            fontWeight: "800",
            color: "white",
            marginBottom: 8,
          }}
        >
          {t("roleSelect.title", "Choose your mode")}
        </Text>

        <Text
          style={{
            fontSize: 16,
            color: "#9CA3AF",
            marginBottom: 32,
          }}
        >
          {t(
            "roleSelect.subtitle",
            "Choose a role to access the corresponding interface."
          )}
        </Text>

        {/* BOUTON CLIENT */}
        <TouchableOpacity
          onPress={() => navigation.navigate("ClientHome")}
          activeOpacity={0.85}
          style={{
            backgroundColor: "#EF4444",
            paddingVertical: 16,
            borderRadius: 12,
            marginBottom: 20,
          }}
        >
          <Text
            style={{
              textAlign: "center",
              color: "white",
              fontSize: 18,
              fontWeight: "600",
            }}
          >
            {t("roleSelect.roles.client", "Client")}
          </Text>
        </TouchableOpacity>

        {/* BOUTON CHAUFFEUR */}
        <TouchableOpacity
          onPress={() => navigation.navigate("DriverTabs")} // ✅ Driver home = DriverTabs
          activeOpacity={0.85}
          style={{
            backgroundColor: "#3B82F6",
            paddingVertical: 16,
            borderRadius: 12,
            marginBottom: 20,
          }}
        >
          <Text
            style={{
              textAlign: "center",
              color: "white",
              fontSize: 18,
              fontWeight: "600",
            }}
          >
            {t("roleSelect.roles.driver", "Driver")}
          </Text>
        </TouchableOpacity>

        {/* BOUTON RESTAURANT */}
        <TouchableOpacity
          onPress={() => navigation.navigate("RestaurantGate")} // ✅ passe par gate
          activeOpacity={0.85}
          style={{
            backgroundColor: "#22C55E",
            paddingVertical: 16,
            borderRadius: 12,
          }}
        >
          <Text
            style={{
              textAlign: "center",
              color: "white",
              fontSize: 18,
              fontWeight: "600",
            }}
          >
            {t("roleSelect.roles.restaurant", "Restaurant")}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
