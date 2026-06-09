import React, { useState } from "react";
import {
  SafeAreaView,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import {
  createTaxiRide,
  formatTaxiCents,
  quoteTaxiRide,
  type TaxiVehicleClass,
} from "../../lib/taxiClientApi";
import TaxiCountryPicker from "../../components/taxi/TaxiCountryPicker";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiMultiStop">;

export default function TaxiMultiStopScreen() {
  const navigation = useNavigation<Nav>();
  const [pickup, setPickup] = useState("");
  const [stop1, setStop1] = useState("");
  const [stop2, setStop2] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [loading, setLoading] = useState(false);

  async function handleQuote() {
    setLoading(true);
    try {
      const stops = [stop1, stop2]
        .map((value) => value.trim())
        .filter(Boolean)
        .map((address) => ({ address }));

      const result = await quoteTaxiRide({
        pickupAddress: pickup.trim(),
        dropoffAddress: dropoff.trim(),
        stops,
        vehicleClass: "standard",
        countryCode,
      });

      if (!result?.ok) throw new Error(result?.error ?? "Quote failed");

      const created = await createTaxiRide({
        pickupAddress: pickup.trim(),
        dropoffAddress: dropoff.trim(),
        stops,
        vehicleClass: "standard" as TaxiVehicleClass,
        countryCode,
        expectedQuoteTotalCents: Number(result.quote?.total_cents ?? 0),
      });

      if (!created?.ok || !created?.ride?.id) {
        throw new Error(created?.error ?? "Create failed");
      }

      navigation.navigate("TaxiQuote", {
        pickupAddress: pickup.trim(),
        dropoffAddress: dropoff.trim(),
        vehicleClass: "standard",
        countryCode,
        quote: created.quote ?? result.quote,
        route: { ...result.route, stops: result.route?.stops ?? stops },
      });
    } catch (e: unknown) {
      Alert.alert("Multi-stop", e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD" }}>← Back</Text>
        </TouchableOpacity>
        <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800" }}>
          Multi-stop ride
        </Text>
        <TaxiCountryPicker value={countryCode} onChange={(code) => setCountryCode(code)} />
        <TextInput value={pickup} onChangeText={setPickup} placeholder="Pickup" placeholderTextColor="#64748B" style={inputStyle} />
        <TextInput value={stop1} onChangeText={setStop1} placeholder="Stop 1 (optional)" placeholderTextColor="#64748B" style={inputStyle} />
        <TextInput value={stop2} onChangeText={setStop2} placeholder="Stop 2 (optional)" placeholderTextColor="#64748B" style={inputStyle} />
        <TextInput value={dropoff} onChangeText={setDropoff} placeholder="Final destination" placeholderTextColor="#64748B" style={inputStyle} />
        <TouchableOpacity
          onPress={handleQuote}
          disabled={loading}
          style={{ backgroundColor: "#F59E0B", padding: 16, borderRadius: 14, alignItems: "center" }}
        >
          {loading ? (
            <ActivityIndicator color="#111827" />
          ) : (
            <Text style={{ color: "#111827", fontWeight: "800" }}>Get estimate</Text>
          )}
        </TouchableOpacity>
        <Text style={{ color: "#64748B", textAlign: "center" }}>
          Pricing uses total route distance/duration.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const inputStyle = {
  backgroundColor: "rgba(15,23,42,0.95)",
  borderWidth: 1,
  borderColor: "#334155",
  borderRadius: 14,
  padding: 14,
  color: "#F8FAFC",
} as const;
