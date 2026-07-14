import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  ensureMapboxTokenApplied,
  getMapboxModule,
  getMapStyleStreets,
} from "../../lib/mapboxConfig";
import { useLiveDriverLocation } from "../../hooks/useLiveDriverLocation";

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

function isValidCoord(lat: unknown, lng: unknown) {
  const latN = Number(lat);
  const lngN = Number(lng);
  return Number.isFinite(latN) && Number.isFinite(lngN);
}

function getCameraForPoints(points: [number, number][]) {
  if (points.length === 0) {
    return { centerCoordinate: [-73.95, 40.65] as [number, number], zoomLevel: 11 };
  }
  if (points.length === 1) {
    return { centerCoordinate: points[0], zoomLevel: 14 };
  }
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const delta = Math.max(maxLat - minLat, maxLng - minLng, 0.01);
  return {
    centerCoordinate: [(minLng + maxLng) / 2, (minLat + maxLat) / 2] as [number, number],
    zoomLevel: Math.max(10, Math.min(15, Math.log2(360 / (delta * 3.2)))),
  };
}

export default function TaxiRideTrackingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<TrackingRoute>();
  const { t } = useTranslation();
  const rideId = route.params?.rideId;

  const [ride, setRide] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  const { location: liveDriver } = useLiveDriverLocation(
    String(ride?.driver_id ?? "") || null
  );

  const maybeConfirmPayment = useCallback(
    async (rideRow: Record<string, unknown> | null) => {
      if (!rideRow || confirmingPayment) return rideRow;

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

      setConfirmingPayment(true);

      try {
        await confirmTaxiPaid(rideId);
        const refreshed = await fetchTaxiRide(rideId);
        return (refreshed?.ride as Record<string, unknown>) ?? rideRow;
      } catch (e: unknown) {
        console.log("[TaxiRideTracking] confirm retry:", e);
        return rideRow;
      } finally {
        setConfirmingPayment(false);
      }
    },
    [rideId, confirmingPayment]
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
      setRide(nextRide);
    } catch (e: unknown) {
      const message =
        e instanceof Error
          ? e.message
          : t("taxi.ride.loadFailed", "Unable to load ride");
      setLoadError(message);
      console.log("[TaxiRideTracking]", e);
    } finally {
      setLoading(false);
    }
  }, [rideId, maybeConfirmPayment, t]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 12000);
    return () => clearInterval(timer);
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
  const pickupLat = Number(ride?.pickup_lat);
  const pickupLng = Number(ride?.pickup_lng);
  const dropoffLat = Number(ride?.dropoff_lat);
  const dropoffLng = Number(ride?.dropoff_lng);

  const driverLat = Number(liveDriver?.lat);
  const driverLng = Number(liveDriver?.lng);
  const hasLiveDriver = isValidCoord(driverLat, driverLng);

  const mapPoints = useMemo(() => {
    const points: [number, number][] = [];
    if (isValidCoord(pickupLng, pickupLat)) {
      points.push([pickupLng, pickupLat]);
    }
    if (isValidCoord(dropoffLng, dropoffLat)) {
      points.push([dropoffLng, dropoffLat]);
    }
    if (hasLiveDriver) {
      points.push([driverLng, driverLat]);
    }
    return points;
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng, hasLiveDriver, driverLat, driverLng]);

  const camera = useMemo(() => getCameraForPoints(mapPoints), [mapPoints]);

  const routeLineFeature = useMemo(() => {
    if (!isValidCoord(pickupLng, pickupLat) || !isValidCoord(dropoffLng, dropoffLat)) {
      return null;
    }
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [pickupLng, pickupLat],
          [dropoffLng, dropoffLat],
        ],
      },
    };
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng]);

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

  const Mapbox = getMapboxModule();
  const mapReady =
    Boolean(Mapbox) &&
    ensureMapboxTokenApplied() &&
    Number.isFinite(pickupLat) &&
    Number.isFinite(pickupLng);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1 }}>
        {mapReady && Mapbox ? (
          <Mapbox.MapView
            style={{ flex: 1 }}
            styleURL={getMapStyleStreets()}
            logoEnabled={false}
            attributionEnabled={false}
          >
            <Mapbox.Camera
              zoomLevel={camera.zoomLevel}
              centerCoordinate={camera.centerCoordinate}
              animationMode="flyTo"
              animationDuration={650}
            />
            <Mapbox.PointAnnotation
              id="pickup"
              coordinate={[pickupLng, pickupLat]}
            >
              <View style={pinStyle("#22C55E")}>
                <Text style={pinTextStyle}>P</Text>
              </View>
            </Mapbox.PointAnnotation>
            {Number.isFinite(dropoffLat) && Number.isFinite(dropoffLng) ? (
              <Mapbox.PointAnnotation
                id="dropoff"
                coordinate={[dropoffLng, dropoffLat]}
              >
                <View style={pinStyle("#EF4444")}>
                  <Text style={pinTextStyle}>D</Text>
                </View>
              </Mapbox.PointAnnotation>
            ) : null}
            {hasLiveDriver ? (
              <Mapbox.PointAnnotation
                id="live-driver"
                coordinate={[driverLng, driverLat]}
              >
                <View style={pinStyle("#38BDF8")}>
                  <Text style={pinTextStyle}>T</Text>
                </View>
              </Mapbox.PointAnnotation>
            ) : null}
            {routeLineFeature ? (
              <Mapbox.ShapeSource id="taxi-route-line" shape={routeLineFeature}>
                <Mapbox.LineLayer
                  id="taxi-route-line-layer"
                  style={{
                    lineColor: "#60A5FA",
                    lineWidth: 4,
                    lineOpacity: 0.85,
                  }}
                />
              </Mapbox.ShapeSource>
            ) : null}
          </Mapbox.MapView>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#94A3B8" }}>
              {t("taxi.ride.mapUnavailable", "Map unavailable")}
            </Text>
          </View>
        )}

        <View style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 2 }}>
          <ScreenHeader
            title={formatStatus(status, t("taxi.ride.defaultTitle", "Ride"))}
            fallbackRoute="ClientHome"
            variant="dark"
          />
        </View>

        <ScrollView
          style={{
            maxHeight: 360,
            backgroundColor: "rgba(15,23,42,0.96)",
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 18,
          }}
        >
          <Text style={{ color: "#94A3B8", marginTop: 4 }}>
            {formatTaxiCents(ride?.total_cents, String(ride?.currency ?? "USD"))}
          </Text>

          {Number.isFinite(durationMinutes) && durationMinutes > 0 ? (
            <Text style={{ color: "#CBD5E1", marginTop: 6, textAlign: textAlignStart() }}>
              {t("taxi.ride.durationMinutes", "Duration: {{minutes}} min", {
                minutes: Math.ceil(durationMinutes),
              })}
            </Text>
          ) : null}
          {Number.isFinite(distanceMiles) && distanceMiles > 0 ? (
            <Text style={{ color: "#CBD5E1", marginTop: 4, textAlign: textAlignStart() }}>
              {t("taxi.ride.distanceMiles", "Distance: {{miles}} mi", {
                miles: distanceMiles.toFixed(1),
              })}
            </Text>
          ) : null}

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
              {hasLiveDriver ? (
                <Text style={{ color: "#64748B", marginTop: 2, fontSize: 11 }}>
                  {driverLat.toFixed(5)}, {driverLng.toFixed(5)}
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

function pinStyle(color: string) {
  return {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: color,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
}

const pinTextStyle = { color: "#fff", fontWeight: "800" as const, fontSize: 12 };

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
