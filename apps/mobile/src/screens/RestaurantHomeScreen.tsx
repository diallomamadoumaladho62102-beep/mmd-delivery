import React from "react";
import { SafeAreaView, View, Text, StatusBar, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Nav = NativeStackNavigationProp<RootStackParamList, "RestaurantHome">;

export function RestaurantHomeScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: 24,
        }}
      >
        <Text
          style={{
            color: "white",
            fontSize: 26,
            fontWeight: "800",
            marginBottom: 10,
          }}
        >
          Espace Restaurant
        </Text>

        <Text
          style={{
            color: "#9CA3AF",
            fontSize: 16,
            textAlign: "center",
            marginBottom: 20,
          }}
        >
          Ici le restaurant pourra voir :
        </Text>

        <Text style={{ color: "#22C55E", fontSize: 16, marginBottom: 8 }}>
          • Commandes en attente
        </Text>
        <Text style={{ color: "#3B82F6", fontSize: 16, marginBottom: 8 }}>
          • Commandes à préparer
        </Text>
        <Text style={{ color: "#EAB308", fontSize: 16, marginBottom: 20 }}>
          • Commandes prêtes pour le pickup chauffeur
        </Text>

        <TouchableOpacity
          style={{
            marginTop: 10,
            backgroundColor: "#3B82F6",
            paddingVertical: 14,
            paddingHorizontal: 24,
            borderRadius: 12,
          }}
          onPress={() => navigation.navigate("RestaurantOrders")}
        >
          <Text style={{ color: "white", fontWeight: "700" }}>
            Voir les commandes
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
