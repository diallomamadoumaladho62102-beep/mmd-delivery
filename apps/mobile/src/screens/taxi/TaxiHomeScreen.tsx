import React, { useCallback, useMemo, useState } from "react";
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
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import {
  quoteTaxiRide,
  type TaxiVehicleClass,
} from "../../lib/taxiClientApi";
import TaxiCountryPicker from "../../components/taxi/TaxiCountryPicker";
import { getTaxiUiString } from "../../lib/taxiLocalization";
import {
  applyMmdLocationSelection,
  useMmdLocationPickerResult,
} from "../../lib/useMmdLocationPickerResult";
import { rowDirection } from "../../i18n/rtl";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiHome">;
type TaxiHomeRoute = RouteProp<RootStackParamList, "TaxiHome">;

export default function TaxiHomeScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<TaxiHomeRoute>();
  const { t } = useTranslation();

  const CLASSES = useMemo(
    () =>
      [
        { key: "standard" as const, label: t("taxi.home.standard", "Standard"), emoji: "🚕" },
        { key: "xl" as const, label: t("taxi.home.xl", "XL"), emoji: "🚐" },
        { key: "premium" as const, label: t("taxi.home.premium", "Premium"), emoji: "✨" },
      ] as const,
    [t]
  );
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [pickupLocationId, setPickupLocationId] = useState(
    route.params?.pickupLocationId ?? ""
  );
  const [dropoffLocationId, setDropoffLocationId] = useState(
    route.params?.dropoffLocationId ?? ""
  );
  const [vehicleClass, setVehicleClass] = useState<TaxiVehicleClass>("standard");
  const [countryCode, setCountryCode] = useState("US");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [loading, setLoading] = useState(false);

  const handlePickupLocation = useCallback(
    (location: Parameters<typeof applyMmdLocationSelection>[0]) => {
      applyMmdLocationSelection(location, {
        setLocationId: setPickupLocationId,
        setAddress: setPickup,
        setCountryCode: setCountryCode,
      });
    },
    []
  );

  const handleDropoffLocation = useCallback(
    (location: Parameters<typeof applyMmdLocationSelection>[0]) => {
      applyMmdLocationSelection(location, {
        setLocationId: setDropoffLocationId,
        setAddress: setDropoff,
      });
    },
    []
  );

  useMmdLocationPickerResult(route, navigation, {
    taxi_pickup: handlePickupLocation,
    taxi_dropoff: handleDropoffLocation,
  });

  function openPickupPicker() {
    navigation.navigate("MMDLocationPicker", {
      countryCode,
      title: t("taxi.home.pickupPickerTitle", "Pickup exact location"),
      submitLabel: t("taxi.home.usePickup", "Use pickup location"),
      returnTo: "TaxiHome",
      pickerContext: "taxi_pickup",
    });
  }

  function openDropoffPicker() {
    navigation.navigate("MMDLocationPicker", {
      countryCode,
      title: t("taxi.home.dropoffPickerTitle", "Dropoff exact location"),
      submitLabel: t("taxi.home.useDropoff", "Use dropoff location"),
      returnTo: "TaxiHome",
      pickerContext: "taxi_dropoff",
    });
  }

  async function handleQuote() {
    const pickupAddress = pickup.trim();
    const dropoffAddress = dropoff.trim();
    const hasPickupLocation = Boolean(pickupLocationId.trim());
    const hasDropoffLocation = Boolean(dropoffLocationId.trim());

    if ((!pickupAddress && !hasPickupLocation) || (!dropoffAddress && !hasDropoffLocation)) {
      Alert.alert(
        t("taxi.home.missingAddress", "Missing address"),
        t("taxi.home.missingAddressBody", "Enter pickup and dropoff addresses.")
      );
      return;
    }

    setLoading(true);
    try {
      const result = await quoteTaxiRide({
        pickupAddress: pickupAddress || undefined,
        dropoffAddress: dropoffAddress || undefined,
        pickupLocationId: pickupLocationId.trim() || undefined,
        dropoffLocationId: dropoffLocationId.trim() || undefined,
        vehicleClass,
        countryCode,
      });

      if (!result?.ok) {
        throw new Error(result?.message ?? result?.error ?? "Quote failed");
      }

      const resolvedCountry =
        (result.country_resolution as { countryCode?: string } | undefined)
          ?.countryCode ?? countryCode;

      navigation.navigate("TaxiQuote", {
        pickupAddress: pickupAddress || String(result.route?.pickupAddress ?? ""),
        dropoffAddress: dropoffAddress || String(result.route?.dropoffAddress ?? ""),
        pickupLocationId: pickupLocationId.trim() || undefined,
        dropoffLocationId: dropoffLocationId.trim() || undefined,
        vehicleClass,
        countryCode: resolvedCountry,
        countryResolution: result.country_resolution,
        quote: result.quote,
        route: result.route,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t("taxi.home.quoteFailed", "Unable to get estimate");
      Alert.alert(
        t("taxi.home.estimateFailed", "Estimate failed"),
        message === "country_mismatch" || message.includes("country")
          ? t("taxi.home.countryMismatch", "Pickup location does not match selected country.")
          : message
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
          <Text style={{ color: "#93C5FD", fontSize: 16 }}>
            {t("taxi.common.back", "← Back")}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800" }}>
          {t("taxi.home.title", "MMD Taxi")}
        </Text>
        <Text style={{ color: "#94A3B8", fontSize: 15 }}>
          {t("taxi.home.subtitle", "Book a ride — separate from delivery packages.")}
        </Text>

        <View style={{ gap: 10 }}>
          <TaxiCountryPicker
            value={countryCode}
            onChange={(code, currency) => {
              setCountryCode(code);
              setCurrencyCode(currency);
            }}
          />
          {currencyCode ? (
            <Text style={{ color: "#64748B", fontSize: 12 }}>
              {getTaxiUiString("estimatesIn", countryCode)} {currencyCode}
            </Text>
          ) : null}
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ color: "#CBD5E1", fontWeight: "600" }}>
            {t("taxi.home.pickup", "Pickup")}
          </Text>
          <TextInput
            value={pickup}
            onChangeText={setPickup}
            placeholder={t("taxi.home.pickupPlaceholder", "Pickup address")}
            placeholderTextColor="#64748B"
            style={inputStyle}
          />
          <TouchableOpacity
            onPress={openPickupPicker}
            style={{
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: "center",
              borderWidth: 1,
              borderColor: pickupLocationId ? "#22C55E" : "#334155",
              backgroundColor: pickupLocationId
                ? "rgba(34,197,94,0.12)"
                : "rgba(15,23,42,0.8)",
            }}
          >
            <Text style={{ color: "#E2E8F0", fontWeight: "700" }}>
              {pickupLocationId
                ? t("taxi.home.pickupPinned", "Pickup pinned on map")
                : t("taxi.home.pinPickup", "Pin exact pickup on map")}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ color: "#CBD5E1", fontWeight: "600" }}>
            {t("taxi.home.dropoff", "Dropoff")}
          </Text>
          <TextInput
            value={dropoff}
            onChangeText={setDropoff}
            placeholder={t("taxi.home.dropoffPlaceholder", "Dropoff address")}
            placeholderTextColor="#64748B"
            style={inputStyle}
          />
          <TouchableOpacity
            onPress={openDropoffPicker}
            style={{
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: "center",
              borderWidth: 1,
              borderColor: dropoffLocationId ? "#22C55E" : "#334155",
              backgroundColor: dropoffLocationId
                ? "rgba(34,197,94,0.12)"
                : "rgba(15,23,42,0.8)",
            }}
          >
            <Text style={{ color: "#E2E8F0", fontWeight: "700" }}>
              {dropoffLocationId
                ? t("taxi.home.dropoffPinned", "Dropoff pinned on map")
                : t("taxi.home.pinDropoff", "Pin exact dropoff on map")}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ color: "#CBD5E1", fontWeight: "600" }}>
            {t("taxi.home.vehicle", "Vehicle")}
          </Text>
          <View style={{ flexDirection: rowDirection(), gap: 10 }}>
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
              {t("taxi.home.getEstimate", "Get estimate")}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("TaxiHistory")}>
          <Text style={{ color: "#93C5FD", textAlign: "center" }}>
            {t("taxi.home.history", "View ride history")}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("TaxiFavorites")}>
          <Text style={{ color: "#93C5FD", textAlign: "center" }}>
            {t("taxi.home.favorites", "Favorite drivers")}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("TaxiLoyalty")}>
          <Text style={{ color: "#93C5FD", textAlign: "center" }}>
            {t("taxi.home.loyalty", "Loyalty points")}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("TaxiScheduled")}>
          <Text style={{ color: "#93C5FD", textAlign: "center" }}>
            {t("taxi.home.scheduled", "Scheduled rides")}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("TaxiMultiStop")}>
          <Text style={{ color: "#93C5FD", textAlign: "center" }}>
            {t("taxi.home.multiStop", "Multi-stop ride")}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("TaxiLoyaltyRewards")}>
          <Text style={{ color: "#93C5FD", textAlign: "center" }}>
            {t("taxi.home.loyaltyRewards", "Loyalty rewards")}
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
