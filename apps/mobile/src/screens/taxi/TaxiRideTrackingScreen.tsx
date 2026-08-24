import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Alert,
  ScrollView,
  AppState,
  type AppStateStatus,
  Share,
  useWindowDimensions,
  Platform,
  StyleSheet,
  Image,
  Modal,
  TextInput,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { textAlignStart } from "../../i18n/rtl";
import * as WebBrowser from "expo-web-browser";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_GOLD_CLASSIC_BORDER,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");
import {
  cancelTaxiRide,
  confirmTaxiPaid,
  fetchTaxiRide,
  previewTaxiAddStop,
  previewTaxiDestinationChange,
  formatTaxiCents,
  startTaxiCheckout,
} from "../../lib/taxiClientApi";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../../lib/supabaseRealtime";
import { useLiveDriverLocation } from "../../hooks/useLiveDriverLocation";
import { useLiveTripEta } from "../../hooks/useLiveTripEta";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import {
  BOOT_AUTH_TIMEOUT_MS,
  withTimeout,
} from "../../lib/bootFailOpen";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { useSmoothedDriverMarker } from "../../hooks/useSmoothedDriverMarker";
import { LiveTripMap } from "../../components/tracking/LiveTripMap";
import { TrackingTopBar } from "../../components/tracking/TrackingTopBar";
import { TrackingStatusBanner } from "../../components/tracking/TrackingStatusBanner";
import { TripRouteCard } from "../../components/tracking/TripRouteCard";
import { DriverProfileCard } from "../../components/tracking/DriverProfileCard";
import { SafetyAudioCard } from "../../components/tracking/SafetyAudioCard";
import { TrackingBottomActions } from "../../components/tracking/TrackingBottomActions";
import { VerificationCodeCard } from "../../components/shared/VerificationCodeCard";
import { toCoordinatePoint } from "../../lib/coordinates";
import { resolveEtaEndpoints } from "../../lib/liveTripTracking";
import { startMaskedCall } from "../../lib/maskedCall";
import { readCustomerTrackingIdentification } from "../../lib/customerTrackingIdentification";
import {
  buildCustomerTrackingLabels,
  isTaxiAwaitingPayment,
} from "../../lib/customerTrackingStatus";
import {
  formatTripDistance,
  resolveNavigationLocale,
  resolveUnitSystem,
} from "../../lib/navigationLocale";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiRideTracking">;
type TrackingRoute = RouteProp<RootStackParamList, "TaxiRideTracking">;

const CANCELABLE = new Set([
  "draft",
  "quoted",
  "pending_payment",
  "paid",
  "dispatching",
  "accepted",
  "driver_arrived",
  "in_progress",
]);

const CLIENT_CANCEL_REASONS: Array<{ code: string; label: string }> = [
  { code: "driver_taking_too_long", label: "Driver taking too long" },
  { code: "driver_too_far", label: "Driver is too far away" },
  { code: "changed_mind", label: "Changed my mind" },
  { code: "wrong_pickup", label: "Wrong pickup location" },
  { code: "wrong_destination", label: "Wrong destination" },
  { code: "found_another_option", label: "Found another option" },
  { code: "problem_with_driver", label: "Problem with the driver" },
  { code: "problem_with_vehicle", label: "Problem with the vehicle" },
  { code: "pickup_problem", label: "Pickup problem" },
  { code: "emergency", label: "Emergency" },
  { code: "other", label: "Other" },
];

const PAYMENT_PENDING = new Set(["pending_payment", "processing"]);
const PAID_PAYMENT = new Set(["paid", "refunded"]);
const ACTIVE_SAFETY_STATUSES = new Set(["accepted", "driver_arrived", "in_progress"]);
const SHOW_DRIVER_ID_STATUSES = new Set([
  "accepted",
  "driver_arrived",
  "in_progress",
  "completed",
]);

/** Responsive map band: ~28–35% of available height. */
function resolveMapHeight(windowHeight: number, insetTop: number): number {
  const available = Math.max(480, windowHeight - insetTop);
  const ratio = windowHeight < 700 ? 0.3 : windowHeight > 900 ? 0.33 : 0.32;
  return Math.round(
    Math.min(Math.max(available * ratio, 190), available * 0.38),
  );
}

