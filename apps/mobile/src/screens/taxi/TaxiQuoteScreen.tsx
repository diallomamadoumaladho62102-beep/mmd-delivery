import React, { useCallback, useEffect, useState } from "react";
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
  fetchTaxiBusinessAccounts,
  fetchTaxiFavoriteDrivers,
  fetchTaxiLoyaltyRewards,
  quoteTaxiRide,
  startTaxiCheckout,
  validateTaxiPromotion,
  type TaxiVehicleClass,
} from "../../lib/taxiClientApi";
import {
  formatTaxiLocalizedCurrency,
  getTaxiCountryLabel,
  getTaxiUiString,
  resolveTaxiLanguageForCountry,
} from "../../lib/taxiLocalization";
import {
  applyMmdLocationSelection,
  useMmdLocationPickerResult,
} from "../../lib/useMmdLocationPickerResult";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiQuote">;
type QuoteRoute = RouteProp<RootStackParamList, "TaxiQuote">;

export default function TaxiQuoteScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<QuoteRoute>();
  const [paying, setPaying] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoDiscountCents, setPromoDiscountCents] = useState(0);
  const [preferredDriverId, setPreferredDriverId] = useState<string | null>(null);
  const [rewardId, setRewardId] = useState<string | null>(null);
  const [rewardDiscountCents, setRewardDiscountCents] = useState(0);
  const [rewards, setRewards] = useState<
    { id: string; title: string; points_cost: number; discount_cents: number }[]
  >([]);
  const [favoriteDrivers, setFavoriteDrivers] = useState<
    { driver_user_id: string }[]
  >([]);
  const [sharedRide, setSharedRide] = useState(false);
  const [premiumDriverOnly, setPremiumDriverOnly] = useState(false);
  const [businessRide, setBusinessRide] = useState(false);
  const [businessAccountId, setBusinessAccountId] = useState<string | null>(null);
  const [businessAccounts, setBusinessAccounts] = useState<
    { member_id: string; account?: { id: string; name: string } | null }[]
  >([]);
  const [quoteState, setQuoteState] = useState(route.params.quote);
  const [sharedDiscountCents, setSharedDiscountCents] = useState(0);
  const [pickupAddress, setPickupAddress] = useState(route.params.pickupAddress);
  const [dropoffAddress, setDropoffAddress] = useState(route.params.dropoffAddress);
  const [pickupLocationId, setPickupLocationId] = useState(
    route.params.pickupLocationId ?? ""
  );
  const [dropoffLocationId, setDropoffLocationId] = useState(
    route.params.dropoffLocationId ?? ""
  );
  const [routeInfo, setRouteInfo] = useState(route.params.route);
  const countryCode = route.params.countryCode ?? "US";
  const lang = resolveTaxiLanguageForCountry(countryCode);
  const countryResolution = route.params.countryResolution as
    | { source?: string; detectedCountryCode?: string | null }
    | undefined;

  useEffect(() => {
    void fetchTaxiBusinessAccounts()
      .then((res) => {
        const accounts =
          (res?.accounts as { member_id: string; account?: { id: string; name: string } | null }[]) ??
          [];
        setBusinessAccounts(accounts);
        if (accounts.length === 1 && accounts[0]?.account?.id) {
          setBusinessAccountId(String(accounts[0].account.id));
        }
      })
      .catch(() => setBusinessAccounts([]));

    void fetchTaxiFavoriteDrivers()
      .then((res) => {
        setFavoriteDrivers(
          ((res?.favorites as { driver_user_id: string }[]) ?? []).slice(0, 5)
        );
      })
      .catch(() => setFavoriteDrivers([]));

    void fetchTaxiLoyaltyRewards()
      .then((res) => {
        setRewards(
          ((res?.rewards as { id: string; title: string; points_cost: number; discount_cents: number }[]) ?? []).slice(0, 5)
        );
      })
      .catch(() => setRewards([]));
  }, []);

  const handlePickupLocation = useCallback(
    (location: Parameters<typeof applyMmdLocationSelection>[0]) => {
      applyMmdLocationSelection(location, {
        setLocationId: setPickupLocationId,
        setAddress: setPickupAddress,
      });
    },
    []
  );

  const handleDropoffLocation = useCallback(
    (location: Parameters<typeof applyMmdLocationSelection>[0]) => {
      applyMmdLocationSelection(location, {
        setLocationId: setDropoffLocationId,
        setAddress: setDropoffAddress,
      });
    },
    []
  );

  useMmdLocationPickerResult(route, navigation, {
    taxi_quote_pickup: handlePickupLocation,
    taxi_quote_dropoff: handleDropoffLocation,
  });

  useEffect(() => {
    void quoteTaxiRide({
      pickupAddress,
      dropoffAddress,
      pickupLocationId: pickupLocationId || undefined,
      dropoffLocationId: dropoffLocationId || undefined,
      pickupLat: Number(routeInfo?.pickupLat),
      pickupLng: Number(routeInfo?.pickupLng),
      dropoffLat: Number(routeInfo?.dropoffLat),
      dropoffLng: Number(routeInfo?.dropoffLng),
      vehicleClass: route.params.vehicleClass as TaxiVehicleClass,
      countryCode,
      sharedRide,
    })
      .then((result) => {
        if (result?.ok && result.quote) {
          setQuoteState(result.quote);
          setSharedDiscountCents(Number(result.quote.shared_discount_cents ?? 0));
          if (result.route) {
            setRouteInfo(result.route);
          }
        }
      })
      .catch(() => {
        setQuoteState(route.params.quote);
        setSharedDiscountCents(0);
      });
  }, [
    sharedRide,
    countryCode,
    pickupAddress,
    dropoffAddress,
    pickupLocationId,
    dropoffLocationId,
    route.params.vehicleClass,
  ]);

  const vehicleClass = route.params.vehicleClass;

  const currency = String(quoteState?.currency ?? "USD");
  const fmt = (cents: unknown) =>
    formatTaxiLocalizedCurrency(cents, currency, countryCode);
  const grossTotalCents = Number(
    quoteState?.gross_total_cents ?? quoteState?.total_cents ?? 0
  );
  const netTotalCents = Math.max(
    0,
    grossTotalCents - promoDiscountCents - rewardDiscountCents - sharedDiscountCents
  );
  const total = fmt(netTotalCents);
  const platform = fmt(quoteState?.platform_fee_cents);
  const subtotal = fmt(quoteState?.subtotal_cents);
  const taxCents = Number(quoteState?.tax_cents ?? 0);

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
        pickupLocationId: pickupLocationId || undefined,
        dropoffLocationId: dropoffLocationId || undefined,
        pickupLat: Number(routeInfo?.pickupLat),
        pickupLng: Number(routeInfo?.pickupLng),
        dropoffLat: Number(routeInfo?.dropoffLat),
        dropoffLng: Number(routeInfo?.dropoffLng),
        vehicleClass: vehicleClass as TaxiVehicleClass,
        countryCode,
        expectedQuoteTotalCents: netTotalCents,
        preferredDriverId: preferredDriverId ?? undefined,
        promoCode: promoCode.trim() || undefined,
        rewardId: rewardId ?? undefined,
        sharedRide,
        premiumDriverOnly,
        businessAccountId:
          businessRide && businessAccountId ? businessAccountId : undefined,
        businessTripType: businessRide && businessAccountId ? "business" : "personal",
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
          {getTaxiUiString("estimate", countryCode)}
        </Text>

        <Card label="Vehicle" value={String(vehicleClass).toUpperCase()} />
        <Card
          label={getTaxiUiString("country", countryCode)}
          value={`${countryCode} · ${getTaxiCountryLabel(countryCode, lang)}`}
        />
        {countryResolution?.source === "coords" ? (
          <Text style={{ color: "#64748B", fontSize: 12 }}>
            {getTaxiUiString("detectedCountry", countryCode)}
            {countryResolution.detectedCountryCode
              ? `: ${countryResolution.detectedCountryCode}`
              : ""}
          </Text>
        ) : null}
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

        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            onPress={() =>
              navigation.navigate("MMDLocationPicker", {
                countryCode,
                title: "Pickup exact location",
                submitLabel: "Use pickup location",
                returnTo: "TaxiQuote",
                pickerContext: "taxi_quote_pickup",
              })
            }
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: pickupLocationId ? "#22C55E" : "#334155",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#E2E8F0", fontWeight: "700", fontSize: 12 }}>
              {pickupLocationId ? "Pickup pinned" : "Pin pickup"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              navigation.navigate("MMDLocationPicker", {
                countryCode,
                title: "Dropoff exact location",
                submitLabel: "Use dropoff location",
                returnTo: "TaxiQuote",
                pickerContext: "taxi_quote_dropoff",
              })
            }
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: dropoffLocationId ? "#22C55E" : "#334155",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#E2E8F0", fontWeight: "700", fontSize: 12 }}>
              {dropoffLocationId ? "Dropoff pinned" : "Pin dropoff"}
            </Text>
          </TouchableOpacity>
        </View>

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
          <Text style={{ color: "#94A3B8", fontWeight: "700" }}>
            {lang === "fr" ? "Détail du prix" : "Price breakdown"}
          </Text>
          <Row label={getTaxiUiString("subtotal", countryCode)} value={subtotal} />
          {taxCents > 0 ? (
            <Row label={getTaxiUiString("tax", countryCode)} value={fmt(taxCents)} />
          ) : null}
          <Row label={getTaxiUiString("platformFee", countryCode)} value={platform} />
          {promoDiscountCents > 0 ? (
            <Row
              label="Promo discount"
              value={`-${fmt(promoDiscountCents)}`}
            />
          ) : null}
          {rewardDiscountCents > 0 ? (
            <Row
              label="Reward credit"
              value={`-${fmt(rewardDiscountCents)}`}
            />
          ) : null}
          {sharedDiscountCents > 0 ? (
            <Row
              label="Shared ride discount"
              value={`-${fmt(sharedDiscountCents)}`}
            />
          ) : null}
          <Row label={getTaxiUiString("total", countryCode)} value={total} bold />
        </View>

        <View style={{ gap: 10 }}>
          <OptionToggle
            label="Shared ride (-15%)"
            active={sharedRide}
            onPress={() => setSharedRide((v) => !v)}
          />
          <OptionToggle
            label="Premium driver only"
            active={premiumDriverOnly}
            onPress={() => setPremiumDriverOnly((v) => !v)}
          />
          {businessAccounts.length > 0 ? (
            <>
              <OptionToggle
                label="Business ride"
                active={businessRide}
                onPress={() => setBusinessRide((v) => !v)}
              />
              {businessRide ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {businessAccounts.map((entry) => {
                      const id = entry.account?.id;
                      if (!id) return null;
                      const selected = businessAccountId === id;
                      return (
                        <TouchableOpacity
                          key={entry.member_id}
                          onPress={() => setBusinessAccountId(id)}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: selected ? "#38BDF8" : "#334155",
                          }}
                        >
                          <Text style={{ color: "#E2E8F0" }}>
                            {entry.account?.name ?? id.slice(0, 8)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              ) : null}
            </>
          ) : null}
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

        {rewards.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: "#CBD5E1", fontWeight: "600" }}>Loyalty reward</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  onPress={() => {
                    setRewardId(null);
                    setRewardDiscountCents(0);
                  }}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: rewardId ? "#334155" : "#38BDF8",
                  }}
                >
                  <Text style={{ color: "#E2E8F0" }}>None</Text>
                </TouchableOpacity>
                {rewards.map((reward) => {
                  const selected = rewardId === reward.id;
                  return (
                    <TouchableOpacity
                      key={reward.id}
                      onPress={() => {
                        setRewardId(reward.id);
                        setRewardDiscountCents(reward.discount_cents);
                      }}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: selected ? "#38BDF8" : "#334155",
                      }}
                    >
                      <Text style={{ color: "#E2E8F0" }}>
                        {reward.title} ({reward.points_cost} pts)
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        ) : null}

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

function OptionToggle({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: active ? "#38BDF8" : "#334155",
        backgroundColor: active ? "rgba(56,189,248,0.12)" : "rgba(15,23,42,0.95)",
      }}
    >
      <Text style={{ color: "#E2E8F0", fontWeight: "700" }}>{label}</Text>
    </TouchableOpacity>
  );
}
