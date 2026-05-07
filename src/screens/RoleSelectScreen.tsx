import React from "react";
import { View, Text, TouchableOpacity, SafeAreaView } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { supabase } from "../../apps/mobile/src/lib/supabase";
import { setSelectedRole } from "../../apps/mobile/src/lib/authRole";

export function RoleSelectScreen() {
  const navigation = useNavigation<any>();

  async function go(role: "client" | "driver" | "restaurant") {
    await setSelectedRole(role);

    const { data } = await supabase.auth.getSession();
    const hasSession = !!data.session;

    if (!hasSession) {
      if (role === "client") {
        navigation.navigate("ClientAuth");
        return;
      }

      if (role === "driver") {
        navigation.navigate("DriverAuth");
        return;
      }

      if (role === "restaurant") {
        navigation.navigate("RestaurantAuth");
        return;
      }
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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#111827" }}>
      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        <Text
          style={{
            fontSize: 26,
            fontWeight: "700",
            color: "white",
            marginBottom: 16,
          }}
        >
          Choisis ton rôle
        </Text>

        <Text
          style={{
            fontSize: 15,
            color: "#9CA3AF",
            marginBottom: 32,
          }}
        >
          On va créer ensuite une expérience différente pour le client, le
          chauffeur et le restaurant.
        </Text>

        <TouchableOpacity
          style={{
            backgroundColor: "#EF4444",
            paddingVertical: 12,
            borderRadius: 999,
            alignItems: "center",
            marginBottom: 12,
          }}
          onPress={() => go("client")}
        >
          <Text style={{ color: "white", fontWeight: "600", fontSize: 16 }}>
            Je suis un client
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: "#1F2937",
            paddingVertical: 12,
            borderRadius: 999,
            alignItems: "center",
            marginBottom: 12,
            borderWidth: 1,
            borderColor: "#4B5563",
          }}
          onPress={() => go("driver")}
        >
          <Text style={{ color: "white", fontWeight: "600", fontSize: 16 }}>
            Je suis un chauffeur
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: "#1F2937",
            paddingVertical: 12,
            borderRadius: 999,
            alignItems: "center",
            borderWidth: 1,
            borderColor: "#4B5563",
          }}
          onPress={() => go("restaurant")}
        >
          <Text style={{ color: "white", fontWeight: "600", fontSize: 16 }}>
            Je suis un restaurant
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}