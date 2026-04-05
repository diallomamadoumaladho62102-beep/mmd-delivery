import React from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
} from "react-native";

export function RoleSelectionScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        <Text
          style={{
            fontSize: 26,
            fontWeight: "700",
            color: "white",
            marginBottom: 24,
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
          On va bientôt connecter chaque rôle à Supabase comme sur le site web :
          client, chauffeur, restaurant.
        </Text>

        {[
          { label: "Client", color: "#22C55E" },
          { label: "Chauffeur", color: "#0EA5E9" },
          { label: "Restaurant", color: "#F97316" },
        ].map((item) => (
          <TouchableOpacity
            key={item.label}
            style={{
              backgroundColor: "#020617",
              borderWidth: 1,
              borderColor: item.color,
              paddingVertical: 14,
              paddingHorizontal: 18,
              borderRadius: 999,
              marginBottom: 14,
            }}
            onPress={() => {
              console.log(`Rôle choisi : ${item.label}`);
              // plus tard on naviguera vers les vrais écrans Login / Dashboard
            }}
          >
            <Text
              style={{
                color: item.color,
                fontSize: 16,
                fontWeight: "600",
              }}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}
