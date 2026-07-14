import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
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
import { rowDirection, textAlignStart } from "../../i18n/rtl";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { useClientPlatformFeatures } from "../../hooks/useClientPlatformFeatures";
import { resolveMarketScopeFromFeatures } from "../../lib/marketScope";
import { supabase } from "../../lib/supabase";
import { PaymentMethodPicker } from "../../components/PaymentMethodPicker";
import { type PaymentMethodOption } from "../../lib/paymentMethodsApi";
import {
  loadLocalPaymentMethods,
  shouldOfferLocalMobileMoney,
  startLocalPaymentForMethod,
} from "../../lib/localPayments";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiQuote">;
type QuoteRoute = RouteProp<RootStackParamList, "TaxiQuote">;

export default function TaxiQuoteScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<QuoteRoute>();
  const params = route.params ?? ({} as QuoteRoute["params"]);
  const { t } = useTranslation();
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false);
  const quoteRequestIdRef = useRef(0);
  const [paymentPickerVisible, setPaymentPickerVisible] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [loadingPaymentMethods, setLoadingPaymentMethods] = useState(false);
  const [pendingRideId, setPendingRideId] = useState<string | null>(null);
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
  const [quoteState, setQuoteState] = useState(params.quote);
  const [sharedDiscountCents, setSharedDiscountCents] = useState(0);
  const [pickupAddress, setPickupAddress] = useState(params.pickupAddress);
  const [dropoffAddress, setDropoffAddress] = useState(params.dropoffAddress);
  const [pickupLocationId, setPickupLocationId] = useState(
    params.pickupLocationId ?? ""
  );
  const [dropoffLocationId, setDropoffLocationId] = useState(
    params.dropoffLocationId ?? ""
  );
  const [routeInfo, setRouteInfo] = useState(params.route);
  const { features: platformFeatures } = useClientPlatformFeatures();
  const market = useMemo(
    () => resolveMarketScopeFromFeatures(platformFeatures),
    [platformFeatures]
  );
  const countryCode = params.countryCode ?? market.countryCode ?? "";
  const lang = countryCode
    ? resolveTaxiLanguageForCountry(countryCode)
    : resolveTaxiLanguageForCountry("US");
  const countryResolution = params.countryResolution as
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

  const rideStops = useMemo(() => {
    if (Array.isArray(params.stops) && params.stops.length > 0) {
      return params.stops;
    }
    const fromRoute = params.route?.stops;
    if (Array.isArray(fromRoute) && fromRoute.length > 0) {
      return fromRoute as { address?: string; lat?: number; lng?: number }[];
    }
    return undefined;
  }, [params.stops, params.route?.stops]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++quoteRequestIdRef.current;
    void quoteTaxiRide({
      pickupAddress,
      dropoffAddress,
      pickupLocationId: pickupLocationId || undefined,
      dropoffLocationId: dropoffLocationId || undefined,
      pickupLat: Number(routeInfo?.pickupLat),
      pickupLng: Number(routeInfo?.pickupLng),
      dropoffLat: Number(routeInfo?.dropoffLat),
      dropoffLng: Number(routeInfo?.dropoffLng),
      vehicleClass: params.vehicleClass as TaxiVehicleClass,
      countryCode,
      sharedRide,
      stops: rideStops,
    })
      .then((result) => {
        if (cancelled || requestId !== quoteRequestIdRef.current) return;
        if (result?.ok && result.quote) {
          setQuoteState(result.quote);
          setSharedDiscountCents(Number(result.quote.shared_discount_cents ?? 0));
          if (result.route) {
            setRouteInfo(result.route);
          }
        }
      })
      .catch(() => {
        if (cancelled || requestId !== quoteRequestIdRef.current) return;
        setQuoteState(params.quote);
        setSharedDiscountCents(0);
      });
    return () => {
      cancelled = true;
    };
  }, [
    sharedRide,
    countryCode,
    pickupAddress,
    dropoffAddress,
    pickupLocationId,
    dropoffLocationId,
    params.vehicleClass,
    rideStops,
  ]);

  const vehicleClass = params.vehicleClass;

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
  const serviceFee = fmt(quoteState?.service_fee_cents);
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
      Alert.alert(
        t("taxi.quote.promoCode", "Promo code"),
        toUserFacingError(e, t("taxi.quote.invalidPromo", "Invalid promo code"))
      );
    }
  }

  async function handleLocalTaxiPayment(method: PaymentMethodOption) {
    if (!pendingRideId) return;
    setPaymentPickerVisible(false);
    setPaying(true);
    try {
      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error || !accessToken) {
        throw new Error(t("taxi.quote.loginRequired", "You must be logged in to pay."));
      }

      const result = await startLocalPaymentForMethod(accessToken, {
        entityType: "taxi_ride",
        entityId: pendingRideId,
        countryCode,
        methodCode: method.method_code,
      });

      if (!result.paid) {
        throw new Error(result.error ?? t("taxi.quote.paymentFailed", "Unable to start payment"));
      }

      navigation.replace("TaxiRideTracking", { rideId: pendingRideId });
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.quote.payment", "Payment"),
        toUserFacingError(e, t("taxi.quote.paymentFailed", "Unable to start payment"))
      );
    } finally {
      setPaying(false);
      setPendingRideId(null);
    }
  }

  async function handleConfirmAndPay() {
    if (paying || payingRef.current) return;
    const pickupLat = Number(routeInfo?.pickupLat);
    const pickupLng = Number(routeInfo?.pickupLng);
    const dropoffLat = Number(routeInfo?.dropoffLat);
    const dropoffLng = Number(routeInfo?.dropoffLng);
    const hasCoords =
      Number.isFinite(pickupLat) &&
      Number.isFinite(pickupLng) &&
      Number.isFinite(dropoffLat) &&
      Number.isFinite(dropoffLng);
    const hasLocationIds = Boolean(pickupLocationId || dropoffLocationId);
    if (!hasCoords && !hasLocationIds && !pickupAddress.trim()) {
      Alert.alert(
        t("taxi.quote.payment", "Payment"),
        t("taxi.quote.missingRoute", "Pickup and dropoff are incomplete")
      );
      return;
    }

    payingRef.current = true;
    setPaying(true);
    try {
      const created = await createTaxiRide({
        pickupAddress,
        dropoffAddress,
        pickupLocationId: pickupLocationId || undefined,
        dropoffLocationId: dropoffLocationId || undefined,
        pickupLat: hasCoords ? pickupLat : undefined,
        pickupLng: hasCoords ? pickupLng : undefined,
        dropoffLat: hasCoords ? dropoffLat : undefined,
        dropoffLng: hasCoords ? dropoffLng : undefined,
        vehicleClass: vehicleClass as TaxiVehicleClass,
        countryCode,
        expectedQuoteTotalCents: netTotalCents,
        preferredDriverId: preferredDriverId ?? undefined,
        promoCode: promoCode.trim() || undefined,
        rewardId: rewardId ?? undefined,
        sharedRide,
        premiumDriverOnly,
        preferElectricOrHybrid: params.preferElectricOrHybrid === true,
        clientPreferences: params.clientPreferences ?? {},
        ambiancePreference: params.ambiancePreference ?? "none",
        businessAccountId:
          businessRide && businessAccountId ? businessAccountId : undefined,
        businessTripType: businessRide && businessAccountId ? "business" : "personal",
        stops: rideStops,
      });

      if (!created?.ok || !created?.ride?.id) {
        throw new Error(created?.error ?? "Failed to create ride");
      }

      const rideId = String(created.ride.id);

      if (shouldOfferLocalMobileMoney(countryCode)) {
        const { data, error } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (error || !accessToken) {
          throw new Error(t("taxi.quote.loginRequired", "You must be logged in to pay."));
        }
        setPendingRideId(rideId);
        setLoadingPaymentMethods(true);
        setPaymentPickerVisible(true);
        const methods = await loadLocalPaymentMethods(accessToken, {
          entityType: "taxi_ride",
          entityId: rideId,
          countryCode,
        });
        setPaymentMethods(methods);
        setLoadingPaymentMethods(false);
        payingRef.current = false;
        setPaying(false);
        return;
      }

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
        t("taxi.quote.payment", "Payment"),
        toUserFacingError(e, t("taxi.quote.paymentFailed", "Unable to start payment"))
      );
    } finally {
      payingRef.current = false;
      setPaying(false);
    }
  }

  return (
    <>
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={getTaxiUiString("estimate", countryCode)}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Card label={t("taxi.quote.vehicle", "Vehicle")} value={String(vehicleClass).toUpperCase()} />
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
          label={t("taxi.quote.distance", "Distance")}
          value={`${Number(routeInfo?.distanceMiles ?? 0).toFixed(1)} mi`}
        />
        <Card
          label={t("taxi.quote.duration", "Duration")}
          value={`${Math.ceil(Number(routeInfo?.durationMinutes ?? 0))} min`}
        />
        <Card label={t("taxi.quote.pickup", "Pickup")} value={pickupAddress} />
        <Card label={t("taxi.quote.dropoff", "Dropoff")} value={dropoffAddress} />

        <View style={{ flexDirection: rowDirection(), gap: 8 }}>
          <TouchableOpacity
            onPress={() =>
              navigation.navigate("MMDLocationPicker", {
                countryCode,
                title: t("taxi.home.pickupPickerTitle", "Pickup exact location"),
                submitLabel: t("taxi.home.usePickup", "Use pickup location"),
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
              {pickupLocationId
                ? t("taxi.quote.pickupPinned", "Pickup pinned")
                : t("taxi.quote.pinPickup", "Pin pickup")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              navigation.navigate("MMDLocationPicker", {
                countryCode,
                title: t("taxi.home.dropoffPickerTitle", "Dropoff exact location"),
                submitLabel: t("taxi.home.useDropoff", "Use dropoff location"),
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
              {dropoffLocationId
                ? t("taxi.quote.dropoffPinned", "Dropoff pinned")
                : t("taxi.quote.pinDropoff", "Pin dropoff")}
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
          <Text style={{ color: "#94A3B8", fontWeight: "700", textAlign: textAlignStart() }}>
            {t("taxi.quote.priceBreakdown", "Price breakdown")}
          </Text>
          <Row label={getTaxiUiString("subtotal", countryCode)} value={subtotal} />
          {taxCents > 0 ? (
            <Row label={getTaxiUiString("tax", countryCode)} value={fmt(taxCents)} />
          ) : null}
          <Row
            label={t("taxi.quote.serviceFee", "Service fee")}
            value={serviceFee}
          />
          <Row label={getTaxiUiString("platformFee", countryCode)} value={platform} />
          {promoDiscountCents > 0 ? (
            <Row
              label={t("taxi.quote.promoDiscount", "Promo discount")}
              value={`-${fmt(promoDiscountCents)}`}
            />
          ) : null}
          {rewardDiscountCents > 0 ? (
            <Row
              label={t("taxi.quote.rewardCredit", "Reward credit")}
              value={`-${fmt(rewardDiscountCents)}`}
            />
          ) : null}
          {sharedDiscountCents > 0 ? (
            <Row
              label={t("taxi.quote.sharedRideDiscount", "Shared ride discount")}
              value={`-${fmt(sharedDiscountCents)}`}
            />
          ) : null}
          <Row label={getTaxiUiString("total", countryCode)} value={total} bold />
        </View>

        <View style={{ gap: 10 }}>
          <OptionToggle
            label={t("taxi.quote.sharedRide", "Shared ride (-15%)")}
            active={sharedRide}
            onPress={() => setSharedRide((v) => !v)}
          />
          <OptionToggle
            label={t("taxi.quote.premiumDriver", "Premium driver only")}
            active={premiumDriverOnly}
            onPress={() => setPremiumDriverOnly((v) => !v)}
          />
          {businessAccounts.length > 0 ? (
            <>
              <OptionToggle
                label={t("taxi.quote.businessRide", "Business ride")}
                active={businessRide}
                onPress={() => setBusinessRide((v) => !v)}
              />
              {businessRide ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: rowDirection(), gap: 8 }}>
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
          <Text style={{ color: "#CBD5E1", fontWeight: "600", textAlign: textAlignStart() }}>
            {t("taxi.quote.promoCode", "Promo code")}
          </Text>
          <View style={{ flexDirection: rowDirection(), gap: 8 }}>
            <TextInput
              value={promoCode}
              onChangeText={setPromoCode}
              placeholder={t("taxi.quote.enterCode", "Enter code")}
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
              <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>
                {t("taxi.quote.apply", "Apply")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {rewards.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: "#CBD5E1", fontWeight: "600", textAlign: textAlignStart() }}>
              {t("taxi.quote.loyaltyReward", "Loyalty reward")}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: rowDirection(), gap: 8 }}>
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
                  <Text style={{ color: "#E2E8F0" }}>{t("taxi.quote.none", "None")}</Text>
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
            <Text style={{ color: "#CBD5E1", fontWeight: "600", textAlign: textAlignStart() }}>
              {t("taxi.quote.preferredDriver", "Preferred driver (optional)")}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: rowDirection(), gap: 8 }}>
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
                  <Text style={{ color: "#E2E8F0" }}>{t("taxi.quote.any", "Any")}</Text>
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
              {t("taxi.quote.confirmPayTotal", "Confirm & pay {{total}}", { total })}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
    <PaymentMethodPicker
      visible={paymentPickerVisible}
      title={t("taxi.quote.payment", "Payment")}
      methods={paymentMethods}
      loading={loadingPaymentMethods}
      onClose={() => {
        setPaymentPickerVisible(false);
        setPendingRideId(null);
      }}
      onSelect={handleLocalTaxiPayment}
    />
  </>
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
      <Text style={{ color: "#64748B", fontSize: 12, fontWeight: "700", textAlign: textAlignStart() }}>
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
    <View style={{ flexDirection: rowDirection(), justifyContent: "space-between" }}>
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
