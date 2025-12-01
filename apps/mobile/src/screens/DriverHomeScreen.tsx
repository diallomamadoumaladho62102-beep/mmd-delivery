import React, { useEffect, useState, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type Ride = {
  id: string;
  status: OrderStatus;
  pickupAddress: string;
  dropoffAddress: string;
  price: number;
  distanceMiles: number;
};

type SupabaseOrderRow = {
  id: string;
  status: OrderStatus;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  total: number | null;
  driver_id: string | null;
  created_at?: string | null;
};

type DriverNav = NativeStackNavigationProp<
  RootStackParamList,
  "DriverHome"
>;

function getStatusLabel(status: OrderStatus) {
  switch (status) {
    case "ready":
      return "Prête (en attente du driver)";
    case "accepted":
      return "Acceptée par un driver";
    case "pending":
      return "En attente de préparation";
    default:
      return status;
  }
}

export function DriverHomeScreen() {
  const navigation = useNavigation<DriverNav>();

  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🔥🔥 — On récupère SEULEMENT les courses READY sans driver
  const fetchRides = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, status, pickup_address, dropoff_address, distance_miles, total, driver_id, created_at"
        )
        .eq("status", "ready")        // 👈 seulement READY
        .is("driver_id", null)        // 👈 seulement sans driver
        .order("created_at", { ascending: false });

      console.log("📦 orders READY pour le driver :", data, "erreur :", error);

      if (error) {
        console.error("Erreur Supabase:", error);
        setError(error.message);
        return;
      }

      const rows = (data ?? []) as SupabaseOrderRow[];

      const mapped: Ride[] = rows.map((o) => ({
        id: o.id,
        status: o.status,
        pickupAddress: o.pickup_address ?? "Adresse pickup inconnue",
        dropoffAddress: o.dropoff_address ?? "Adresse dropoff inconnue",
        price: o.total ?? 0,
        distanceMiles: o.distance_miles ?? 0,
      }));

      setRides(mapped);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRides();
  }, [fetchRides]);

  const handleAcceptRide = async (rideId: string) => {
    try {
      setLoading(true);
      setError(null);

      console.log("➡️ driver_accept_order pour", rideId);
      const { data, error } = await supabase.rpc("driver_accept_order", {
        p_order_id: rideId,
      });

      console.log("⬅️ driver_accept_order réponse :", data, error);

      if (error) {
        console.error("Erreur driver_accept_order:", error);
        setError(error.message);
        Alert.alert(
          "Erreur",
          "Impossible d'accepter la course : " + error.message
        );
        return;
      }

      Alert.alert("Course acceptée", "Tu as accepté la course avec succès.");

      // Rafraîchir la liste (la course disparaît)
      await fetchRides();

      // 👉 On ouvre la page de détail chauffeur
      navigation.navigate("DriverOrderDetails", { orderId: rideId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 }}>
        <Text
          style={{
            color: "white",
            fontSize: 24,
            fontWeight: "800",
            marginBottom: 4,
          }}
        >
          Espace Chauffeur
        </Text>
        <Text style={{ color: "#9CA3AF", fontSize: 14 }}>
          Liste des courses disponibles et de tes livraisons en cours.
        </Text>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 16 }}>
        {error && (
          <Text style={{ color: "#F87171", fontSize: 13, marginBottom: 8 }}>
            Erreur de chargement : {error}
          </Text>
        )}

        {loading && rides.length === 0 ? (
          <View
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <ActivityIndicator />
            <Text style={{ color: "#9CA3AF", marginTop: 8 }}>
              Chargement des courses...
            </Text>
          </View>
        ) : (
          <>
            <Text
              style={{
                color: "#E5E7EB",
                fontSize: 16,
                fontWeight: "600",
                marginBottom: 8,
              }}
            >
              Courses à accepter
            </Text>

            <FlatList
              data={rides}
              keyExtractor={(item) => item.id}
              onRefresh={fetchRides}
              refreshing={loading}
              contentContainerStyle={{ paddingBottom: 24 }}
              ListEmptyComponent={
                <Text style={{ color: "#9CA3AF", marginTop: 16 }}>
                  Aucune course disponible pour le moment.
                </Text>
              }
              renderItem={({ item }) => (
                <View
                  style={{
                    backgroundColor: "#0B1120",
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 12,
                    borderWidth: 1,
                    borderColor: "#1F2937",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <Text
                      style={{
                        color: "#F9FAFB",
                        fontSize: 16,
                        fontWeight: "700",
                      }}
                    >
                      Commande #{item.id.slice(0, 8)}
                    </Text>
                    <Text
                      style={{
                        color:
                          item.status === "ready"
                            ? "#22C55E"
                            : item.status === "accepted"
                            ? "#3B82F6"
                            : "#EAB308",
                        fontSize: 12,
                        fontWeight: "600",
                      }}
                    >
                      {getStatusLabel(item.status)}
                    </Text>
                  </View>

                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                      Pickup :
                    </Text>
                    <Text
                      style={{
                        color: "#E5E7EB",
                        fontSize: 14,
                        fontWeight: "500",
                      }}
                    >
                      {item.pickupAddress}
                    </Text>
                  </View>

                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                      Dropoff :
                    </Text>
                    <Text
                      style={{
                        color: "#E5E7EB",
                        fontSize: 14,
                        fontWeight: "500",
                      }}
                    >
                      {item.dropoffAddress}
                    </Text>
                  </View>

                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 4,
                    }}
                  >
                    <Text style={{ color: "#F9FAFB", fontSize: 14 }}>
                      {item.distanceMiles.toFixed(1)} miles ·{" "}
                      <Text style={{ fontWeight: "700" }}>
                        {item.price.toFixed(2)} USD
                      </Text>
                    </Text>

                    <TouchableOpacity
                      style={{
                        backgroundColor: "#3B82F6",
                        paddingVertical: 8,
                        paddingHorizontal: 16,
                        borderRadius: 999,
                      }}
                      onPress={() => handleAcceptRide(item.id)}
                    >
                      <Text
                        style={{
                          color: "white",
                          fontSize: 13,
                          fontWeight: "600",
                        }}
                      >
                        Accepter
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
