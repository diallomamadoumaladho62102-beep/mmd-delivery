import React, { useMemo, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { quoteTaxiRide } from "../../lib/taxiClientApi";
import MarketScopeCard from "../../components/market/MarketScopeCard";
import { useClientPlatformFeatures } from "../../hooks/useClientPlatformFeatures";
import { resolveMarketScopeFromFeatures } from "../../lib/marketScope";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { AddressAutocomplete } from "../../components/location/AddressAutocomplete";
import {
  buildMultiStopQuoteNavigationParams,
  MAX_TAXI_STOPS,
  normalizeOrderedStops,
  reorderStops,
  shouldCreateRideBeforePayment,
} from "../../lib/taxiBookingFlow";
import { rowDirection } from "../../i18n/rtl";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiMultiStop">;

export default function TaxiMultiStopScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const { features, loading: scopeLoading } = useClientPlatformFeatures();
  const market = useMemo(() => resolveMarketScopeFromFeatures(features), [features]);
  const [pickup, setPickup] = useState("");
  const [stops, setStops] = useState<string[]>([""]);
  const [dropoff, setDropoff] = useState("");
  const [loading, setLoading] = useState(false);

  function updateStop(index: number, value: string) {
    setStops((prev) => prev.map((stop, i) => (i === index ? value : stop)));
  }

  function addStop() {
    setStops((prev) => (prev.length >= MAX_TAXI_STOPS ? prev : [...prev, ""]));
  }

  function removeStop(index: number) {
    setStops((prev) => (prev.length <= 1 ? [""] : prev.filter((_, i) => i !== index)));
  }

  function moveStop(index: number, direction: -1 | 1) {
    setStops((prev) => reorderStops(prev, index, index + direction));
  }

  async function handleQuote() {
    if (!market.scopeResolved || !market.countryCode) {
      Alert.alert(
        t("taxi.multiStop.title", "Multi-stop ride"),
        t("taxi.home.unavailable", "Taxi is not available in your area yet")
      );
      return;
    }

    // Invariant: quote first — never create ride before payment from this screen.
    if (shouldCreateRideBeforePayment()) {
      Alert.alert(
        t("taxi.multiStop.title", "Multi-stop ride"),
        t("taxi.multiStop.createBlocked", "Ride create is blocked until payment.")
      );
      return;
    }

    setLoading(true);
    try {
      const countryCode = market.countryCode;
      const normalizedStops = normalizeOrderedStops(stops);

      const result = await quoteTaxiRide({
        pickupAddress: pickup.trim(),
        dropoffAddress: dropoff.trim(),
        stops: normalizedStops,
        vehicleClass: "standard",
        countryCode,
      });

      if (!result?.ok) throw new Error(result?.error ?? "Quote failed");

      const params = buildMultiStopQuoteNavigationParams({
        pickupAddress: pickup.trim(),
        dropoffAddress: dropoff.trim(),
        vehicleClass: "standard",
        countryCode,
        quote: result.quote,
        route: { ...result.route, stops: result.route?.stops ?? normalizedStops },
        stops: normalizedStops,
      });

      navigation.navigate("TaxiQuote", params);
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.multiStop.title", "Multi-stop ride"),
        toUserFacingError(e, t("taxi.quote.paymentFailed", "Failed"))
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("taxi.multiStop.title", "Multi-stop ride")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
        <MarketScopeCard
          market={market}
          areaLabel={t("taxi.home.yourArea", "Your area")}
          currencyLabel={t("taxi.home.currencyLabel", "Currency")}
          loading={scopeLoading}
        />
        <AddressAutocomplete
          value={pickup}
          onChangeText={setPickup}
          onSelect={(place) => setPickup(place.fullAddress)}
          placeholder={t("taxi.quote.pickup", "Pickup")}
          country={market.countryCode || undefined}
        />
        {stops.map((stop, index) => (
          <View key={`stop-${index}`} style={{ gap: 8 }}>
            <AddressAutocomplete
              value={stop}
              onChangeText={(text) => updateStop(index, text)}
              onSelect={(place) => updateStop(index, place.fullAddress)}
              placeholder={t("taxi.multiStop.stopN", "Stop {{n}} (optional)", {
                n: index + 1,
              })}
              country={market.countryCode || undefined}
            />
            <View style={{ flexDirection: rowDirection(), gap: 8 }}>
              <TouchableOpacity
                onPress={() => moveStop(index, -1)}
                disabled={index === 0}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#334155",
                  alignItems: "center",
                  opacity: index === 0 ? 0.4 : 1,
                }}
              >
                <Text style={{ color: "#E2E8F0", fontWeight: "700" }}>
                  {t("taxi.multiStop.moveUp", "Up")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => moveStop(index, 1)}
                disabled={index >= stops.length - 1}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#334155",
                  alignItems: "center",
                  opacity: index >= stops.length - 1 ? 0.4 : 1,
                }}
              >
                <Text style={{ color: "#E2E8F0", fontWeight: "700" }}>
                  {t("taxi.multiStop.moveDown", "Down")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => removeStop(index)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#7F1D1D",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#FCA5A5", fontWeight: "700" }}>
                  {t("taxi.multiStop.remove", "Remove")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        {stops.length < MAX_TAXI_STOPS ? (
          <TouchableOpacity
            onPress={addStop}
            style={{
              paddingVertical: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#334155",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#93C5FD", fontWeight: "700" }}>
              {t("taxi.multiStop.addStop", "Add stop")}
            </Text>
          </TouchableOpacity>
        ) : null}
        <AddressAutocomplete
          value={dropoff}
          onChangeText={setDropoff}
          onSelect={(place) => setDropoff(place.fullAddress)}
          placeholder={t("taxi.multiStop.finalDestination", "Final destination")}
          country={market.countryCode || undefined}
        />
        <TouchableOpacity
          onPress={handleQuote}
          disabled={loading || !market.scopeResolved}
          style={{ backgroundColor: "#F59E0B", padding: 16, borderRadius: 14, alignItems: "center" }}
        >
          {loading ? (
            <ActivityIndicator color="#111827" />
          ) : (
            <Text style={{ color: "#111827", fontWeight: "800" }}>
              {t("taxi.multiStop.getEstimate", "Get estimate")}
            </Text>
          )}
        </TouchableOpacity>
        <Text style={{ color: "#64748B", textAlign: "center" }}>
          {t(
            "taxi.multiStop.pricingNote",
            "Pricing uses total route distance/duration. Up to {{max}} stops.",
            { max: MAX_TAXI_STOPS },
          )}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
