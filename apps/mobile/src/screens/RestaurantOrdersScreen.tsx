import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
} from "react-native";
import { supabase } from "../lib/supabase";

// 👉 Pour l’instant on met l’ID du restaurant test en dur
const RESTAURANT_ID = "306ef52d-aa3c-4475-a7f3-abe0f9f6817c";

type Order = {
  id: string;
  status: string;
  total: number | null;
  created_at: string | null;
};

export function RestaurantOrdersScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchOrders = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("orders")
      .select("id, status, total, created_at")
      .eq("restaurant_id", RESTAURANT_ID)
      .in("status", ["pending", "accepted", "prepared", "ready", "dispatched"])
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Erreur fetch restaurant orders:", error);
    } else {
      setOrders((data || []) as Order[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const renderItem = ({ item }: { item: Order }) => {
    return (
      <View
        style={{
          backgroundColor: "#020617",
          borderRadius: 12,
          padding: 16,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: "#1F2937",
        }}
      >
        <Text
          style={{
            color: "white",
            fontWeight: "700",
            marginBottom: 4,
          }}
        >
          Commande #{item.id.slice(0, 8)}
        </Text>

        <Text style={{ color: "#9CA3AF", marginBottom: 4 }}>
          Statut : <Text style={{ color: "#E5E7EB" }}>{item.status}</Text>
        </Text>

        <Text style={{ color: "#9CA3AF", marginBottom: 4 }}>
          Total :{" "}
          <Text style={{ color: "#F9FAFB" }}>
            {item.total != null ? `${item.total.toFixed(2)} USD` : "—"}
          </Text>
        </Text>

        <Text style={{ color: "#6B7280", fontSize: 12 }}>
          {item.created_at
            ? new Date(item.created_at).toLocaleString()
            : "Date inconnue"}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#111827" }}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, padding: 16 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              color: "white",
              fontSize: 20,
              fontWeight: "700",
            }}
          >
            Commandes restaurant
          </Text>

          <TouchableOpacity
            onPress={fetchOrders}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: "#4B5563",
            }}
          >
            <Text style={{ color: "#E5E7EB", fontSize: 12 }}>Rafraîchir</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <ActivityIndicator />
            <Text style={{ color: "white", marginTop: 8 }}>
              Chargement des commandes…
            </Text>
          </View>
        ) : orders.length === 0 ? (
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#9CA3AF" }}>
              Aucune commande en cours pour ce restaurant.
            </Text>
          </View>
        ) : (
          <FlatList
            data={orders}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
