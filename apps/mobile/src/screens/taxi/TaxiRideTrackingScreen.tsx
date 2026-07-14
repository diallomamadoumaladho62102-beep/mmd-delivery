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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { rowDirection, textAlignStart } from "../../i18n/rtl";
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
import { TaxiSafetyRecordingPanel } from "../../components/taxi/TaxiSafetyRecordingPanel";
import { useLiveDriverLocation } from "../../hooks/useLiveDriverLocation";
import { useLiveTripEta } from "../../hooks/useLiveTripEta";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { LiveTripMap } from "../../components/tracking/LiveTripMap";
import { LiveEtaBanner } from "../../components/tracking/LiveEtaBanner";
import { toCoordinatePoint } from "../../lib/coordinates";
import { resolveEtaEndpoints } from "../../lib/liveTripTracking";

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

export default function TaxiRideTrackingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<TrackingRoute>();
  const { t } = useTranslation();
  const rideId = route.params?.rideId;
  const network = useNetworkStatus();

  const [ride, setRide] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const mountedRef = useRef(true);

  const { location: liveDriver } = useLiveDriverLocation(
    String(ride?.driver_id ?? "") || null
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
    [rideId]
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
    [ride?.pickup_lat, ride?.pickup_lng]
  );
  const dropoffCoord = useMemo(
    () => toCoordinatePoint(ride?.dropoff_lat, ride?.dropoff_lng),
    [ride?.dropoff_lat, ride?.dropoff_lng]
  );
  const driverCoord = useMemo(() => {
    if (!liveDriver) return null;
    return toCoordinatePoint(liveDriver.lat, liveDriver.lng);
  }, [liveDriver]);

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
    [status, pickupCoord, dropoffCoord, driverCoord]
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
        return { key: `${row.stop_order ?? index}`, address, order: Number(row.stop_order ?? index + 1) };
      })
      .filter(Boolean) as { key: string; address: string; order: number }[];
  }, [ride?.stops]);

  const durationMinutes = Number(ride?.duration_minutes);
  const distanceMiles = Number(ride?.distance_miles);
  const hasLiveDriver = Boolean(driverCoord);

  async function handleRetryPayment() {
    await load();
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
                  : t("taxi.ride.cancelFailed", "Unable to cancel")
              );
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  }

  if (loading && !ride) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: "#0B1220",
          alignItems: "center",
          justifyContent: "center",
        }}
        edges={["bottom", "left", "right"]}
      >
        <ScreenHeader
          title={t("taxi.ride.defaultTitle", "Ride")}
          fallbackRoute="ClientHome"
          variant="dark"
        />
        <ActivityIndicator color="#F59E0B" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1 }}>
        <LiveTripMap
          pickup={pickupCoord}
          dropoff={dropoffCoord}
          driver={driverCoord}
          stops={stopPoints}
          routeGeometry={liveEta.eta?.geometry ?? null}
          fill
          showRezoom
          stale={liveEta.stale || network.quality === "offline"}
          badgeText={
            network.quality === "offline"
              ? t("taxi.ride.offline", "Offline — tracking may be stale")
              : ride?.driver_id && !driverCoord
                ? t("taxi.ride.waitingDriverGps", "Waiting for driver GPS…")
                : null
          }
        />

        <View style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 2 }}>
          <ScreenHeader
            title={formatStatus(status, t("taxi.ride.defaultTitle", "Ride"))}
            fallbackRoute="ClientHome"
            variant="dark"
          />
        </View>

        <ScrollView
          style={{
            maxHeight: 380,
            backgroundColor: "rgba(15,23,42,0.96)",
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 18,
          }}
        >
          <LiveEtaBanner
            distanceMiles={liveEta.eta?.distanceMiles ?? (Number.isFinite(distanceMiles) ? distanceMiles : null)}
            etaMinutes={liveEta.eta?.etaMinutes ?? (Number.isFinite(durationMinutes) ? durationMinutes : null)}
            nextStep={liveEta.eta?.nextStep}
            stale={liveEta.stale}
            offline={liveEta.offline || network.quality === "offline"}
            loading={liveEta.loading}
            updatedAt={
              liveEta.updatedAt ??
              (liveDriver?.updated_at
                ? new Date(liveDriver.updated_at).getTime()
                : null)
            }
            emptyMessage={t("taxi.ride.etaUnavailable", "Live ETA unavailable")}
          />

          <Text style={{ color: "#94A3B8", marginTop: 10 }}>
            {formatTaxiCents(ride?.total_cents, String(ride?.currency ?? "USD"))}
          </Text>

          {loadError ? (
            <Text style={{ color: "#FCA5A5", marginTop: 8 }}>{loadError}</Text>
          ) : null}

          {ride?.preferences_client_message ? (
            <View
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                backgroundColor: "rgba(59,130,246,0.12)",
                borderWidth: 1,
                borderColor: "rgba(59,130,246,0.35)",
              }}
            >
              <Text style={{ color: "#BFDBFE", lineHeight: 20 }}>
                {String(ride.preferences_client_message)}
              </Text>
            </View>
          ) : null}

          {awaitingPayment ? (
            <View
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                backgroundColor: "rgba(245,158,11,0.12)",
                borderWidth: 1,
                borderColor: "rgba(245,158,11,0.35)",
              }}
            >
              <Text style={{ color: "#FDE68A", fontWeight: "700" }}>
                {t("taxi.ride.paymentPending", "Payment pending")}
              </Text>
              <Text style={{ color: "#CBD5E1", marginTop: 4, fontSize: 13, textAlign: textAlignStart() }}>
                {t(
                  "taxi.ride.paymentPendingBody",
                  "If you already paid, we will confirm automatically. You can also retry now."
                )}
              </Text>
              <TouchableOpacity
                onPress={() => void handleRetryPayment()}
                disabled={confirmingPayment}
                style={{
                  marginTop: 10,
                  backgroundColor: "#F59E0B",
                  paddingVertical: 10,
                  borderRadius: 10,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#1F2937", fontWeight: "800" }}>
                  {confirmingPayment
                    ? t("taxi.ride.confirming", "Confirming…")
                    : t("taxi.ride.retryPayment", "Retry payment confirmation")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={{ color: "#CBD5E1", marginTop: 12, textAlign: textAlignStart() }}>
            {t("taxi.ride.pickupLabel", "Pickup: {{address}}", {
              address: String(ride?.pickup_address ?? "—"),
            })}
          </Text>
          {intermediateStops.length > 0 ? (
            <View style={{ marginTop: 8, gap: 4 }}>
              {intermediateStops.map((stop) => (
                <Text
                  key={stop.key}
                  style={{ color: "#94A3B8", textAlign: textAlignStart() }}
                >
                  {t("taxi.ride.stopLabel", "Stop {{n}}: {{address}}", {
                    n: stop.order,
                    address: stop.address,
                  })}
                </Text>
              ))}
            </View>
          ) : null}
          <Text style={{ color: "#CBD5E1", marginTop: 6, textAlign: textAlignStart() }}>
            {t("taxi.ride.dropoffLabel", "Dropoff: {{address}}", {
              address: String(ride?.dropoff_address ?? "—"),
            })}
          </Text>

          {ride?.driver_id ? (
            <View style={{ marginTop: 10 }}>
              <Text style={{ color: "#86EFAC", fontWeight: "700" }}>
                {hasLiveDriver
                  ? t("taxi.ride.driverEnRoute", "Driver en route")
                  : t("taxi.ride.driverAssigned", "Driver assigned")}
              </Text>
              {hasLiveDriver && liveDriver?.updated_at ? (
                <Text style={{ color: "#93C5FD", marginTop: 4, fontSize: 12 }}>
                  {t("taxi.ride.driverLastUpdate", "Driver last update: {{time}}", {
                    time: new Date(liveDriver.updated_at).toLocaleTimeString(),
                  })}
                </Text>
              ) : null}
              {!hasLiveDriver ? (
                <Text style={{ color: "#FBBF24", marginTop: 4, fontSize: 12 }}>
                  {t("taxi.ride.driverGpsUnavailable", "Driver GPS unavailable")}
                </Text>
              ) : null}
            </View>
          ) : status === "paid" || status === "dispatching" ? (
            <Text style={{ color: "#FDE68A", marginTop: 10 }}>
              {t("taxi.ride.lookingForDriver", "Looking for a driver…")}
            </Text>
          ) : null}

          {ride?.driver_id && ACTIVE_SAFETY_STATUSES.has(status) ? (
            <TaxiSafetyRecordingPanel
              rideId={rideId}
              role="client"
              rideActive
            />
          ) : null}

          <View style={{ flexDirection: rowDirection(), gap: 10, marginTop: 16 }}>
            <TouchableOpacity
              onPress={() => navigation.navigate("TaxiChat", { rideId })}
              style={actionBtn("#2563EB")}
            >
              <Text style={actionText}>{t("taxi.ride.chat", "Chat")}</Text>
            </TouchableOpacity>

            {canCancel ? (
              <TouchableOpacity
                onPress={handleCancel}
                disabled={cancelling}
                style={actionBtn("#7F1D1D")}
              >
                <Text style={actionText}>
                  {cancelling ? "…" : t("taxi.ride.cancel", "Cancel")}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function formatStatus(status: string, defaultTitle: string) {
  if (!status) return defaultTitle;
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function actionBtn(bg: string) {
  return {
    flex: 1,
    backgroundColor: bg,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center" as const,
  };
}

const actionText = { color: "#fff", fontWeight: "700" as const };
