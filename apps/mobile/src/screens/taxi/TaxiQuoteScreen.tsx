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
  Image,
  StyleSheet,
  type ImageSourcePropType,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import * as WebBrowser from "expo-web-browser";
import {
  confirmTaxiQuoteCheckoutPaid,
  createTaxiRide,
  fetchTaxiBusinessAccounts,
  fetchTaxiFavoriteDrivers,
  fetchTaxiLoyaltyRewards,
  quoteTaxiRide,
  startTaxiCheckoutFromQuote,
  validateTaxiPromotion,
  type TaxiVehicleClass,
} from "../../lib/taxiClientApi";
import { nextActionAfterCheckoutReturn } from "../../lib/taxiPaymentAbandonFlow";
import { isValidCoordinate } from "../../lib/coordinates";
import {
  formatTaxiLocalizedCurrency,
  getTaxiCountryLabel,
} from "../../lib/taxiLocalization";
import { formatDistance, formatDurationMinutes } from "../../i18n/formatters";
import {
  applyMmdLocationSelection,
  useMmdLocationPickerResult,
} from "../../lib/useMmdLocationPickerResult";
import { rowDirection, textAlignEnd, textAlignStart } from "../../i18n/rtl";
import { useSafeBackNavigation } from "../../navigation/navigationBack";
import { ClientServiceBottomNav } from "../../components/navigation/ClientServiceBottomNav";
import { useClientPlatformFeatures } from "../../hooks/useClientPlatformFeatures";
import { resolveMarketScopeFromFeatures } from "../../lib/marketScope";
import { supabase } from "../../lib/supabase";
import { PaymentMethodPicker } from "../../components/PaymentMethodPicker";
import { type PaymentMethodOption } from "../../lib/paymentMethodsApi";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";
import { APP_HIT } from "../../theme/appTheme";
import {
  loadLocalPaymentMethods,
  shouldOfferLocalMobileMoney,
  startLocalPaymentForMethod,
} from "../../lib/localPayments";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiQuote">;
type QuoteRoute = RouteProp<RootStackParamList, "TaxiQuote">;

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");
const ICON = {
  arrowLeft: require("../../../assets/brand/icons/taxi-quote/arrow-left.png"),
  sparkles: require("../../../assets/brand/icons/taxi-quote/sparkles.png"),
  car: require("../../../assets/brand/icons/taxi-quote/car.png"),
  globe: require("../../../assets/brand/icons/taxi-quote/globe.png"),
  ruler: require("../../../assets/brand/icons/taxi-quote/ruler.png"),
  clock: require("../../../assets/brand/icons/taxi-quote/clock.png"),
  pinPickup: require("../../../assets/brand/icons/taxi-quote/pin-pickup.png"),
  pinDropoff: require("../../../assets/brand/icons/taxi-quote/pin-dropoff.png"),
  pinButton: require("../../../assets/brand/icons/taxi-quote/pin-button.png"),
  receipt: require("../../../assets/brand/icons/taxi-quote/receipt.png"),
  refresh: require("../../../assets/brand/icons/taxi-quote/refresh.png"),
  star: require("../../../assets/brand/icons/taxi-quote/star.png"),
  briefcase: require("../../../assets/brand/icons/taxi-quote/briefcase.png"),
  ticket: require("../../../assets/brand/icons/taxi-quote/ticket.png"),
  check: require("../../../assets/brand/icons/taxi-quote/check.png"),
} as const;

const GOLD_STROKE = "rgba(212,175,55,0.7)";

