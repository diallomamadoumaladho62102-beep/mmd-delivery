import React, { useCallback, useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { fetchMyTaxiRides, formatTaxiCents } from "../../lib/taxiClientApi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiHistory">;

export default function TaxiHistoryScreen() {
  const navigation = useNavigation<Nav>();
  const [rides, setRides] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchMyTaxiRides();
      setRides((result?.rides as Record<string, unknown>[]) ?? []);
    } catch (e) {
      console.log("[TaxiHistory]", e);
      setRides([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <StatusBar barStyle="light-content" />
      <View style={{ padding: 16, flex: 1 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD", marginBottom: 12 }}>← Back</Text>
        </TouchableOpacity>
        <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800" }}>
          Taxi history
        </Text>

        {loading ? (
          <ActivityIndicator color="#F59E0B" style={{ marginTop: 24 }} />
        ) : (
          <FlatList
            data={rides}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingTop: 16, gap: 10 }}
            ListEmptyComponent={
              <Text style={{ color: "#94A3B8", marginTop: 20 }}>
                No taxi rides yet.
              </Text>
            }
            renderItem={({ item }) => {
              const rideId = String(item.id);
              const active = !["completed", "canceled"].includes(
                String(item.status ?? "").toLowerCase()
              );

              return (
                <TouchableOpacity
                  onPress={() =>
                    navigation.navigate("TaxiRideTracking", { rideId })
                  }
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    backgroundColor: "rgba(15,23,42,0.95)",
                    borderWidth: 1,
                    borderColor: "#334155",
                  }}
                >
                  <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>
                    {String(item.status ?? "ride").replace(/_/g, " ")}
                  </Text>
                  <Text style={{ color: "#94A3B8", marginTop: 4 }} numberOfLines={1}>
                    {String(item.pickup_address ?? "")} →{" "}
                    {String(item.dropoff_address ?? "")}
                  </Text>
                  <Text style={{ color: "#FDE68A", marginTop: 6, fontWeight: "700" }}>
                    {formatTaxiCents(item.total_cents, String(item.currency ?? "USD"))}
                  </Text>
                  {active ? (
                    <Text style={{ color: "#86EFAC", marginTop: 4, fontSize: 12 }}>
                      Tap to track
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
