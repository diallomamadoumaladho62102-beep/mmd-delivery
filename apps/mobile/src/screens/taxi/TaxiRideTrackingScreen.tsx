import React, { useCallback, useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import Mapbox from "@rnmapbox/maps";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { rowDirection, textAlignStart } from "../../i18n/rtl";
import {
  cancelTaxiRide,
  confirmTaxiPaid,
  fetchTaxiRide,
  formatTaxiCents,
} from "../../lib/taxiClientApi";
import { supabase } from "../../lib/supabase";

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

export default function TaxiRideTrackingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<TrackingRoute>();
  const { t } = useTranslation();
  const rideId = route.params.rideId;

  const [ride, setRide] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

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
    if (!rideId) return;

    const channel = supabase
      .channel(`taxi-ride-tracking:${rideId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "taxi_rides",
          filter: `id=eq.${rideId}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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
      >
        <ActivityIndicator color="#F59E0B" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1 }}>
        {Number.isFinite(pickupLat) && Number.isFinite(pickupLng) ? (
          <Mapbox.MapView
            style={{ flex: 1 }}
            styleURL="mapbox://styles/mapbox/streets-v12"
            logoEnabled={false}
            attributionEnabled={false}
          >
            <Mapbox.Camera
              zoomLevel={12}
              centerCoordinate={[
                pickupLng,
                (pickupLat + (Number.isFinite(dropoffLat) ? dropoffLat : pickupLat)) /
                  2,
              ]}
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
          </Mapbox.MapView>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#94A3B8" }}>
              {t("taxi.ride.mapUnavailable", "Map unavailable")}
            </Text>
          </View>
        )}

        <ScrollView
          style={{
            maxHeight: 360,
            backgroundColor: "rgba(15,23,42,0.96)",
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 18,
          }}
        >
          <Text style={{ color: "#F8FAFC", fontSize: 22, fontWeight: "800", textAlign: textAlignStart() }}>
            {formatStatus(status, t("taxi.ride.defaultTitle", "Ride"))}
          </Text>
          <Text style={{ color: "#94A3B8", marginTop: 4 }}>
            {formatTaxiCents(ride?.total_cents, String(ride?.currency ?? "USD"))}
          </Text>

          {loadError ? (
            <Text style={{ color: "#FCA5A5", marginTop: 8 }}>{loadError}</Text>
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
          <Text style={{ color: "#CBD5E1", marginTop: 6, textAlign: textAlignStart() }}>
            {t("taxi.ride.dropoffLabel", "Dropoff: {{address}}", {
              address: String(ride?.dropoff_address ?? "—"),
            })}
          </Text>

          {ride?.driver_id ? (
            <Text style={{ color: "#86EFAC", marginTop: 10, fontWeight: "700" }}>
              {t("taxi.ride.driverAssigned", "Driver assigned")}
            </Text>
          ) : status === "paid" || status === "dispatching" ? (
            <Text style={{ color: "#FDE68A", marginTop: 10 }}>
              {t("taxi.ride.lookingForDriver", "Looking for a driver…")}
            </Text>
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
