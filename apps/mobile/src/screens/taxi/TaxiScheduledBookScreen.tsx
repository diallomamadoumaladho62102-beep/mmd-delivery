import React, { useEffect, useMemo, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  Text,
  TextInput,
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
import { textAlignStart } from "../../i18n/rtl";
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

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiScheduledBook">;

export default function TaxiScheduledBookScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const { features, loading: scopeLoading } = useClientPlatformFeatures();
  const market = useMemo(() => resolveMarketScopeFromFeatures(features), [features]);
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [when, setWhen] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleBook() {
    if (!market.scopeResolved || !market.countryCode) {
      Alert.alert(
        t("taxi.scheduledBook.title", "Schedule a ride"),
        t("taxi.home.unavailable", "Taxi is not available in your area yet")
      );
      return;
    }

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
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("taxi.scheduledBook.title", "Schedule a ride")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
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
          placeholderTextColor="#64748B"
          style={inputStyle}
        />
        <TextInput
          value={dropoff}
          onChangeText={setDropoff}
          placeholder={t("taxi.home.dropoffPlaceholder", "Dropoff address")}
          placeholderTextColor="#64748B"
          style={inputStyle}
        />
        <TextInput
          value={when}
          onChangeText={setWhen}
          placeholder={t(
            "taxi.scheduledBook.pickupTimePlaceholder",
            "Pickup time (ISO, e.g. 2026-06-15T14:30:00Z)"
          )}
          placeholderTextColor="#64748B"
          style={inputStyle}
        />
        <TouchableOpacity
          onPress={handleBook}
          disabled={loading}
          style={{
            backgroundColor: "#22C55E",
            padding: 16,
            borderRadius: 14,
            alignItems: "center",
          }}
        >
          {loading ? (
            <ActivityIndicator color="#052e16" />
          ) : (
            <Text style={{ color: "#052e16", fontWeight: "800" }}>
              {t("taxi.scheduledBook.reserve", "Reserve & prepay")}
            </Text>
          )}
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
  padding: 14,
  color: "#F8FAFC",
} as const;