export default function TaxiRideTrackingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<TrackingRoute>();
  const { t, i18n } = useTranslation();
  const rideId = route.params?.rideId;
  const network = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [ride, setRide] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [calling, setCalling] = useState(false);
  const [addressPrompt, setAddressPrompt] = useState<null | {
    mode: "add_stop" | "change_destination" | "cancel_other";
    value: string;
  }>(null);
  const mountedRef = useRef(true);

  const { location: liveDriver } = useLiveDriverLocation(
    String(ride?.driver_id ?? "") || null,
  );

  const confirmingPaymentRef = useRef(false);

  const maybeConfirmPayment = useCallback(
    async (rideRow: Record<string, unknown> | null) => {
      if (!rideRow || confirmingPaymentRef.current) return rideRow;

      const paymentStatus = String(rideRow.payment_status ?? "").toLowerCase();
      const rideStatus = String(rideRow.status ?? "").toLowerCase();

      if (
        PAID_PAYMENT.has(paymentStatus) ||
        rideStatus === "paid" ||
        rideStatus === "dispatching" ||
        rideStatus === "accepted"
      ) {
        return rideRow;
      }

      const needsConfirm =
        PAYMENT_PENDING.has(paymentStatus) ||
        (paymentStatus === "unpaid" && rideStatus === "pending_payment");

      if (!needsConfirm) {
        return rideRow;
      }

      confirmingPaymentRef.current = true;
      setConfirmingPayment(true);

      try {
        await confirmTaxiPaid(rideId);
        const refreshed = await fetchTaxiRide(rideId);
        return (refreshed?.ride as Record<string, unknown>) ?? rideRow;
      } catch (e: unknown) {
        console.log("[TaxiRideTracking] confirm retry:", e);
        return rideRow;
      } finally {
        confirmingPaymentRef.current = false;
        setConfirmingPayment(false);
      }
    },
    [rideId],
  );

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      await withTimeout(
        (async () => {
          const result = await fetchTaxiRide(rideId);
          let nextRide = (result?.ride as Record<string, unknown>) ?? null;
          nextRide = await maybeConfirmPayment(nextRide);
          if (nextRide) {
            const stopsFromResult = Array.isArray(result?.stops)
              ? result.stops
              : Array.isArray(nextRide.stops)
                ? nextRide.stops
                : [];
            nextRide = { ...nextRide, stops: stopsFromResult };
          }
          if (mountedRef.current) {
            setRide(nextRide);
          }
        })(),
        BOOT_AUTH_TIMEOUT_MS,
        "taxi_ride_tracking_load",
      );
    } catch (e: unknown) {
      const message =
        e instanceof Error
          ? e.message
          : t("taxi.ride.loadFailed", "Unable to load ride");
      if (mountedRef.current) {
        setLoadError(message);
      }
      console.log("[TaxiRideTracking]", e);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [rideId, maybeConfirmPayment, t]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const timer = setInterval(() => void load(), 12000);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        void load();
      }
    });
    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    if (!rideId) return;

    const channel = subscribePostgresChannel(`taxi-ride-tracking:${rideId}`, [
      {
        event: "*",
        table: "taxi_rides",
        filter: `id=eq.${rideId}`,
        callback: () => {
          void load();
        },
      },
    ]);

    return () => {
      void unsubscribeSupabaseChannel(channel);
    };
  }, [rideId, load]);

  const status = String(ride?.status ?? "").toLowerCase();
  const paymentStatus = String(ride?.payment_status ?? "").toLowerCase();
  const canCancel = CANCELABLE.has(status);
  const awaitingPayment = isTaxiAwaitingPayment({
    status,
    paymentStatus,
  });

  const pickupCoord = useMemo(
    () => toCoordinatePoint(ride?.pickup_lat, ride?.pickup_lng),
    [ride?.pickup_lat, ride?.pickup_lng],
  );
  const dropoffCoord = useMemo(
    () => toCoordinatePoint(ride?.dropoff_lat, ride?.dropoff_lng),
    [ride?.dropoff_lat, ride?.dropoff_lng],
  );
  const driverCoord = useMemo(() => {
    if (!liveDriver) return null;
    return toCoordinatePoint(liveDriver.lat, liveDriver.lng);
  }, [liveDriver]);

  const smoothedDriver = useSmoothedDriverMarker(driverCoord);

  const stopPoints = useMemo(() => {
    const stops = ride?.stops;
    if (!Array.isArray(stops)) return [];
    return stops
      .map((stop, index) => {
        if (stop == null || typeof stop !== "object") return null;
        const row = stop as { lat?: number; lng?: number; stop_order?: number };
        const point = toCoordinatePoint(row.lat, row.lng);
        if (!point) return null;
        return {
          ...point,
          id: `stop-${row.stop_order ?? index}`,
          label: String(row.stop_order ?? index + 1),
        };
      })
      .filter(Boolean) as Array<{
      latitude: number;
      longitude: number;
      id: string;
      label: string;
    }>;
  }, [ride?.stops]);

  const etaEndpoints = useMemo(
    () =>
      resolveEtaEndpoints({
        status,
        pickup: pickupCoord,
        dropoff: dropoffCoord,
        driver: driverCoord,
      }),
    [status, pickupCoord, dropoffCoord, driverCoord],
  );

  const liveEta = useLiveTripEta({
    from: etaEndpoints.from,
    to: etaEndpoints.to,
    enabled: Boolean(etaEndpoints.from && etaEndpoints.to),
  });

  const prevNetworkRef = useRef(network.quality);
  useEffect(() => {
    const prev = prevNetworkRef.current;
    prevNetworkRef.current = network.quality;
    if (prev !== "online" && network.quality === "online") {
      void load();
      void liveEta.refresh();
    }
  }, [network.quality, load, liveEta.refresh]);

  const intermediateStops = useMemo(() => {
    const stops = ride?.stops;
    if (!Array.isArray(stops)) return [];
    return stops
      .map((stop, index) => {
        if (stop == null || typeof stop !== "object") return null;
        const row = stop as { address?: string; stop_order?: number };
        const address = String(row.address ?? "").trim();
        if (!address) return null;
        return {
          key: `${row.stop_order ?? index}`,
          address,
          order: Number(row.stop_order ?? index + 1),
        };
      })
      .filter(Boolean) as { key: string; address: string; order: number }[];
  }, [ride?.stops]);

  const durationMinutes = Number(ride?.duration_minutes);
  const distanceMiles = Number(ride?.distance_miles);
  const hasLiveDriver = Boolean(driverCoord);
  const identification = useMemo(
    () => readCustomerTrackingIdentification(ride),
    [ride],
  );
  const showDriverCard =
    Boolean(ride?.driver_id) && SHOW_DRIVER_ID_STATUSES.has(status);

  const navLocale = resolveNavigationLocale(i18n.language);
  const countryCode = String(
    ride?.country_code ?? ride?.country ?? "",
  ).trim();
  const currency = String(ride?.currency ?? "USD").toUpperCase();
  const units = resolveUnitSystem(
    countryCode || (currency === "USD" ? "US" : null),
    navLocale,
  );

  const etaMinutes =
    liveEta.eta?.etaMinutes ??
    (Number.isFinite(durationMinutes) ? durationMinutes : null);

  const distanceMeters =
    liveEta.eta?.distanceMeters ??
    (Number.isFinite(distanceMiles) ? distanceMiles * 1609.344 : null);

  const distanceLabel =
    distanceMeters != null && Number.isFinite(distanceMeters)
      ? formatTripDistance(distanceMeters, navLocale, units)
      : null;

  const etaLabel =
    etaMinutes != null && Number.isFinite(etaMinutes)
      ? t("taxi.tracking.etaMinutes", "{{n}} min ETA", {
          n: Math.max(1, Math.round(etaMinutes)),
        })
      : null;

  const trackingLabels = useMemo(
    () =>
      buildCustomerTrackingLabels({
        status,
        paymentStatus,
        hasDriver: Boolean(ride?.driver_id) && !awaitingPayment,
        hasLiveGps: hasLiveDriver && !awaitingPayment,
        etaMinutes: awaitingPayment ? null : etaMinutes,
        driverName: identification?.driverName ?? null,
        distanceLabel: awaitingPayment ? null : distanceLabel,
        t: (key, fallback, vars) => t(key, fallback, vars),
      }),
    [
      status,
      paymentStatus,
      awaitingPayment,
      ride?.driver_id,
      hasLiveDriver,
      etaMinutes,
      identification?.driverName,
      distanceLabel,
      t,
    ],
  );

  const mapHeight = resolveMapHeight(windowHeight, insets.top);

  async function handlePayNow() {
    if (startingCheckout || confirmingPayment) return;
    setStartingCheckout(true);
    try {
      const checkout = await startTaxiCheckout(rideId);
      if (checkout?.already_paid || checkout?.wallet_paid) {
        await load();
        return;
      }
      if (!checkout?.url) {
        throw new Error(
          checkout?.error ??
            t("taxi.quote.paymentFailed", "Unable to start payment"),
        );
      }
      await WebBrowser.openBrowserAsync(String(checkout.url));
      try {
        await confirmTaxiPaid(rideId);
      } catch {
        // Webhook may still settle; refresh either way.
      }
      await load();
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.quote.payment", "Payment"),
        e instanceof Error
          ? e.message
          : t("taxi.quote.paymentFailed", "Unable to start payment"),
      );
    } finally {
      setStartingCheckout(false);
    }
  }

  async function handleRetryPayment() {
    setConfirmingPayment(true);
    try {
      await confirmTaxiPaid(rideId);
      await load();
    } catch {
      await load();
    } finally {
      setConfirmingPayment(false);
    }
  }

  async function handleCallDriver() {
    if (!ride?.driver_id || calling) return;
    setCalling(true);
    try {
      await startMaskedCall({
        orderId: rideId,
        callerRole: "client",
        targetRole: "driver",
        sourceTable: "taxi_rides",
      });
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.ride.callTitle", "Call driver"),
        e instanceof Error
          ? e.message
          : t("taxi.ride.callFailed", "Unable to start a masked call right now."),
      );
    } finally {
      setCalling(false);
    }
  }

  async function handleShareRide() {
    const plate = identification?.vehiclePlate || "—";
    const label = identification?.vehicleLabel || "—";
    const name = identification?.driverName || "—";
    const eta =
      etaMinutes != null ? `${Math.round(etaMinutes)} min` : "—";
    try {
      await Share.share({
        message: t(
          "taxi.ride.shareMessage",
          "MMD Taxi — {{name}} · {{vehicle}} · Plate {{plate}} · ETA {{eta}}\nPickup: {{pickup}}\nDropoff: {{dropoff}}",
          {
            name,
            vehicle: label,
            plate,
            eta,
            pickup: String(ride?.pickup_address ?? "—"),
            dropoff: String(ride?.dropoff_address ?? "—"),
          },
        ),
      });
    } catch (e: unknown) {
      console.log("[TaxiRideTracking] share failed", e);
    }
  }

  async function handleCancel() {
    try {
      const preview = (await cancelTaxiRide(rideId, { preview: true })) as {
        fee?: { warning?: string | null; cancel_fee_cents?: number };
      };
      const warning =
        preview?.fee?.warning ||
        t("taxi.ride.cancelConfirm", "Cancel this taxi ride?");

      const pickReasonAndCancel = () => {
        Alert.alert(
          t("taxi.ride.cancelReasonTitle", "Why are you cancelling?"),
          t(
            "taxi.ride.cancelReasonBody",
            "Select a reason. This helps improve the service.",
          ),
          [
            ...CLIENT_CANCEL_REASONS.map((r) => ({
              text: r.label,
              onPress: () => {
                if (r.code === "other") {
                  setAddressPrompt({ mode: "cancel_other", value: "" });
                  return;
                }
                void (async () => {
                  setCancelling(true);
                  try {
                    await cancelTaxiRide(rideId, {
                      reason_code: r.code,
                    });
                    await load();
                  } catch (e: unknown) {
                    Alert.alert(
                      t("taxi.ride.cancelTitle", "Cancel ride"),
                      e instanceof Error
                        ? e.message
                        : t("taxi.ride.cancelFailed", "Unable to cancel"),
                    );
                  } finally {
                    setCancelling(false);
                  }
                })();
              },
            })),
            {
              text: t("taxi.ride.cancelNo", "No"),
              style: "cancel",
            },
          ],
        );
      };

      Alert.alert(t("taxi.ride.cancelTitle", "Cancel ride"), warning, [
        { text: t("taxi.ride.cancelNo", "No"), style: "cancel" },
        {
          text: t("taxi.ride.cancelYes", "Yes, cancel"),
          style: "destructive",
          onPress: pickReasonAndCancel,
        },
      ]);
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.ride.cancelTitle", "Cancel ride"),
        e instanceof Error
          ? e.message
          : t("taxi.ride.cancelFailed", "Unable to cancel"),
      );
    }
  }

  if (loading && !ride) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top, flex: 1 }]}>
        <StatusBar
          barStyle="light-content"
          translucent={Platform.OS === "android"}
          backgroundColor="transparent"
        />
        <View style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
          <ScreenHeader
            title={t("taxi.tracking.title", "Ride tracking")}
            fallbackRoute="TaxiHome"
            variant="mmd"
          />
        </View>
        <ActivityIndicator color={MMD_TAXI_GREEN} size="large" />
        <Text style={styles.loadingHint}>
          {t("taxi.tracking.loading", "Loading your ride…")}
        </Text>
        <Image
          source={MMD_LOGO}
          style={{ width: 48, height: 48, borderRadius: 14, marginTop: 24 }}
          resizeMode="contain"
          accessibilityLabel="MMD"
        />
      </View>
    );
  }

  if (!ride) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top, paddingHorizontal: 24 }]}>
        <StatusBar
          barStyle="light-content"
          translucent={Platform.OS === "android"}
          backgroundColor="transparent"
        />
        <View
          style={{
            width: "100%",
            maxWidth: 342,
            borderRadius: 28,
            padding: 24,
            backgroundColor: MMD_GLASS,
            borderWidth: 1,
            borderColor: MMD_GOLD_CLASSIC,
            alignItems: "center",
            gap: 16,
          }}
        >
          <Ionicons name="warning-outline" size={28} color={MMD_GOLD_CLASSIC} />
          <Text style={styles.errorTitle}>
            {t("taxi.ride.unavailableTitle", "Ride unavailable")}
          </Text>
          <Text style={styles.errorBody}>
            {loadError ||
              t(
                "taxi.ride.unavailableBody",
                "We could not load this ride. Check your connection and try again.",
              )}
          </Text>
          <TouchableOpacity
            onPress={() => {
              setLoading(true);
              void load();
            }}
            style={styles.retryBtn}
            accessibilityRole="button"
          >
            <Text style={styles.retryLabel}>
              {t("common.retry", "Retry")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              if (navigation.canGoBack()) navigation.goBack();
              else navigation.navigate("ClientHome");
            }}
            style={styles.backLink}
            accessibilityRole="button"
          >
            <Text style={styles.backLinkLabel}>
              {t("common.back", "Go back")}
            </Text>
          </TouchableOpacity>
        </View>
        <Image
          source={MMD_LOGO}
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            position: "absolute",
            bottom: Math.max(60, insets.bottom + 24),
          }}
          resizeMode="contain"
          accessibilityLabel="MMD"
        />
      </View>
    );
  }

  const mapBadge =
    network.quality === "offline"
      ? t("taxi.ride.offline", "Offline — tracking may be stale")
      : ride?.driver_id && !driverCoord
        ? t("taxi.ride.waitingDriverGps", "Waiting for driver GPS…")
        : null;

  const fareLabel = formatTaxiCents(ride?.total_cents, currency);

  const runAddStop = useCallback(
    async (address: string) => {
      const trimmed = String(address ?? "").trim();
      if (!trimmed) return;
      try {
        const preview = (await previewTaxiAddStop(rideId, {
          address: trimmed,
        })) as { change?: { price_delta_cents?: number } };
        const delta = Number(preview?.change?.price_delta_cents ?? 0);
        Alert.alert(
          t("taxi.ride.addStopConfirmTitle", "Confirm stop"),
          delta > 0
            ? t(
                "taxi.ride.addStopConfirmBodyUp",
                "Adding this stop increases the fare by {{amount}} cents (server quote). Confirm?",
                { amount: delta },
              )
            : t(
                "taxi.ride.addStopConfirmBody",
                "Confirm adding this stop? The route and price are recalculated on the server.",
              ),
          [
            { text: t("common.cancel", "Cancel"), style: "cancel" },
            {
              text: t("common.confirm", "Confirm"),
              onPress: () => {
                void previewTaxiAddStop(rideId, {
                  address: trimmed,
                  confirm: true,
                }).then(() => load());
              },
            },
          ],
        );
      } catch (e: unknown) {
        Alert.alert(
          t("taxi.ride.addStopTitle", "Add stop"),
          e instanceof Error ? e.message : "Unable to add stop",
        );
      }
    },
    [load, rideId, t],
  );

  const runChangeDest = useCallback(
    async (address: string) => {
      const trimmed = String(address ?? "").trim();
      if (!trimmed) return;
      try {
        const preview = (await previewTaxiDestinationChange(rideId, {
          dropoffAddress: trimmed,
        })) as {
          change?: { price_delta_cents?: number };
        };
        const delta = Number(preview?.change?.price_delta_cents ?? 0);
        Alert.alert(
          t("taxi.ride.changeDestConfirmTitle", "Confirm new destination"),
          delta > 0
            ? t(
                "taxi.ride.changeDestConfirmUp",
                "New fare is higher by {{amount}} cents. Additional payment may be required.",
                { amount: delta },
              )
            : t(
                "taxi.ride.changeDestConfirm",
                "Apply this destination? Server will recalculate distance and price.",
              ),
          [
            { text: t("common.cancel", "Cancel"), style: "cancel" },
            {
              text: t("common.confirm", "Confirm"),
              onPress: () => {
                void previewTaxiDestinationChange(rideId, {
                  dropoffAddress: trimmed,
                  confirm: true,
                }).then(() => load());
              },
            },
          ],
        );
      } catch (e: unknown) {
        Alert.alert(
          t("taxi.ride.changeDestTitle", "Change destination"),
          e instanceof Error ? e.message : "Unable to change destination",
        );
      }
    },
    [load, rideId, t],
  );

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle="light-content"
        translucent={Platform.OS === "android"}
        backgroundColor="transparent"
      />

      <View style={{ height: mapHeight }}>
        <LiveTripMap
          pickup={pickupCoord}
          dropoff={dropoffCoord}
          driver={
            smoothedDriver
              ? {
                  latitude: smoothedDriver.latitude,
                  longitude: smoothedDriver.longitude,
                }
              : driverCoord
          }
          driverHeadingDeg={smoothedDriver?.headingDeg ?? null}
          driverMoving={smoothedDriver?.moving ?? false}
          stops={stopPoints}
          routeGeometry={liveEta.eta?.geometry ?? null}
          height={mapHeight}
          showRezoom
          customerChrome
          hideInternalBadge
          stale={liveEta.stale || network.quality === "offline"}
          badgeText={mapBadge}
        />

        <TrackingTopBar
          liveTitle={trackingLabels.liveTitle}
          liveSubtitle={trackingLabels.liveSubtitle}
          etaLabel={etaLabel}
          backAccessibilityLabel={t("common.back", "Go back")}
          onBack={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate("ClientHome");
          }}
        />
      </View>

      <ScrollView
        style={styles.sheet}
        contentContainerStyle={{
          paddingHorizontal: 14,
          paddingTop: 14,
          paddingBottom: Math.max(18, insets.bottom + 10),
          gap: 12,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TrackingStatusBanner
          statusLine={trackingLabels.bannerStatus}
          etaLabel={etaLabel}
          safetyLine={trackingLabels.safetyLine}
        />

        {status === "driver_arrived" ? (
          <TouchableOpacity
            style={styles.joinDriverBanner}
            accessibilityRole="button"
            accessibilityLabel={t(
              "taxi.tracking.joinDriver",
              "Join your driver",
            )}
            onPress={() => {
              navigation.navigate("TaxiRideTracking", { rideId });
            }}
          >
            <Ionicons name="car-sport" size={20} color={MMD_TAXI_GREEN} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.joinDriverTitle}>
                {t("taxi.tracking.joinDriver", "Join your driver")}
              </Text>
              <Text style={styles.joinDriverBody}>
                {t(
                  "taxi.tracking.joinDriverBody",
                  "Your driver is waiting at the pickup point. Follow them on the map above.",
                )}
              </Text>
            </View>
            <Ionicons name="chevron-up" size={18} color={MMD_GOLD_CLASSIC} />
          </TouchableOpacity>
        ) : null}

        {status === "accepted" || status === "driver_arrived" ? (
          <VerificationCodeCard
            title={t(
              "taxi.ride.pickupCodeTitle",
              "Your Pickup Verification Code",
            )}
            code={
              (ride?.pickup_verification_code as string | null | undefined) ??
              null
            }
            subtitle={t(
              "taxi.ride.pickupCodeHint",
              "Show this code to your driver before entering the vehicle.",
            )}
            pendingLabel={t(
              "taxi.ride.pickupCodePending",
              "Your boarding code will appear here once the driver is assigned.",
            )}
          />
        ) : null}

        {fareLabel ? (
          <View style={styles.fareChip} accessibilityRole="text">
            <Ionicons name="pricetag-outline" size={14} color="#FBBF24" />
            <Text style={styles.fareLabel}>{fareLabel}</Text>
          </View>
        ) : null}

        {loadError ? (
          <View style={styles.inlineError}>
            <Ionicons name="warning-outline" size={16} color="#FCA5A5" />
            <Text style={styles.inlineErrorText}>{loadError}</Text>
          </View>
        ) : null}

        {ride?.preferences_client_message ? (
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={18} color="#93C5FD" />
            <Text style={styles.noticeText}>
              {String(ride.preferences_client_message)}
            </Text>
          </View>
        ) : null}

        {awaitingPayment ? (
          <View style={styles.paymentCard}>
            <Text style={styles.paymentTitle}>
              {t("taxi.ride.paymentPending", "Payment pending")}
            </Text>
            <Text style={styles.paymentBody}>
              {t(
                "taxi.ride.paymentRequiredBeforeDispatch",
                "No driver is assigned until payment succeeds. Complete payment to start driver search.",
              )}
            </Text>
            <TouchableOpacity
              onPress={() => void handlePayNow()}
              disabled={startingCheckout || confirmingPayment}
              style={styles.paymentBtn}
              accessibilityRole="button"
              accessibilityLabel={t("taxi.ride.payNow", "Pay now")}
            >
              <Text style={styles.paymentBtnLabel}>
                {startingCheckout
                  ? t("taxi.ride.openingCheckout", "Opening checkout…")
                  : t("taxi.ride.payNow", "Pay now")}
              </Text>
            </TouchableOpacity>
            {PAYMENT_PENDING.has(paymentStatus) ? (
              <TouchableOpacity
                onPress={() => void handleRetryPayment()}
                disabled={confirmingPayment || startingCheckout}
                style={[styles.paymentBtn, { marginTop: 8, backgroundColor: "#334155" }]}
                accessibilityRole="button"
              >
                <Text style={styles.paymentBtnLabel}>
                  {confirmingPayment
                    ? t("taxi.ride.confirming", "Confirming…")
                    : t("taxi.ride.retryPayment", "I already paid — confirm")}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <TripRouteCard
          pickupAddress={String(ride?.pickup_address ?? "")}
          dropoffAddress={String(ride?.dropoff_address ?? "")}
          stops={intermediateStops}
          distanceLabel={distanceLabel}
          etaLabel={etaLabel}
          pickupCaption={t("taxi.tracking.pickup", "PICKUP")}
          dropoffCaption={t("taxi.tracking.dropoff", "DROPOFF")}
          distanceCaption={t("taxi.tracking.distance", "Distance")}
          etaCaption={t("taxi.tracking.eta", "ETA")}
        />

        {["paid", "dispatching", "accepted", "driver_arrived", "in_progress"].includes(
          status,
        ) ? (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <TouchableOpacity
              style={[styles.paymentBtn, { flex: 1, backgroundColor: "#1E293B" }]}
              accessibilityRole="button"
              onPress={() => {
                if (typeof Alert.prompt === "function") {
                  Alert.prompt(
                    t("taxi.ride.addStopTitle", "Add stop"),
                    t(
                      "taxi.ride.addStopBody",
                      "Enter the stop address. Price will be recalculated on the server.",
                    ),
                    (address) => {
                      void runAddStop(String(address ?? ""));
                    },
                  );
                } else {
                  setAddressPrompt({ mode: "add_stop", value: "" });
                }
              }}
            >
              <Text style={styles.paymentBtnLabel}>
                {t("taxi.ride.addStop", "Add stop")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.paymentBtn, { flex: 1, backgroundColor: "#1E293B" }]}
              accessibilityRole="button"
              onPress={() => {
                if (typeof Alert.prompt === "function") {
                  Alert.prompt(
                    t("taxi.ride.changeDestTitle", "Change destination"),
                    t(
                      "taxi.ride.changeDestBody",
                      "Enter the new destination. Price is recalculated on the server.",
                    ),
                    (address) => {
                      void runChangeDest(String(address ?? ""));
                    },
                  );
                } else {
                  setAddressPrompt({ mode: "change_destination", value: "" });
                }
              }}
            >
              <Text style={styles.paymentBtnLabel}>
                {t("taxi.ride.changeDest", "Change destination")}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {showDriverCard && identification ? (
          <DriverProfileCard
            identification={identification}
            vehicleType={String(
              (ride as Record<string, unknown> | null)?.vehicle_type_snapshot ??
                (ride as Record<string, unknown> | null)?.vehicle_type ??
                "",
            )}
            newDriverLabel={t("taxi.tracking.newDriver", "New driver")}
            tripsLabel={(count) =>
              t("taxi.tracking.tripsCount", "{{count}} trips", { count })
            }
            yearLabel={(year) =>
              t("taxi.ride.vehicleYear", "Year {{year}}", { year })
            }
            plateCaption={t("taxi.tracking.plate", "PLATE")}
            vehicleFallback={t(
              "taxi.ride.vehicleFallback",
              "Vehicle assigned",
            )}
            photoUnavailableLabel={t(
              "taxi.tracking.vehiclePhotoUnavailable",
              "Vehicle photo unavailable",
            )}
            photoAccessibilityLabel={t(
              "taxi.tracking.driverPhotoA11y",
              "Driver profile photo",
            )}
            vehiclePhotoAccessibilityLabel={t(
              "taxi.tracking.vehiclePhotoA11y",
              "Vehicle photo",
            )}
            vehicleA11ySummary={t(
              "taxi.tracking.vehicleA11y",
              "Driver vehicle: {{label}}, year {{year}}, license plate {{plate}}.",
              {
                label:
                  identification.vehicleLabel ||
                  t("taxi.ride.vehicleFallback", "Vehicle assigned"),
                year: identification.vehicleYear ?? "—",
                plate: identification.vehiclePlate || "—",
              },
            )}
          />
        ) : null}

        {ride?.driver_id && ACTIVE_SAFETY_STATUSES.has(status) ? (
          <SafetyAudioCard rideId={rideId} rideActive />
        ) : null}

        {canCancel ? (
          <TouchableOpacity
            onPress={() => void handleCancel()}
            disabled={cancelling}
            style={styles.cancelBtn}
            accessibilityRole="button"
            accessibilityLabel={t("taxi.ride.cancel", "Cancel")}
          >
            <Text style={styles.cancelLabel}>
              {cancelling ? "…" : t("taxi.ride.cancel", "Cancel")}
            </Text>
          </TouchableOpacity>
        ) : null}

        <TrackingBottomActions
          showCall={showDriverCard}
          calling={calling}
          onCall={() => void handleCallDriver()}
          onChat={() => navigation.navigate("TaxiChat", { rideId })}
          showShare={showDriverCard}
          onShare={() => void handleShareRide()}
          callLabel={t("taxi.ride.call", "Call")}
          callingLabel={t("taxi.ride.calling", "Calling…")}
          chatLabel={t("taxi.ride.chat", "Chat")}
          shareLabel={t("taxi.ride.share", "Share Trip")}
          callHint={t("taxi.tracking.callHint", "Call Driver")}
          chatHint={t("taxi.tracking.chatHint", "Chat Driver")}
          shareHint={t("taxi.tracking.shareHint", "Share Trip details")}
        />

        {status === "completed" ? (
          <>
            <TouchableOpacity
              style={styles.tipBtn}
              onPress={() => navigation.navigate("TaxiReceipt", { rideId })}
              accessibilityRole="button"
              accessibilityLabel={t("taxi.receipt.title", "Receipt")}
            >
              <Text style={styles.tipLabel}>
                {t("taxi.receipt.view", "View receipt")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tipBtn}
              onPress={() => navigation.navigate("TaxiTip", { rideId })}
              accessibilityRole="button"
              accessibilityLabel={t("taxi.tip.title", "Tip your driver")}
            >
              <Text style={styles.tipLabel}>
                {Number(ride?.tip_cents ?? 0) > 0 || ride?.tip_paid_out
                  ? t("taxi.tip.view", "View tip")
                  : t("taxi.tip.cta", "Tip your driver")}
              </Text>
            </TouchableOpacity>
          </>
        ) : null}
      </ScrollView>

      <Modal
        transparent
        visible={addressPrompt != null}
        animationType="fade"
        onRequestClose={() => setAddressPrompt(null)}
      >
        <Pressable
          style={styles.addressModalBackdrop}
          onPress={() => setAddressPrompt(null)}
        >
          <View style={styles.addressModalCard}>
            <Text style={styles.addressModalTitle}>
              {addressPrompt?.mode === "change_destination"
                ? t("taxi.ride.changeDestTitle", "Change destination")
                : addressPrompt?.mode === "cancel_other"
                  ? t("taxi.ride.cancelOtherTitle", "Describe what happened")
                  : t("taxi.ride.addStopTitle", "Add stop")}
            </Text>
            <Text style={styles.addressModalBody}>
              {addressPrompt?.mode === "change_destination"
                ? t(
                    "taxi.ride.changeDestBody",
                    "Enter the new destination. Price is recalculated on the server.",
                  )
                : addressPrompt?.mode === "cancel_other"
                  ? t(
                      "taxi.ride.cancelOtherBody",
                      "Please explain why you are cancelling (required).",
                    )
                  : t(
                      "taxi.ride.addStopBody",
                      "Enter the stop address. Price will be recalculated on the server.",
                    )}
            </Text>
            <TextInput
              value={addressPrompt?.value ?? ""}
              onChangeText={(value) =>
                setAddressPrompt((prev) =>
                  prev ? { ...prev, value } : prev,
                )
              }
              placeholder={
                addressPrompt?.mode === "cancel_other"
                  ? t("taxi.ride.cancelOtherPlaceholder", "Write a short explanation")
                  : t("taxi.ride.addressPlaceholder", "Street address")
              }
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoFocus
              style={styles.addressModalInput}
              returnKeyType="done"
              onSubmitEditing={() => {
                const mode = addressPrompt?.mode;
                const value = String(addressPrompt?.value ?? "").trim();
                setAddressPrompt(null);
                if (mode === "change_destination") void runChangeDest(value);
                else if (mode === "add_stop") void runAddStop(value);
                else if (mode === "cancel_other") {
                  if (value.length < 3) {
                    Alert.alert(
                      t("taxi.ride.cancelOtherTitle", "Describe what happened"),
                      t(
                        "taxi.ride.cancelOtherTooShort",
                        "Please enter at least 3 characters.",
                      ),
                    );
                    return;
                  }
                  void (async () => {
                    setCancelling(true);
                    try {
                      await cancelTaxiRide(rideId, {
                        reason_code: "other",
                        reason_detail: value,
                      });
                      await load();
                    } catch (e: unknown) {
                      Alert.alert(
                        t("taxi.ride.cancelTitle", "Cancel ride"),
                        e instanceof Error
                          ? e.message
                          : t("taxi.ride.cancelFailed", "Unable to cancel"),
                      );
                    } finally {
                      setCancelling(false);
                    }
                  })();
                }
              }}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.paymentBtn, { flex: 1, backgroundColor: "#334155" }]}
                onPress={() => setAddressPrompt(null)}
              >
                <Text style={[styles.paymentBtnLabel, { color: MMD_WHITE }]}>
                  {t("common.cancel", "Cancel")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.paymentBtn, { flex: 1 }]}
                onPress={() => {
                  const mode = addressPrompt?.mode;
                  const value = String(addressPrompt?.value ?? "").trim();
                  setAddressPrompt(null);
                  if (mode === "change_destination") void runChangeDest(value);
                  else if (mode === "add_stop") void runAddStop(value);
                  else if (mode === "cancel_other") {
                    if (value.length < 3) {
                      Alert.alert(
                        t("taxi.ride.cancelOtherTitle", "Describe what happened"),
                        t(
                          "taxi.ride.cancelOtherTooShort",
                          "Please enter at least 3 characters.",
                        ),
                      );
                      return;
                    }
                    void (async () => {
                      setCancelling(true);
                      try {
                        await cancelTaxiRide(rideId, {
                          reason_code: "other",
                          reason_detail: value,
                        });
                        await load();
                      } catch (e: unknown) {
                        Alert.alert(
                          t("taxi.ride.cancelTitle", "Cancel ride"),
                          e instanceof Error
                            ? e.message
                            : t("taxi.ride.cancelFailed", "Unable to cancel"),
                        );
                      } finally {
                        setCancelling(false);
                      }
                    })();
                  }
                }}
              >
                <Text style={styles.paymentBtnLabel}>
                  {t("common.continue", "Continue")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: MMD_BLUE,
  },
  sheet: {
    flex: 1,
    backgroundColor: MMD_BLUE,
  },
  centered: {
    flex: 1,
    backgroundColor: MMD_BLUE,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingHint: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
    marginTop: 4,
  },
  errorTitle: {
    color: MMD_WHITE,
    fontSize: 28,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    textAlign: "center",
  },
  errorBody: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
    lineHeight: 20,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 8,
    backgroundColor: MMD_TAXI_GREEN,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 16,
    width: "100%",
    maxWidth: 294,
    alignItems: "center",
  },
  retryLabel: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 18,
  },
  backLink: {
    paddingVertical: 8,
  },
  backLinkLabel: {
    color: "rgba(255,255,255,0.6)",
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    fontSize: 16,
    textDecorationLine: "underline",
  },
  tipBtn: {
    marginTop: 14,
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  tipLabel: {
    color: MMD_WHITE,
    fontWeight: "900",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 15,
  },
  fareChip: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
  },
  fareLabel: {
    color: MMD_WHITE,
    fontSize: 28,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
  },
  joinDriverBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "rgba(22,163,74,0.14)",
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.45)",
  },
  joinDriverTitle: {
    color: MMD_WHITE,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
  },
  joinDriverBody: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
    textAlign: textAlignStart(),
  },
  inlineError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(127,29,29,0.35)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.35)",
  },
  inlineErrorText: {
    flex: 1,
    color: "#FECACA",
    fontSize: 13,
    fontWeight: "600",
    textAlign: textAlignStart(),
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(59,130,246,0.1)",
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.28)",
  },
  noticeText: {
    flex: 1,
    color: "#BFDBFE",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: textAlignStart(),
  },
  paymentCard: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
  },
  paymentTitle: {
    color: "#FDE68A",
    fontWeight: "800",
    fontSize: 14,
  },
  paymentBody: {
    color: "#CBD5E1",
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    textAlign: textAlignStart(),
  },
  paymentBtn: {
    marginTop: 12,
    backgroundColor: "#F59E0B",
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: "center",
  },
  paymentBtnLabel: {
    color: "#1F2937",
    fontWeight: "800",
  },
  cancelBtn: {
    backgroundColor: "#DC2626",
    borderWidth: 1,
    borderColor: "#CC0D0D",
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
  },
  cancelLabel: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.bold,
    fontSize: 16,
  },
  addressModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.72)",
    justifyContent: "center",
    padding: 20,
  },
  addressModalCard: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
  },
  addressModalTitle: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontSize: 16,
  },
  addressModalBody: {
    color: "#CBD5E1",
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
  },
  addressModalInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.45)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: MMD_WHITE,
    fontSize: 15,
  },
});
