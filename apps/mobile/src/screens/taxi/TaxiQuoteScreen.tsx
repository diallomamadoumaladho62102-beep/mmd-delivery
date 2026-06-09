import React, { useEffect, useState } from "react";
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
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import * as WebBrowser from "expo-web-browser";
import {
  confirmTaxiPaid,
  createTaxiRide,
  fetchTaxiFavoriteDrivers,
  formatTaxiCents,
  startTaxiCheckout,
  validateTaxiPromotion,
  type TaxiVehicleClass,
} from "../../lib/taxiClientApi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiQuote">;
type QuoteRoute = RouteProp<RootStackParamList, "TaxiQuote">;

export default function TaxiQuoteScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<QuoteRoute>();
  const [paying, setPaying] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoDiscountCents, setPromoDiscountCents] = useState(0);
  const [preferredDriverId, setPreferredDriverId] = useState<string | null>(null);
  const [favoriteDrivers, setFavoriteDrivers] = useState<
    { driver_user_id: string }[]
  >([]);

  useEffect(() => {
    void fetchTaxiFavoriteDrivers()
      .then((res) => {
        setFavoriteDrivers(
          ((res?.favorites as { driver_user_id: string }[]) ?? []).slice(0, 5)
        );
      })
      .catch(() => {
        setFavoriteDrivers([]);
      });
  }, []);

  const { pickupAddress, dropoffAddress, vehicleClass, quote, route: routeInfo } =
    route.params;

  const currency = String(quote?.currency ?? "USD");
  const grossTotalCents = Number(quote?.total_cents ?? 0);
  const netTotalCents = Math.max(0, grossTotalCents - promoDiscountCents);
  const total = formatTaxiCents(netTotalCents, currency);
  const platform = formatTaxiCents(quote?.platform_fee_cents, currency);
  const subtotal = formatTaxiCents(quote?.subtotal_cents, currency);

  async function handleApplyPromo() {
    const code = promoCode.trim();
    if (!code) return;
    try {
      const result = await validateTaxiPromotion({
        code,
        totalCents: grossTotalCents,
      });
      if (!result?.ok) {
        throw new Error(String(result?.message ?? result?.error ?? "Invalid code"));
      }
      setPromoDiscountCents(Number(result.discount_cents ?? 0));
    } catch (e: unknown) {
      setPromoDiscountCents(0);
      Alert.alert("Promo", e instanceof Error ? e.message : "Invalid promo code");
    }
  }

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
        expectedQuoteTotalCents: netTotalCents,
        preferredDriverId: preferredDriverId ?? undefined,
        promoCode: promoCode.trim() || undefined,
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
          {promoDiscountCents > 0 ? (
            <Row
              label="Promo discount"
              value={`-${formatTaxiCents(promoDiscountCents, currency)}`}
            />
          ) : null}
          <Row label="Total" value={total} bold />
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: "#CBD5E1", fontWeight: "600" }}>Promo code</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={promoCode}
              onChangeText={setPromoCode}
              placeholder="Enter code"
              placeholderTextColor="#64748B"
              autoCapitalize="characters"
              style={{
                flex: 1,
                backgroundColor: "rgba(15,23,42,0.95)",
                borderWidth: 1,
                borderColor: "#334155",
                borderRadius: 14,
                paddingHorizontal: 14,
                paddingVertical: 12,
                color: "#F8FAFC",
              }}
            />
            <TouchableOpacity
              onPress={handleApplyPromo}
              style={{
                backgroundColor: "#334155",
                paddingHorizontal: 16,
                borderRadius: 14,
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>

        {favoriteDrivers.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: "#CBD5E1", fontWeight: "600" }}>
              Preferred driver (optional)
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setPreferredDriverId(null)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: preferredDriverId ? "#334155" : "#38BDF8",
                  }}
                >
                  <Text style={{ color: "#E2E8F0" }}>Any</Text>
                </TouchableOpacity>
                {favoriteDrivers.map((fav) => {
                  const selected = preferredDriverId === fav.driver_user_id;
                  return (
                    <TouchableOpacity
                      key={fav.driver_user_id}
                      onPress={() => setPreferredDriverId(fav.driver_user_id)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: selected ? "#38BDF8" : "#334155",
                      }}
                    >
                      <Text style={{ color: "#E2E8F0" }}>
                        {fav.driver_user_id.slice(0, 8)}…
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        ) : null}

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
