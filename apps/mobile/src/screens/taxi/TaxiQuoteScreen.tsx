import React, { useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import * as WebBrowser from "expo-web-browser";
import {
  confirmTaxiPaid,
  createTaxiRide,
  formatTaxiCents,
  startTaxiCheckout,
  type TaxiVehicleClass,
} from "../../lib/taxiClientApi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiQuote">;
type QuoteRoute = RouteProp<RootStackParamList, "TaxiQuote">;

export default function TaxiQuoteScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<QuoteRoute>();
  const [paying, setPaying] = useState(false);

  const { pickupAddress, dropoffAddress, vehicleClass, quote, route: routeInfo } =
    route.params;

  const currency = String(quote?.currency ?? "USD");
  const total = formatTaxiCents(quote?.total_cents, currency);
  const platform = formatTaxiCents(quote?.platform_fee_cents, currency);
  const subtotal = formatTaxiCents(quote?.subtotal_cents, currency);

  async function handleConfirmAndPay() {
    setPaying(true);
    try {
      const created = await createTaxiRide({
        pickupAddress,
        dropoffAddress,
        pickupLat: Number(routeInfo?.pickupLat),
        pickupLng: Number(routeInfo?.pickupLng),
        dropoffLat: Number(routeInfo?.dropoffLat),
        dropoffLng: Number(routeInfo?.dropoffLng),
        vehicleClass: vehicleClass as TaxiVehicleClass,
        expectedQuoteTotalCents: Number(quote?.total_cents ?? 0),
      });

      if (!created?.ok || !created?.ride?.id) {
        throw new Error(created?.error ?? "Failed to create ride");
      }

      const rideId = String(created.ride.id);
      const checkout = await startTaxiCheckout(rideId);

      if (checkout?.already_paid) {
        navigation.replace("TaxiRideTracking", { rideId });
        return;
      }

      if (!checkout?.url) {
        throw new Error(checkout?.error ?? "Checkout URL missing");
      }

      await WebBrowser.openBrowserAsync(String(checkout.url));

      try {
        await confirmTaxiPaid(rideId);
      } catch {
        // webhook may confirm; tracking screen will poll
      }

      navigation.replace("TaxiRideTracking", { rideId });
    } catch (e: unknown) {
      Alert.alert(
        "Payment",
        e instanceof Error ? e.message : "Unable to start payment"
      );
    } finally {
      setPaying(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD" }}>← Back</Text>
        </TouchableOpacity>

        <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800" }}>
          Your estimate
        </Text>

        <Card label="Vehicle" value={String(vehicleClass).toUpperCase()} />
        <Card
          label="Distance"
          value={`${Number(routeInfo?.distanceMiles ?? 0).toFixed(1)} mi`}
        />
        <Card
          label="Duration"
          value={`${Math.ceil(Number(routeInfo?.durationMinutes ?? 0))} min`}
        />
        <Card label="Pickup" value={pickupAddress} />
        <Card label="Dropoff" value={dropoffAddress} />

        <View
          style={{
            marginTop: 8,
            padding: 16,
            borderRadius: 16,
            backgroundColor: "rgba(15,23,42,0.95)",
            borderWidth: 1,
            borderColor: "#334155",
            gap: 8,
          }}
        >
          <Text style={{ color: "#94A3B8", fontWeight: "700" }}>Price breakdown</Text>
          <Row label="Subtotal" value={subtotal} />
          <Row label="Platform fee" value={platform} />
          <Row label="Total" value={total} bold />
        </View>

        <TouchableOpacity
          onPress={handleConfirmAndPay}
          disabled={paying}
          style={{
            marginTop: 12,
            backgroundColor: "#22C55E",
            paddingVertical: 16,
            borderRadius: 16,
            alignItems: "center",
          }}
        >
          {paying ? (
            <ActivityIndicator color="#052e16" />
          ) : (
            <Text style={{ color: "#052e16", fontWeight: "800", fontSize: 16 }}>
              Confirm & pay {total}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        padding: 14,
        borderRadius: 14,
        backgroundColor: "rgba(15,23,42,0.9)",
        borderWidth: 1,
        borderColor: "#1E293B",
      }}
    >
      <Text style={{ color: "#64748B", fontSize: 12, fontWeight: "700" }}>
        {label}
      </Text>
      <Text style={{ color: "#F8FAFC", marginTop: 4, fontSize: 15 }}>{value}</Text>
    </View>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={{ color: "#CBD5E1" }}>{label}</Text>
      <Text
        style={{
          color: bold ? "#FDE68A" : "#F8FAFC",
          fontWeight: bold ? "800" : "600",
        }}
      >
        {value}
      </Text>
    </View>
  );
}
