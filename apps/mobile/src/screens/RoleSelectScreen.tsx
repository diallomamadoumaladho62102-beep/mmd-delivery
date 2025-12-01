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

type RoleSelectNav = NativeStackNavigationProp<
  RootStackParamList,
  "RoleSelect"
>;

export function RoleSelectScreen() {
  const navigation = useNavigation<RoleSelectNav>();

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
          Choisis ton mode
        </Text>

        <Text
          style={{
            fontSize: 14,
            color: "#9CA3AF",
            marginBottom: 32,
          }}
        >
          Choisis un rôle pour accéder à l&apos;interface correspondante.
        </Text>

        <TouchableOpacity
          style={{
            backgroundColor: "#EF4444",
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: "center",
            marginBottom: 16,
          }}
          onPress={() => navigation.navigate("ClientHome")}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
            Client
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
          onPress={() => navigation.navigate("DriverHome")}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
            Chauffeur
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: "#22C55E",
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: "center",
          }}
          onPress={() => navigation.navigate("RestaurantHome")}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
            Restaurant
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
