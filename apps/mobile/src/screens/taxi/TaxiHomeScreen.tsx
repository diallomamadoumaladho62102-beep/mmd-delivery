import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  quoteTaxiRide,
  type TaxiVehicleClass,
} from "../../lib/taxiClientApi";
import TaxiCountryPicker from "../../components/taxi/TaxiCountryPicker";
import TaxiMarketScopeCard from "../../components/taxi/TaxiMarketScopeCard";
import { useClientPlatformFeatures } from "../../hooks/useClientPlatformFeatures";
import {
  isDevCountryPickerEnabled,
  resolveMarketScopeFromFeatures,
} from "../../lib/marketScope";
import { getTaxiUiString } from "../../lib/taxiLocalization";
import {
  applyMmdLocationSelection,
  useMmdLocationPickerResult,
} from "../../lib/useMmdLocationPickerResult";
import { rowDirection } from "../../i18n/rtl";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  fetchTaxiCategoryAvailability,
  type TaxiCategoryAvailability,
} from "../../lib/driverServicePreferencesApi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiHome">;
type TaxiHomeRoute = RouteProp<RootStackParamList, "TaxiHome">;

export default function TaxiHomeScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<TaxiHomeRoute>();
  const { t } = useTranslation();
  const ts = useCallback(
    (key: string, fallback: string) => String(t(key, { defaultValue: fallback })),
    [t]
  );
  const { features, loading: scopeLoading, refreshWithCurrentLocation } =
    useClientPlatformFeatures();
  const market = useMemo(() => resolveMarketScopeFromFeatures(features), [features]);
  const showDevCountryPicker = isDevCountryPickerEnabled();

  useEffect(() => {
    void refreshWithCurrentLocation();
  }, [refreshWithCurrentLocation]);

  useEffect(() => {
    void fetchTaxiCategoryAvailability()
      .then(setCategoryAvailability)
      .catch(() => setCategoryAvailability([]));
  }, []);

  useEffect(() => {
    if (showDevCountryPicker) return;
    setCountryCode(market.countryCode);
    setCurrencyCode(market.currencyCode);
  }, [market.countryCode, market.currencyCode, showDevCountryPicker]);

  const CLASSES = useMemo(
    () =>
      [
        { key: "standard" as const, label: t("taxi.home.standard", "Standard"), emoji: "🚕" },
        { key: "comfort" as const, label: t("taxi.home.comfort", "Comfort"), emoji: "✨" },
        { key: "xl" as const, label: t("taxi.home.xl", "XL"), emoji: "🚐" },
        {
          key: "wheelchair_accessible" as const,
          label: t("taxi.home.wheelchair", "Wheelchair Accessible"),
          emoji: "♿",
        },
      ] as const,
    [t]
  );
  const [categoryAvailability, setCategoryAvailability] = useState<TaxiCategoryAvailability[]>([]);
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [pickupLocationId, setPickupLocationId] = useState(
    route.params?.pickupLocationId ?? ""
  );
  const [dropoffLocationId, setDropoffLocationId] = useState(
    route.params?.dropoffLocationId ?? ""
  );
  const [vehicleClass, setVehicleClass] = useState<TaxiVehicleClass>("standard");
  const [preferElectricOrHybrid, setPreferElectricOrHybrid] = useState(false);
  const [clientPreferences, setClientPreferences] = useState({
    non_smoking_driver: false,
    child_seat_required: false,
    pets_allowed: false,
    large_luggage: false,
    air_conditioning_required: false,
    phone_charger_requested: false,
    prefer_quiet_vehicle: false,
  });
  const [ambiancePreference, setAmbiancePreference] = useState<
    "none" | "quiet" | "music" | "conversation"
  >("none");
  const [countryCode, setCountryCode] = useState(market.countryCode);
  const [currencyCode, setCurrencyCode] = useState(market.currencyCode);
  const [loading, setLoading] = useState(false);

  const handlePickupLocation = useCallback(
    (location: Parameters<typeof applyMmdLocationSelection>[0]) => {
      applyMmdLocationSelection(location, {
        setLocationId: setPickupLocationId,
        setAddress: setPickup,
        ...(showDevCountryPicker
          ? { setCountryCode: setCountryCode }
          : {}),
      });
    },
    [showDevCountryPicker]
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

    if (!market.scopeResolved && !showDevCountryPicker) {
      Alert.alert(
        t("taxi.home.unavailableTitle", "Service not available yet"),
        platformFeatures.service_messages?.taxi ??
          platformFeatures.message ??
          t("taxi.home.unavailable", "Taxi service is not available in this county yet.")
      );
      return;
    }

    const activeCountryCode = showDevCountryPicker ? countryCode : market.countryCode;
    if (!activeCountryCode || !market.taxiAvailable) {
      Alert.alert(
        t("taxi.home.unavailableTitle", "Service not available yet"),
        platformFeatures.service_messages?.taxi ??
          platformFeatures.message ??
          t("taxi.home.unavailable", "Taxi service is not available in this county yet.")
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
        countryCode: activeCountryCode,
      });

      if (!result?.ok) {
        throw new Error(result?.message ?? result?.error ?? "Quote failed");
      }

      const resolvedCountry =
        (result.country_resolution as { countryCode?: string } | undefined)
          ?.countryCode ?? activeCountryCode;

      navigation.navigate("TaxiQuote", {
        pickupAddress: pickupAddress || String(result.route?.pickupAddress ?? ""),
        dropoffAddress: dropoffAddress || String(result.route?.dropoffAddress ?? ""),
        pickupLocationId: pickupLocationId.trim() || undefined,
        dropoffLocationId: dropoffLocationId.trim() || undefined,
        vehicleClass,
        preferElectricOrHybrid,
        clientPreferences,
        ambiancePreference,
        countryCode: resolvedCountry,
        countryResolution: result.country_resolution,
        quote: result.quote,
        route: result.route,
      });
    } catch (e: unknown) {
      const message = toUserFacingError(
        e,
        t("taxi.home.quoteFailed", "Nous n'avons pas pu calculer l'itinéraire exact pour le moment. Veuillez vérifier les adresses ou réessayer."),
      );
      Alert.alert(
        t("taxi.home.estimateFailed", "Estimation indisponible"),
        message.includes("country") || message.includes("pays")
          ? t("taxi.home.countryMismatch", "Le lieu de prise en charge ne correspond pas au pays sélectionné.")
          : message,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={ts("taxi.home.title", "MMD Taxi")}
        subtitle={ts("taxi.home.subtitle", "Book a ride — separate from delivery packages.")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {scopeLoading ? (
          <ActivityIndicator color="#93C5FD" />
        ) : !market.taxiAvailable ? (
          <View
            style={{
              padding: 16,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "#854D0E",
              backgroundColor: "rgba(120,53,15,0.35)",
              gap: 8,
            }}
          >
            <Text style={{ color: "#FDE68A", fontWeight: "800", fontSize: 16 }}>
              {ts("taxi.home.unavailableTitle", "Taxi unavailable")}
            </Text>
            <Text style={{ color: "#FEF3C7", fontSize: 14, lineHeight: 20 }}>
              {ts(
                "taxi.home.unavailable",
                "Taxi is not available in your area yet"
              )}
            </Text>
          </View>
        ) : (
          <>
        <View style={{ gap: 10 }}>
          {showDevCountryPicker ? (
            <TaxiCountryPicker
              value={countryCode}
              onChange={(code, currency) => {
                setCountryCode(code);
                setCurrencyCode(currency);
              }}
            />
          ) : (
            <TaxiMarketScopeCard
              market={market}
              areaLabel={ts("taxi.home.yourArea", "Your area")}
              currencyLabel={ts("taxi.home.currencyLabel", "Currency")}
            />
          )}
          {showDevCountryPicker && currencyCode ? (
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
          <View style={{ flexDirection: rowDirection(), flexWrap: "wrap", gap: 10 }}>
            {CLASSES.map((item) => {
              const selected = vehicleClass === item.key;
              const availability = categoryAvailability.find((c) => c.category === item.key);
              const unavailable = availability && !availability.available;
              return (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => {
                    if (unavailable) {
                      Alert.alert(
                        item.label,
                        availability?.unavailable_message ??
                          "Aucun chauffeur disponible pour cette catégorie actuellement.",
                      );
                      return;
                    }
                    setVehicleClass(item.key);
                  }}
                  style={{
                    width: "48%",
                    padding: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: selected ? "#38BDF8" : unavailable ? "#64748B" : "#334155",
                    backgroundColor: selected
                      ? "rgba(56,189,248,0.12)"
                      : unavailable
                        ? "rgba(100,116,139,0.15)"
                        : "rgba(15,23,42,0.8)",
                    alignItems: "center",
                    opacity: unavailable ? 0.7 : 1,
                  }}
                >
                  <Text style={{ fontSize: 22 }}>{item.emoji}</Text>
                  <Text
                    style={{
                      color: selected ? "#E0F2FE" : "#CBD5E1",
                      fontWeight: "700",
                      marginTop: 4,
                      textAlign: "center",
                    }}
                  >
                    {item.label}
                  </Text>
                  {unavailable ? (
                    <Text style={{ color: "#94A3B8", fontSize: 11, marginTop: 4, textAlign: "center" }}>
                      Indisponible
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ color: "#CBD5E1", fontWeight: "600" }}>
            {t("taxi.home.optionalPreferences", "Préférences facultatives")}
          </Text>
          {(
            [
              ["non_smoking_driver", "Chauffeur non-fumeur"],
              ["child_seat_required", "Siège enfant disponible"],
              ["pets_allowed", "Animaux acceptés"],
              ["large_luggage", "Grand espace bagages"],
              ["air_conditioning_required", "Climatisation obligatoire"],
              ["phone_charger_requested", "Chargeur téléphone"],
              ["prefer_quiet_vehicle", "Véhicule silencieux"],
            ] as const
          ).map(([key, label]) => (
            <View
              key={key}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: "#E2E8F0", flex: 1, paddingRight: 12 }}>{label}</Text>
              <Switch
                value={clientPreferences[key]}
                onValueChange={(value) =>
                  setClientPreferences((prev) => ({ ...prev, [key]: value }))
                }
                trackColor={{ false: "#334155", true: "#38BDF8" }}
              />
            </View>
          ))}
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: "#CBD5E1", fontWeight: "600" }}>
            {t("taxi.home.ambiance", "Ambiance pendant le trajet")}
          </Text>
          {(
            [
              ["none", "🙂 Aucune préférence"],
              ["quiet", "🔇 Trajet calme"],
              ["music", "🎵 Musique"],
              ["conversation", "🗣️ Discussion"],
            ] as const
          ).map(([key, label]) => {
            const selected = ambiancePreference === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setAmbiancePreference(key)}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: selected ? "#38BDF8" : "#334155",
                  backgroundColor: selected ? "rgba(56,189,248,0.12)" : "rgba(15,23,42,0.8)",
                }}
              >
                <Text style={{ color: selected ? "#E0F2FE" : "#CBD5E1" }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 14,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#334155",
            backgroundColor: "rgba(15,23,42,0.8)",
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ color: "#E2E8F0", fontWeight: "700" }}>
              {t("taxi.home.preferElectric", "Je préfère un véhicule électrique ou hybride")}
            </Text>
            <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 4 }}>
              {t(
                "taxi.home.preferElectricHint",
                "Recherche prioritaire, puis bascule automatique si aucun véhicule vert n'est disponible.",
              )}
            </Text>
          </View>
          <Switch
            value={preferElectricOrHybrid}
            onValueChange={setPreferElectricOrHybrid}
            trackColor={{ false: "#334155", true: "#22C55E" }}
          />
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
          </>
        )}
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
