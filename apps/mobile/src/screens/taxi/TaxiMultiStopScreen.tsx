import React, { useMemo, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  View,
  StatusBar,
  Image,
  StyleSheet,
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
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GREEN,
  MMD_STROKE,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiMultiStop">;

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

const inputStyle = {
  height: 42,
  borderWidth: 1.5,
  borderColor: "rgba(255,255,255,0.35)",
  borderRadius: 8,
  paddingHorizontal: 14,
  paddingVertical: 10,
  color: MMD_WHITE,
  backgroundColor: "transparent",
  fontSize: 14,
} as const;

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
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("taxi.multiStop.title", "Multi-stop ride")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Image
          source={MMD_LOGO}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="MMD Delivery"
        />
        <Text style={styles.brand}>MMD Delivery</Text>

        <View style={styles.fullWidth}>
          <MarketScopeCard
            market={market}
            areaLabel={t("taxi.home.yourArea", "Your area")}
            currencyLabel={t("taxi.home.currencyLabel", "Currency")}
            loading={scopeLoading}
          />
        </View>
        <View style={styles.fullWidth}>
          <AddressAutocomplete
            value={pickup}
            onChangeText={setPickup}
            onSelect={(place) => setPickup(place.fullAddress)}
            placeholder={t("taxi.quote.pickup", "Pickup")}
            country={market.countryCode || undefined}
            style={inputStyle}
          />
        </View>
        {stops.map((stop, index) => (
          <View key={`stop-${index}`} style={[styles.fullWidth, { gap: 8 }]}>
            <AddressAutocomplete
              value={stop}
              onChangeText={(text) => updateStop(index, text)}
              onSelect={(place) => updateStop(index, place.fullAddress)}
              placeholder={t("taxi.multiStop.stopN", "Stop {{n}} (optional)", {
                n: index + 1,
              })}
              country={market.countryCode || undefined}
              style={inputStyle}
            />
            <View style={{ flexDirection: rowDirection(), gap: 8 }}>
              <TouchableOpacity
                onPress={() => moveStop(index, -1)}
                disabled={index === 0}
                style={[styles.stopBtn, { opacity: index === 0 ? 0.4 : 1 }]}
              >
                <Text style={styles.stopBtnText}>
                  {t("taxi.multiStop.moveUp", "Up")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => moveStop(index, 1)}
                disabled={index >= stops.length - 1}
                style={[
                  styles.stopBtn,
                  { opacity: index >= stops.length - 1 ? 0.4 : 1 },
                ]}
              >
                <Text style={styles.stopBtnText}>
                  {t("taxi.multiStop.moveDown", "Down")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => removeStop(index)}
                style={styles.stopBtn}
              >
                <Text style={styles.removeText}>
                  {t("taxi.multiStop.remove", "Remove")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        {stops.length < MAX_TAXI_STOPS ? (
          <TouchableOpacity onPress={addStop} style={styles.addStop}>
            <Text style={styles.addStopText}>
              {t("taxi.multiStop.addStop", "Add stop")}
            </Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.fullWidth}>
          <AddressAutocomplete
            value={dropoff}
            onChangeText={setDropoff}
            onSelect={(place) => setDropoff(place.fullAddress)}
            placeholder={t("taxi.multiStop.finalDestination", "Final destination")}
            country={market.countryCode || undefined}
            style={inputStyle}
          />
        </View>
        <TouchableOpacity
          onPress={handleQuote}
          disabled={loading || !market.scopeResolved}
          style={styles.cta}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={MMD_WHITE} />
          ) : (
            <Text style={styles.ctaText}>
              {t("taxi.multiStop.getEstimate", "Get estimate")}
            </Text>
          )}
        </TouchableOpacity>
        <Text style={styles.note}>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 12,
    alignItems: "center",
  },
  logo: { width: 50, height: 50, borderRadius: 25 },
  brand: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 15,
    textAlign: "center",
  },
  fullWidth: { width: "100%" },
  stopBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: MMD_STROKE,
    alignItems: "center",
  },
  stopBtnText: {
    color: "#E2E8F0",
    fontFamily: MMD_FONT.bold,
    fontSize: 13,
    fontWeight: "700",
  },
  removeText: {
    color: "#FCA5A5",
    fontFamily: MMD_FONT.bold,
    fontSize: 13,
    fontWeight: "700",
  },
  addStop: {
    width: "100%",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    alignItems: "center",
  },
  addStopText: {
    color: "#93C5FD",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 15,
    fontWeight: "800",
  },
  cta: {
    width: "100%",
    backgroundColor: MMD_GREEN,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  ctaText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontSize: 15,
    fontWeight: "800",
  },
  note: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
    textAlign: "center",
    width: "100%",
  },
});
