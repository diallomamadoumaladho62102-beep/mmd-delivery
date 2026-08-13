import React, { useMemo, useRef, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StatusBar,
  Image,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import * as WebBrowser from "expo-web-browser";
import {
  confirmTaxiPaid,
  createScheduledTaxiRide,
  quoteTaxiRide,
  startTaxiCheckout,
} from "../../lib/taxiClientApi";
import MarketScopeCard from "../../components/market/MarketScopeCard";
import { useClientPlatformFeatures } from "../../hooks/useClientPlatformFeatures";
import { resolveMarketScopeFromFeatures } from "../../lib/marketScope";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GREEN,
  MMD_STROKE,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiScheduledBook">;

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

export default function TaxiScheduledBookScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const { features, loading: scopeLoading } = useClientPlatformFeatures();
  const market = useMemo(() => resolveMarketScopeFromFeatures(features), [features]);
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [when, setWhen] = useState("");
  const [loading, setLoading] = useState(false);
  const bookingInFlightRef = useRef(false);

  async function handleBook() {
    if (bookingInFlightRef.current) return;
    if (!market.scopeResolved || !market.countryCode) {
      Alert.alert(
        t("taxi.scheduledBook.title", "Schedule a ride"),
        t("taxi.home.unavailable", "Taxi is not available in your area yet")
      );
      return;
    }

    bookingInFlightRef.current = true;
    setLoading(true);
    try {
      const scheduledPickupAt = new Date(when).toISOString();
      const countryCode = market.countryCode;
      const quoteRes = await quoteTaxiRide({
        pickupAddress: pickup.trim(),
        dropoffAddress: dropoff.trim(),
        countryCode,
      });
      if (!quoteRes?.ok) throw new Error(quoteRes?.error ?? "Quote failed");

      const created = await createScheduledTaxiRide({
        pickupAddress: pickup.trim(),
        dropoffAddress: dropoff.trim(),
        scheduledPickupAt,
        countryCode,
      });
      if (!created?.ok || !created?.ride?.id) {
        throw new Error(created?.error ?? "Booking failed");
      }

      const rideId = String(created.ride.id);
      const checkout = await startTaxiCheckout(rideId);
      if (checkout?.url) {
        await WebBrowser.openBrowserAsync(String(checkout.url));
        try {
          await confirmTaxiPaid(rideId);
        } catch {
          // webhook may confirm
        }
      }

      navigation.replace("TaxiScheduled");
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.scheduledBook.title", "Schedule a ride"),
        toUserFacingError(e, t("taxi.scheduledBook.bookingFailed", "Booking failed"))
      );
    } finally {
      bookingInFlightRef.current = false;
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("taxi.scheduledBook.title", "Schedule a ride")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Image
          source={MMD_LOGO}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="MMD Delivery"
        />
        <Text style={styles.brand}>MMD Delivery</Text>

        <MarketScopeCard
          market={market}
          areaLabel={t("taxi.home.yourArea", "Your area")}
          currencyLabel={t("taxi.home.currencyLabel", "Currency")}
          loading={scopeLoading}
        />
        <TextInput
          value={pickup}
          onChangeText={setPickup}
          placeholder={t("taxi.home.pickupPlaceholder", "Pickup address")}
          placeholderTextColor={MMD_TEXT_MUTED_BLUE}
          style={styles.input}
        />
        <TextInput
          value={dropoff}
          onChangeText={setDropoff}
          placeholder={t("taxi.home.dropoffPlaceholder", "Dropoff address")}
          placeholderTextColor={MMD_TEXT_MUTED_BLUE}
          style={styles.input}
        />
        <TextInput
          value={when}
          onChangeText={setWhen}
          placeholder={t(
            "taxi.scheduledBook.pickupTimePlaceholder",
            "Pickup time (ISO, e.g. 2026-06-15T14:30:00Z)"
          )}
          placeholderTextColor={MMD_TEXT_MUTED_BLUE}
          style={styles.input}
        />
        <TouchableOpacity
          onPress={handleBook}
          disabled={loading}
          style={styles.cta}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={MMD_WHITE} />
          ) : (
            <Text style={styles.ctaText}>
              {t("taxi.scheduledBook.reserve", "Reserve & prepay")}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  scroll: {
    padding: 20,
    gap: 16,
    alignItems: "center",
  },
  logo: { width: 56, height: 56, borderRadius: 28 },
  brand: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  input: {
    width: "100%",
    height: 42,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
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
});
