import React from "react";
import { View, Text, TouchableOpacity, SafeAreaView } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { supabase } from "../lib/supabase";
import { setSelectedRole } from "../lib/authRole";

export function RoleSelectScreen() {
  const navigation = useNavigation<any>();

  async function go(role: "client" | "driver" | "restaurant") {
    // 1) mémoriser le rôle
    await setSelectedRole(role);

    // 2) checker session
    const { data } = await supabase.auth.getSession();
    const hasSession = !!data.session;

    if (!hasSession) {
      // pas connecté -> vers Auth (si disponible)
      if (role === "client") {
        // ⚠️ nécessite que "ClientAuth" existe dans AppNavigator (on le fait juste après)
        navigation.navigate("ClientAuth");
        return;
      }
      if (role === "driver") {
        navigation.navigate("DriverAuth");
        return;
      }
      if (role === "restaurant") {
        // si tu n'as pas RestaurantAuth, on envoie vers RestaurantHome (tu peux ensuite protéger)
        navigation.navigate("RestaurantHome");
        return;
      }
    }

    // connecté -> vers Home correspondant
    if (role === "client") navigation.navigate("ClientHome");
    if (role === "driver") navigation.navigate("DriverHome");
    if (role === "restaurant") navigation.navigate("RestaurantHome");
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#111827" }}>
      <View
        style={{
          flex: 1,
          padding: 24,
          justifyContent: "center",
        }}
      >
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
