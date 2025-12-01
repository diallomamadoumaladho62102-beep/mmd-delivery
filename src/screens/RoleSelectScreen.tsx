import React from "react";
import { View, Text, TouchableOpacity, SafeAreaView } from "react-native";

export function RoleSelectScreen() {
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
          onPress={() => {
            console.log("Client choisi ✅");
          }}
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
          onPress={() => {
            console.log("Chauffeur choisi ✅");
          }}
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
          onPress={() => {
            console.log("Restaurant choisi ✅");
          }}
        >
          <Text style={{ color: "white", fontWeight: "600", fontSize: 16 }}>
            Je suis un restaurant
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
