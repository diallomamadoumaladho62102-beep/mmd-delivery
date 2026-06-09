import React, { useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import {
  quoteTaxiRide,
  type TaxiVehicleClass,
} from "../../lib/taxiClientApi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiHome">;

const CLASSES: { key: TaxiVehicleClass; label: string; emoji: string }[] = [
  { key: "standard", label: "Standard", emoji: "🚕" },
  { key: "xl", label: "XL", emoji: "🚐" },
  { key: "premium", label: "Premium", emoji: "✨" },
];

export default function TaxiHomeScreen() {
  const navigation = useNavigation<Nav>();
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [vehicleClass, setVehicleClass] = useState<TaxiVehicleClass>("standard");
  const [loading, setLoading] = useState(false);

  async function handleQuote() {
    const pickupAddress = pickup.trim();
    const dropoffAddress = dropoff.trim();

    if (!pickupAddress || !dropoffAddress) {
      Alert.alert("Missing address", "Enter pickup and dropoff addresses.");
      return;
    }

    setLoading(true);
    try {
      const result = await quoteTaxiRide({
        pickupAddress,
        dropoffAddress,
        vehicleClass,
      });

      if (!result?.ok) {
        throw new Error(result?.message ?? result?.error ?? "Quote failed");
      }

      navigation.navigate("TaxiQuote", {
        pickupAddress,
        dropoffAddress,
        vehicleClass,
        quote: result.quote,
        route: result.route,
      });
    } catch (e: unknown) {
      Alert.alert(
        "Estimate failed",
        e instanceof Error ? e.message : "Unable to get estimate"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD", fontSize: 16 }}>← Back</Text>
        </TouchableOpacity>

        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800" }}>
          MMD Taxi
        </Text>
        <Text style={{ color: "#94A3B8", fontSize: 15 }}>
          Book a ride — separate from delivery packages.
        </Text>

        <View style={{ gap: 10 }}>
          <Text style={{ color: "#CBD5E1", fontWeight: "600" }}>Pickup</Text>
          <TextInput
            value={pickup}
            onChangeText={setPickup}
            placeholder="Pickup address"
            placeholderTextColor="#64748B"
            style={inputStyle}
          />
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ color: "#CBD5E1", fontWeight: "600" }}>Dropoff</Text>
          <TextInput
            value={dropoff}
            onChangeText={setDropoff}
            placeholder="Dropoff address"
            placeholderTextColor="#64748B"
            style={inputStyle}
          />
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ color: "#CBD5E1", fontWeight: "600" }}>Vehicle</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {CLASSES.map((item) => {
              const selected = vehicleClass === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => setVehicleClass(item.key)}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: selected ? "#38BDF8" : "#334155",
                    backgroundColor: selected
                      ? "rgba(56,189,248,0.12)"
                      : "rgba(15,23,42,0.8)",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontSize: 22 }}>{item.emoji}</Text>
                  <Text
                    style={{
                      color: selected ? "#E0F2FE" : "#CBD5E1",
                      fontWeight: "700",
                      marginTop: 4,
                    }}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <TouchableOpacity
          onPress={handleQuote}
          disabled={loading}
          style={{
            marginTop: 8,
            backgroundColor: "#F59E0B",
            paddingVertical: 16,
            borderRadius: 16,
            alignItems: "center",
          }}
        >
          {loading ? (
            <ActivityIndicator color="#111827" />
          ) : (
            <Text style={{ color: "#111827", fontWeight: "800", fontSize: 16 }}>
              Get estimate
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("TaxiHistory")}>
          <Text style={{ color: "#93C5FD", textAlign: "center" }}>
            View ride history
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("TaxiFavorites")}>
          <Text style={{ color: "#93C5FD", textAlign: "center" }}>
            Favorite drivers
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("TaxiLoyalty")}>
          <Text style={{ color: "#93C5FD", textAlign: "center" }}>
            Loyalty points
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("TaxiScheduled")}>
          <Text style={{ color: "#93C5FD", textAlign: "center" }}>
            Scheduled rides
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("TaxiMultiStop")}>
          <Text style={{ color: "#93C5FD", textAlign: "center" }}>
            Multi-stop ride
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("TaxiLoyaltyRewards")}>
          <Text style={{ color: "#93C5FD", textAlign: "center" }}>
            Loyalty rewards
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const inputStyle = {
  backgroundColor: "rgba(15,23,42,0.95)",
  borderWidth: 1,
  borderColor: "#334155",
  borderRadius: 14,
  paddingHorizontal: 14,
  paddingVertical: 14,
  color: "#F8FAFC",
  fontSize: 16,
} as const;