export default function TaxiQuoteScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<QuoteRoute>();
  const params = route.params ?? ({} as QuoteRoute["params"]);
  const { t, i18n } = useTranslation();
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false);
  const quoteRequestIdRef = useRef(0);
  const [quoting, setQuoting] = useState(!params.quote);
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
  const [quoteState, setQuoteState] = useState<Record<string, unknown> | null>(
    params.quote ?? null,
  );
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
    setQuoting(true);
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
      tripMode: params.tripMode,
      returnMode: params.returnMode,
      returnWaitMinutes: params.returnWaitMinutes,
      returnScheduledAt: params.returnScheduledAt,
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
        setQuoteState(null);
        setSharedDiscountCents(0);
      })
      .finally(() => {
        if (cancelled || requestId !== quoteRequestIdRef.current) return;
        setQuoting(false);
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
    params.tripMode,
    params.returnMode,
    params.returnWaitMinutes,
    params.returnScheduledAt,
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
  const serviceFeeCents = Math.max(0, Math.round(Number(quoteState?.service_fee_cents ?? 0)));
  const platformFeeCents = Math.max(0, Math.round(Number(quoteState?.platform_fee_cents ?? 0)));
  const taxCents = Math.max(0, Math.round(Number(quoteState?.tax_cents ?? 0)));
  const subtotalCents = Math.max(0, Math.round(Number(quoteState?.subtotal_cents ?? 0)));

  const vehicleLabel = useMemo(() => {
    const key = String(vehicleClass ?? "").toLowerCase();
    if (key === "standard" || key === "xl" || key === "premium") {
      return t(`taxi.home.${key}`);
    }
    return String(vehicleClass ?? "").trim();
  }, [t, vehicleClass]);

  const distanceMiles = Number(routeInfo?.distanceMiles);
  const durationMinutes = Number(routeInfo?.durationMinutes);
  const hasDistance = Number.isFinite(distanceMiles) && distanceMiles > 0;
  const hasDuration = Number.isFinite(durationMinutes) && durationMinutes > 0;
  const pickupLabel = pickupAddress.trim();
  const dropoffLabel = dropoffAddress.trim();

  async function handleApplyPromo() {
    const code = promoCode.trim();
    if (!code) return;
    try {
      const result = await validateTaxiPromotion({
        code,
        totalCents: grossTotalCents,
      });
      if (!result?.ok) {
        throw new Error(String(result?.message ?? result?.error ?? t("taxi.quote.invalidPromo", "Invalid promo code")));
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
    if (paying || payingRef.current || !quoteState) return;
    const pickupLat = Number(routeInfo?.pickupLat);
    const pickupLng = Number(routeInfo?.pickupLng);
    const dropoffLat = Number(routeInfo?.dropoffLat);
    const dropoffLng = Number(routeInfo?.dropoffLng);
    const hasCoords =
      isValidCoordinate(pickupLat, pickupLng) &&
      isValidCoordinate(dropoffLat, dropoffLng);
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
      // Local mobile money still needs an entity id today. Stripe Checkout is
      // pay-then-create (no taxi_rides row until payment is confirmed).
      if (shouldOfferLocalMobileMoney(countryCode)) {
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
          tripMode: params.tripMode,
          returnMode: params.returnMode,
          returnWaitMinutes: params.returnWaitMinutes,
          returnScheduledAt: params.returnScheduledAt,
        });

        if (!created?.ok || !created?.ride?.id) {
          throw new Error(created?.error ?? t("taxi.quote.createFailed", "Unable to create ride"));
        }

        const rideId = String(created.ride.id);
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

      const checkout = await startTaxiCheckoutFromQuote({
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
        sharedRide,
        premiumDriverOnly,
        preferElectricOrHybrid: params.preferElectricOrHybrid === true,
        clientPreferences: params.clientPreferences ?? {},
        ambiancePreference: params.ambiancePreference ?? "none",
        businessAccountId:
          businessRide && businessAccountId ? businessAccountId : undefined,
        businessTripType: businessRide && businessAccountId ? "business" : "personal",
        stops: rideStops,
        tripMode: params.tripMode,
        returnMode: params.returnMode,
        returnWaitMinutes: params.returnWaitMinutes,
        returnScheduledAt: params.returnScheduledAt,
      });

      if (!checkout?.ok || !checkout?.url || !checkout?.quote_checkout_id) {
        throw new Error(checkout?.error ?? t("taxi.quote.checkoutMissing", "Checkout is unavailable"));
      }

      const quoteCheckoutId = String(checkout.quote_checkout_id);
      const sessionId = checkout.session_id ? String(checkout.session_id) : null;

      await WebBrowser.openBrowserAsync(String(checkout.url));

      let confirmResult: {
        ok?: boolean;
        already_paid?: boolean;
        payment_status?: string;
        taxi_ride_id?: string;
      } | null = null;
      let confirmThrew = false;
      try {
        confirmResult = await confirmTaxiQuoteCheckoutPaid(quoteCheckoutId, sessionId);
      } catch {
        confirmThrew = true;
      }

      const next = nextActionAfterCheckoutReturn({ confirmResult, confirmThrew });
      if (next !== "go_tracking") {
        Alert.alert(
          t("taxi.quote.payment", "Payment"),
          t(
            "taxi.quote.paymentNotCompleted",
            "Payment was not completed. No ride was created. You can request a new quote when ready."
          )
        );
        return;
      }

      const rideId = String(confirmResult?.taxi_ride_id ?? "").trim();
      if (!rideId) {
        throw new Error(
          t(
            "taxi.quote.rideNotReady",
            "Payment confirmed but the ride is not ready yet. Please refresh your rides list.",
          ),
        );
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

  const detailRows: { icon: ImageSourcePropType; label: string; value: string }[] = [];
  if (vehicleLabel) {
    detailRows.push({
      icon: ICON.car,
      label: t("taxi.quote.vehicle", "Vehicle"),
      value: vehicleLabel,
    });
  }
  if (countryCode) {
    detailRows.push({
      icon: ICON.globe,
      label: t("taxi.ui.country", "Country"),
      value: `${countryCode} · ${getTaxiCountryLabel(countryCode)}`,
    });
  }
  if (hasDistance) {
    detailRows.push({
      icon: ICON.ruler,
      label: t("taxi.quote.distance", "Distance"),
      value: formatDistance(distanceMiles, i18n.language),
    });
  }
  if (hasDuration) {
    detailRows.push({
      icon: ICON.clock,
      label: t("taxi.quote.duration", "Duration"),
      value: formatDurationMinutes(durationMinutes, i18n.language),
    });
  }
  if (pickupLabel) {
    detailRows.push({
      icon: ICON.pinPickup,
      label: t("taxi.quote.pickup", "Pickup"),
      value: pickupLabel,
    });
  }
  if (dropoffLabel) {
    detailRows.push({
      icon: ICON.pinDropoff,
      label: t("taxi.quote.dropoff", "Dropoff"),
      value: dropoffLabel,
    });
  }

  return (
    <>
    <SafeAreaView style={styles.safe} edges={["left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <TaxiQuoteHeader
        title={t("taxi.quote.title", "Estimate")}
        subtitle={t(
          "taxi.quote.subtitle",
          "Review your ride details before confirming",
        )}
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {detailRows.length > 0 ? (
          <View style={styles.card}>
            {detailRows.map((row, index) => (
              <React.Fragment key={`${row.label}-${index}`}>
                {index > 0 ? <View style={styles.rowDivider} /> : null}
                <DetailRow icon={row.icon} label={row.label} value={row.value} />
              </React.Fragment>
            ))}
          </View>
        ) : null}

        {countryResolution?.source === "coords" ? (
          <Text style={[styles.detected, { textAlign: textAlignStart() }]}>
            {t("taxi.ui.detectedCountry", "Detected from pickup")}
            {countryResolution.detectedCountryCode
              ? `: ${countryResolution.detectedCountryCode}`
              : ""}
          </Text>
        ) : null}

        <View style={[styles.pinRow, { flexDirection: rowDirection() }]}>
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
            style={[styles.pinButton, { flexDirection: rowDirection() }]}
            accessibilityRole="button"
            accessibilityLabel={
              pickupLocationId
                ? t("taxi.quote.pickupPinned", "Pickup pinned")
                : t("taxi.quote.pinPickup", "Pin pickup")
            }
          >
            <QuoteIcon source={ICON.pinButton} size={18} />
            <Text style={styles.pinButtonLabel}>
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
            style={[styles.pinButton, { flexDirection: rowDirection() }]}
            accessibilityRole="button"
            accessibilityLabel={
              dropoffLocationId
                ? t("taxi.quote.dropoffPinned", "Dropoff pinned")
                : t("taxi.quote.pinDropoff", "Pin dropoff")
            }
          >
            <QuoteIcon source={ICON.pinButton} size={18} />
            <Text style={styles.pinButtonLabel}>
              {dropoffLocationId
                ? t("taxi.quote.dropoffPinned", "Dropoff pinned")
                : t("taxi.quote.pinDropoff", "Pin dropoff")}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.priceCard}>
          <View style={[styles.priceTitleRow, { flexDirection: rowDirection() }]}>
            <QuoteIcon source={ICON.receipt} size={20} />
            <Text style={styles.priceTitle}>
              {t("taxi.quote.priceBreakdown", "Price breakdown")}
            </Text>
          </View>
          {quoteState ? (
            <>
              {subtotalCents > 0 ? (
                <PriceRow
                  label={t("taxi.ui.subtotal", "Subtotal")}
                  value={fmt(subtotalCents)}
                />
              ) : null}
              {taxCents > 0 ? (
                <PriceRow
                  label={t("taxi.ui.tax", "Tax")}
                  value={fmt(taxCents)}
                />
              ) : null}
              {serviceFeeCents > 0 ? (
                <PriceRow
                  label={t("taxi.quote.serviceFee", "Service fee")}
                  value={fmt(serviceFeeCents)}
                />
              ) : null}
              {platformFeeCents > 0 ? (
                <PriceRow
                  label={t("taxi.ui.platformFee", "Platform fee")}
                  value={fmt(platformFeeCents)}
                />
              ) : null}
              {promoDiscountCents > 0 ? (
                <PriceRow
                  label={t("taxi.quote.promoDiscount", "Promo discount")}
                  value={`-${fmt(promoDiscountCents)}`}
                />
              ) : null}
              {rewardDiscountCents > 0 ? (
                <PriceRow
                  label={t("taxi.quote.rewardCredit", "Reward credit")}
                  value={`-${fmt(rewardDiscountCents)}`}
                />
              ) : null}
              {sharedDiscountCents > 0 ? (
                <PriceRow
                  label={t("taxi.quote.sharedRideDiscount", "Shared ride discount")}
                  value={`-${fmt(sharedDiscountCents)}`}
                />
              ) : null}
              <View style={styles.totalDivider} />
              <PriceRow
                label={t("taxi.ui.total", "Total")}
                value={total}
                bold
              />
            </>
          ) : quoting ? (
            <ActivityIndicator color={MMD_TAXI_GREEN} style={{ marginTop: 8 }} />
          ) : (
            <Text style={[styles.quoteEmpty, { textAlign: textAlignStart() }]}>
              {t("taxi.quote.quoteUnavailable", "Estimate unavailable — check addresses")}
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <OptionToggle
            icon={ICON.refresh}
            label={t("taxi.quote.sharedRide", "Shared ride (-15%)")}
            active={sharedRide}
            onPress={() => setSharedRide((v) => !v)}
          />
          <View style={styles.rowDivider} />
          <OptionToggle
            icon={ICON.star}
            label={t("taxi.quote.premiumDriver", "Premium driver only")}
            active={premiumDriverOnly}
            onPress={() => setPremiumDriverOnly((v) => !v)}
          />
          {businessAccounts.length > 0 ? (
            <>
              <View style={styles.rowDivider} />
              <OptionToggle
                icon={ICON.briefcase}
                label={t("taxi.quote.businessRide", "Business ride")}
                active={businessRide}
                onPress={() => setBusinessRide((v) => !v)}
              />
            </>
          ) : null}
        </View>
        <Text style={[styles.hint, { textAlign: textAlignStart() }]}>
          {t(
            "taxi.quote.sharedRideHint",
            "Optional discount when another passenger shares a similar route. No passenger is matched yet — if no match is found before pickup, you keep the discounted solo fare."
          )}
        </Text>
        {businessRide && businessAccounts.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: rowDirection(), gap: 8 }}>
              {businessAccounts.map((entry) => {
                const id = entry.account?.id;
                if (!id) return null;
                const selected = businessAccountId === id;
                const name = entry.account?.name?.trim();
                return (
                  <TouchableOpacity
                    key={entry.member_id}
                    onPress={() => setBusinessAccountId(id)}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                  >
                    <Text style={styles.chipLabel}>{name || id.slice(0, 8)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        ) : null}

        <View style={styles.priceCard}>
          <View style={[styles.priceTitleRow, { flexDirection: rowDirection() }]}>
            <QuoteIcon source={ICON.ticket} size={20} />
            <Text style={styles.priceTitle}>
              {t("taxi.quote.promoCode", "Promo code")}
            </Text>
          </View>
          <View style={[styles.promoRow, { flexDirection: rowDirection() }]}>
            <TextInput
              value={promoCode}
              onChangeText={setPromoCode}
              placeholder={t("taxi.quote.enterCode", "Enter code")}
              placeholderTextColor="rgba(255,255,255,0.7)"
              autoCapitalize="characters"
              style={styles.promoInput}
            />
            <TouchableOpacity onPress={handleApplyPromo} style={styles.applyButton}>
              <Text style={styles.applyLabel}>{t("taxi.quote.apply", "Apply")}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {rewards.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { textAlign: textAlignStart() }]}>
              {t("taxi.quote.loyaltyReward", "Loyalty reward")}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: rowDirection(), gap: 8 }}>
                <TouchableOpacity
                  onPress={() => {
                    setRewardId(null);
                    setRewardDiscountCents(0);
                  }}
                  style={[styles.chip, !rewardId ? styles.chipSelected : null]}
                >
                  <Text style={styles.chipLabel}>{t("taxi.quote.none", "None")}</Text>
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
                      style={[styles.chip, selected ? styles.chipSelected : null]}
                    >
                      <Text style={styles.chipLabel}>
                        {t("taxi.quote.loyaltyPoints", "{{title}} ({{count}} pts)", {
                          title: reward.title,
                          count: reward.points_cost,
                        })}
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
            <Text style={[styles.sectionLabel, { textAlign: textAlignStart() }]}>
              {t("taxi.quote.preferredDriver", "Preferred driver (optional)")}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: rowDirection(), gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setPreferredDriverId(null)}
                  style={[styles.chip, !preferredDriverId ? styles.chipSelected : null]}
                >
                  <Text style={styles.chipLabel}>{t("taxi.quote.any", "Any")}</Text>
                </TouchableOpacity>
                {favoriteDrivers.map((fav) => {
                  const selected = preferredDriverId === fav.driver_user_id;
                  return (
                    <TouchableOpacity
                      key={fav.driver_user_id}
                      onPress={() => setPreferredDriverId(fav.driver_user_id)}
                      style={[styles.chip, selected ? styles.chipSelected : null]}
                    >
                      <Text style={styles.chipLabel}>
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
          disabled={paying || !quoteState}
          style={[
            styles.cta,
            {
              backgroundColor: quoteState ? MMD_TAXI_GREEN : "#475569",
              opacity: quoteState ? 1 : 0.6,
              flexDirection: rowDirection(),
            },
          ]}
          accessibilityRole="button"
        >
          {paying || (quoting && !quoteState) ? (
            <ActivityIndicator color={MMD_WHITE} />
          ) : (
            <>
              {quoteState ? <QuoteIcon source={ICON.check} size={22} /> : null}
              <Text style={styles.ctaLabel}>
                {quoteState
                  ? t("taxi.quote.confirmPayTotal", "Confirm & pay {{total}}", { total })
                  : t("taxi.quote.quoteUnavailable", "Estimate unavailable — check addresses")}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
      <ClientServiceBottomNav active="home" appearance="glass" />
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

function TaxiQuoteHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const insets = useSafeAreaInsets();
  const goBack = useSafeBackNavigation("ClientHome");
  const { t } = useTranslation();

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
      <View style={[styles.headerRow, { flexDirection: rowDirection() }]}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t("common.back", "Back")}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <QuoteIcon source={ICON.arrowLeft} size={22} />
        </TouchableOpacity>
        <Image
          source={MMD_LOGO}
          style={styles.brand}
          resizeMode="contain"
          accessibilityLabel="MMD"
        />
        <View style={styles.titleBlock}>
          <View style={[styles.titleRow, { flexDirection: rowDirection() }]}>
            <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
              {title}
            </Text>
            <QuoteIcon source={ICON.sparkles} size={24} />
          </View>
          <Text style={[styles.subtitle, { textAlign: textAlignStart() }]} numberOfLines={3}>
            {subtitle}
          </Text>
        </View>
      </View>
    </View>
  );
}

function QuoteIcon({
  source,
  size,
}: {
  source: ImageSourcePropType;
  size: number;
}) {
  return (
    <Image
      source={source}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessible={false}
    />
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: ImageSourcePropType;
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.detailRow, { flexDirection: rowDirection() }]}>
      <View style={[styles.detailLabelWrap, { flexDirection: rowDirection() }]}>
        <QuoteIcon source={icon} size={20} />
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={[styles.detailValue, { textAlign: textAlignEnd() }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function PriceRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View style={[styles.priceRow, { flexDirection: rowDirection() }]}>
      <Text
        style={[
          styles.priceLabel,
          bold ? styles.priceLabelBold : null,
          { textAlign: textAlignStart() },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.priceValue,
          bold ? styles.priceValueBold : null,
          { textAlign: textAlignEnd() },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function OptionToggle({
  icon,
  label,
  active,
  onPress,
}: {
  icon: ImageSourcePropType;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.optionRow, { flexDirection: rowDirection() }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={label}
    >
      <View style={[styles.optionLabelWrap, { flexDirection: rowDirection() }]}>
        <QuoteIcon source={icon} size={20} />
        <Text style={styles.optionLabel}>{label}</Text>
      </View>
      <View
        style={[
          styles.switchTrack,
          active ? styles.switchTrackOn : styles.switchTrackOff,
          { alignItems: active ? "flex-end" : "flex-start" },
        ]}
      >
        <View
          style={[
            styles.switchThumb,
            { backgroundColor: active ? "#94A3B8" : MMD_WHITE },
          ]}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: MMD_BLUE,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  headerRow: {
    gap: 12,
    alignItems: "center",
    paddingVertical: 4,
  },
  backButton: {
    width: APP_HIT.min,
    height: APP_HIT.min,
    borderRadius: 14,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: GOLD_STROKE,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  brand: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GOLD_STROKE,
    flexShrink: 0,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  titleRow: {
    gap: 10,
    alignItems: "center",
  },
  title: {
    color: MMD_WHITE,
    fontSize: 32,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    flexShrink: 1,
    minWidth: 0,
  },
  subtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 16,
  },
  card: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: GOLD_STROKE,
    borderRadius: 24,
    overflow: "hidden",
    width: "100%",
  },
  priceCard: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: GOLD_STROKE,
    borderRadius: 24,
    padding: 20,
    gap: 12,
    width: "100%",
  },
  rowDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    width: "100%",
  },
  detailRow: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    width: "100%",
  },
  detailLabelWrap: {
    gap: 10,
    alignItems: "center",
    flexShrink: 0,
    maxWidth: "46%",
  },
  detailLabel: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 15,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  detailValue: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    flex: 1,
    minWidth: 0,
  },
  detected: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
  },
  pinRow: {
    gap: 12,
    width: "100%",
  },
  pinButton: {
    flex: 1,
    minWidth: 0,
    height: 52,
    borderRadius: 14,
    backgroundColor: MMD_TAXI_GREEN,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 8,
  },
  pinButtonLabel: {
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    textAlign: "center",
    flexShrink: 1,
  },
  priceTitleRow: {
    gap: 10,
    alignItems: "center",
  },
  priceTitle: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    flexShrink: 1,
  },
  priceRow: {
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    width: "100%",
  },
  priceLabel: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 15,
    fontFamily: MMD_FONT.regular,
    flexShrink: 0,
    maxWidth: "48%",
  },
  priceLabelBold: {
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 16,
  },
  priceValue: {
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    flex: 1,
    minWidth: 0,
  },
  priceValueBold: {
    color: MMD_TAXI_GREEN,
    fontSize: 24,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  totalDivider: {
    height: 1,
    backgroundColor: MMD_GOLD_CLASSIC,
    opacity: 0.35,
    width: "100%",
  },
  quoteEmpty: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  optionRow: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    width: "100%",
  },
  optionLabelWrap: {
    gap: 12,
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },
  optionLabel: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    flex: 1,
    flexShrink: 1,
  },
  switchTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    padding: 2,
    flexShrink: 0,
    justifyContent: "center",
  },
  switchTrackOn: {
    backgroundColor: MMD_TAXI_GREEN,
  },
  switchTrackOff: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: GOLD_STROKE,
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  hint: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    lineHeight: 17,
    fontFamily: MMD_FONT.regular,
  },
  promoRow: {
    gap: 12,
    alignItems: "center",
    width: "100%",
  },
  promoInput: {
    flex: 1,
    minWidth: 0,
    height: 52,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: GOLD_STROKE,
    borderRadius: 14,
    paddingHorizontal: 14,
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.regular,
  },
  applyButton: {
    backgroundColor: MMD_TAXI_GREEN,
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  applyLabel: {
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  sectionLabel: {
    color: MMD_GOLD_CLASSIC,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GOLD_STROKE,
    backgroundColor: MMD_GLASS,
  },
  chipSelected: {
    borderColor: MMD_TAXI_GREEN,
  },
  chipLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
  },
  cta: {
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: "100%",
    paddingHorizontal: 12,
  },
  ctaLabel: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontSize: 19,
    fontFamily: MMD_FONT.extrabold,
    textAlign: "center",
    flexShrink: 1,
  },
});
