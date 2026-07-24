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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { textAlignStart } from "../../i18n/rtl";
import {
  cancelTaxiRide,
  confirmTaxiPaid,
  fetchTaxiRide,
  formatTaxiCents,
} from "../../lib/taxiClientApi";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../../lib/supabaseRealtime";
import { useLiveDriverLocation } from "../../hooks/useLiveDriverLocation";
import { useLiveTripEta } from "../../hooks/useLiveTripEta";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { useSmoothedDriverMarker } from "../../hooks/useSmoothedDriverMarker";
import { LiveTripMap } from "../../components/tracking/LiveTripMap";
import { TrackingTopBar } from "../../components/tracking/TrackingTopBar";
import { TrackingStatusBanner } from "../../components/tracking/TrackingStatusBanner";
import { TripRouteCard } from "../../components/tracking/TripRouteCard";
import { DriverProfileCard } from "../../components/tracking/DriverProfileCard";
import { SafetyAudioCard } from "../../components/tracking/SafetyAudioCard";
import { TrackingBottomActions } from "../../components/tracking/TrackingBottomActions";
import { toCoordinatePoint } from "../../lib/coordinates";
import { resolveEtaEndpoints } from "../../lib/liveTripTracking";
import { startMaskedCall } from "../../lib/maskedCall";
import { readCustomerTrackingIdentification } from "../../lib/customerTrackingIdentification";
import { buildCustomerTrackingLabels } from "../../lib/customerTrackingStatus";
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
]);

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
  const [calling, setCalling] = useState(false);
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
  const canCancel = CANCELABLE.has(status) && !ride?.driver_id;
  const awaitingPayment =
    PAYMENT_PENDING.has(paymentStatus) ||
    (paymentStatus === "unpaid" && status === "pending_payment");

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
        hasDriver: Boolean(ride?.driver_id),
        hasLiveGps: hasLiveDriver,
        etaMinutes,
        driverName: identification?.driverName ?? null,
        distanceLabel,
        t: (key, fallback, vars) => t(key, fallback, vars),
      }),
    [
      status,
      ride?.driver_id,
      hasLiveDriver,
      etaMinutes,
      identification?.driverName,
      distanceLabel,
      t,
    ],
  );

  const mapHeight = resolveMapHeight(windowHeight, insets.top);

  async function handleRetryPayment() {
    await load();
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
    Alert.alert(
      t("taxi.ride.cancelTitle", "Cancel ride"),
      t("taxi.ride.cancelConfirm", "Cancel this taxi ride?"),
      [
        { text: t("taxi.ride.cancelNo", "No"), style: "cancel" },
        {
          text: t("taxi.ride.cancelYes", "Yes, cancel"),
          style: "destructive",
          onPress: async () => {
            setCancelling(true);
            try {
              await cancelTaxiRide(rideId);
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
          },
        },
      ],
    );
  }

  if (loading && !ride) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <StatusBar
          barStyle="light-content"
          translucent={Platform.OS === "android"}
          backgroundColor="transparent"
        />
        <ActivityIndicator color="#F59E0B" size="large" />
        <Text style={styles.loadingHint}>
          {t("taxi.tracking.loading", "Loading your ride…")}
        </Text>
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
        <Ionicons name="alert-circle-outline" size={40} color="#FCA5A5" />
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
    );
  }

  const mapBadge =
    network.quality === "offline"
      ? t("taxi.ride.offline", "Offline — tracking may be stale")
      : ride?.driver_id && !driverCoord
        ? t("taxi.ride.waitingDriverGps", "Waiting for driver GPS…")
        : null;

  const fareLabel = formatTaxiCents(ride?.total_cents, currency);

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
                "taxi.ride.paymentPendingBody",
                "If you already paid, we will confirm automatically. You can also retry now.",
              )}
            </Text>
            <TouchableOpacity
              onPress={() => void handleRetryPayment()}
              disabled={confirmingPayment}
              style={styles.paymentBtn}
            >
              <Text style={styles.paymentBtnLabel}>
                {confirmingPayment
                  ? t("taxi.ride.confirming", "Confirming…")
                  : t("taxi.ride.retryPayment", "Retry payment confirmation")}
              </Text>
            </TouchableOpacity>
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0B1220",
  },
  sheet: {
    flex: 1,
  },
  centered: {
    flex: 1,
    backgroundColor: "#0B1220",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingHint: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },
  errorTitle: {
    color: "#F8FAFC",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  errorBody: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 8,
    backgroundColor: "#F59E0B",
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 14,
  },
  retryLabel: {
    color: "#1F2937",
    fontWeight: "800",
    fontSize: 14,
  },
  backLink: {
    paddingVertical: 8,
  },
  backLinkLabel: {
    color: "#94A3B8",
    fontWeight: "700",
    fontSize: 13,
  },
  fareChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.28)",
  },
  fareLabel: {
    color: "#FDE68A",
    fontSize: 13,
    fontWeight: "800",
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
    backgroundColor: "#7F1D1D",
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
  },
  cancelLabel: {
    color: "#fff",
    fontWeight: "800",
  },
});
