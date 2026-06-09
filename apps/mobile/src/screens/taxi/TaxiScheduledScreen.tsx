import React, { useCallback, useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import {
  cancelScheduledTaxiRide,
  fetchScheduledTaxiRides,
  formatTaxiCents,
} from "../../lib/taxiClientApi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiScheduled">;

export default function TaxiScheduledScreen() {
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchScheduledTaxiRides();
      setItems((res?.items as Record<string, unknown>[]) ?? []);
    } catch (e: unknown) {
      Alert.alert("Scheduled", e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD" }}>← Back</Text>
        </TouchableOpacity>
        <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800" }}>
          Scheduled rides
        </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate("TaxiScheduledBook")}
          style={{
            backgroundColor: "#F59E0B",
            padding: 14,
            borderRadius: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "800", color: "#111827" }}>Book scheduled ride</Text>
        </TouchableOpacity>
        {loading ? <ActivityIndicator color="#F59E0B" /> : null}
        {items.map((item) => {
          const ride = item.taxi_rides as Record<string, unknown> | undefined;
          const id = String(item.id ?? "");
          return (
            <View
              key={id}
              style={{
                padding: 14,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "#334155",
              }}
            >
              <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>
                {new Date(String(item.scheduled_pickup_at ?? "")).toLocaleString()}
              </Text>
              <Text style={{ color: "#94A3B8", marginTop: 4 }}>
                {String(ride?.pickup_address ?? "")} → {String(ride?.dropoff_address ?? "")}
              </Text>
              <Text style={{ color: "#86EFAC", marginTop: 4 }}>
                {formatTaxiCents(ride?.total_cents, String(ride?.currency ?? "USD"))}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  cancelScheduledTaxiRide(id)
                    .then(load)
                    .catch((e: unknown) =>
                      Alert.alert("Cancel", e instanceof Error ? e.message : "Failed")
                    )
                }
                style={{ marginTop: 8 }}
              >
                <Text style={{ color: "#FCA5A5" }}>Cancel reservation</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
