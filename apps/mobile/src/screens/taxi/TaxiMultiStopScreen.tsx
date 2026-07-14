import React, { useMemo, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
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
  shouldCreateRideBeforePayment,
} from "../../lib/taxiBookingFlow";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiMultiStop">;

export default function TaxiMultiStopScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const { features, loading: scopeLoading } = useClientPlatformFeatures();
  const market = useMemo(() => resolveMarketScopeFromFeatures(features), [features]);
  const [pickup, setPickup] = useState("");
  const [stop1, setStop1] = useState("");
  const [stop2, setStop2] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [loading, setLoading] = useState(false);

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

      const params = buildMultiStopQuoteNavigationParams({
        pickupAddress: pickup.trim(),
        dropoffAddress: dropoff.trim(),
        vehicleClass: "standard",
        countryCode,
        quote: result.quote,
        route: { ...result.route, stops: result.route?.stops ?? stops },
        stops,
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
        <AddressAutocomplete
          value={stop1}
          onChangeText={setStop1}
          onSelect={(place) => setStop1(place.fullAddress)}
          placeholder={t("taxi.multiStop.stop1", "Stop 1 (optional)")}
          country={market.countryCode || undefined}
        />
        <AddressAutocomplete
          value={stop2}
          onChangeText={setStop2}
          onSelect={(place) => setStop2(place.fullAddress)}
          placeholder={t("taxi.multiStop.stop2", "Stop 2 (optional)")}
          country={market.countryCode || undefined}
        />
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
          {t("taxi.multiStop.pricingNote", "Pricing uses total route distance/duration.")}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
