import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";

type Route = RouteProp<RootStackParamList, "ClientOrderDetails">;
type Nav = NativeStackNavigationProp<RootStackParamList, "ClientOrderDetails">;

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type Order = {
  id: string;
  status: OrderStatus;
  created_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  total: number | null;
  delivery_fee: number | null;
  pickup_code: string | null;
  dropoff_code: string | null;
};

export function ClientOrderDetailsScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { orderId } = route.params;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  async function fetchOrder() {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("orders")
        .select("id,status,created_at,pickup_address,dropoff_address,distance_miles,total,delivery_fee,pickup_code,dropoff_code")
        .eq("id", orderId)
        .single();

      if (error) throw error;
      setOrder(data as Order);
    } catch (e: any) {
      setError(e?.message ?? "Impossible de charger la commande.");
    } finally {
      setLoading(false);
    }
  }

  function formatStatus(status: OrderStatus) {
    switch (status) {
      case "pending":
        return "En attente (restaurant)";
      case "accepted":
        return "Acceptée (restaurant)";
      case "prepared":
        return "En préparation";
      case "ready":
        return "Prête (en attente chauffeur)";
      case "dispatched":
        return "En livraison";
      case "delivered":
        return "Livrée";
      case "canceled":
        return "Annulée";
      default:
        return status;
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
          <TouchableOpacity onPress={() => navigation.navigate("ClientHome")}>
            <Text style={{ color: "#60A5FA", fontSize: 13 }}>
              ← Retour à l’espace client
            </Text>
          </TouchableOpacity>

          <Text
            style={{
              color: "#E5E7EB",
              fontSize: 22,
              fontWeight: "800",
              marginBottom: 4,
            }}
          >
            Commande #{orderId.slice(0, 8)}
          </Text>
        </View>

        {loading && (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <ActivityIndicator size="large" color="#22C55E" />
            <Text style={{ marginTop: 8, color: "#9CA3AF" }}>Chargement…</Text>
          </View>
        )}

        {!loading && !error && order && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            <View
              style={{
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "#111827",
                backgroundColor: "#020617",
                padding: 14,
                marginBottom: 16,
              }}
            >
              <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
                Code de livraison (à donner au chauffeur)
              </Text>

              <Text
                style={{
                  color: "#F9FAFB",
                  fontSize: 26,
                  fontWeight: "800",
                  letterSpacing: 3,
                  marginTop: 10,
                }}
              >
                {order.dropoff_code ?? "----"}
              </Text>
            </View>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}
