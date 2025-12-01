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

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientHome">;

export function ClientHomeScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#111827" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        <Text
          style={{
            fontSize: 28,
            fontWeight: "700",
            color: "white",
            marginBottom: 16,
            textAlign: "center",
          }}
        >
          Espace Client
        </Text>

        <Text
          style={{
            fontSize: 16,
            color: "#9CA3AF",
            marginBottom: 30,
            textAlign: "center",
          }}
        >
          Ici, le client pourra créer une commande,
          suivre une livraison et voir son historique.
        </Text>

        <TouchableOpacity
          style={{
            backgroundColor: "#3B82F6",
            paddingVertical: 16,
            borderRadius: 12,
            marginBottom: 16,
          }}
          onPress={() => {
            // 👉 maintenant on ouvre le nouvel écran
            navigation.navigate("ClientNewOrder");
          }}
        >
          <Text
            style={{
              textAlign: "center",
              color: "white",
              fontWeight: "700",
            }}
          >
            Créer une commande
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: "#22C55E",
            paddingVertical: 16,
            borderRadius: 12,
          }}
          onPress={() => {
            alert("Fonction Client - suivre commande (à venir)");
          }}
        >
          <Text
            style={{
              textAlign: "center",
              color: "white",
              fontWeight: "700",
            }}
          >
            Suivre ma livraison
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
