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
import type { RootStackParamList } from "../../navigation/AppNavigator";
import {
  cancelTaxiRide,
  fetchTaxiRide,
  formatTaxiCents,
} from "../../lib/taxiClientApi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiRideTracking">;
type TrackingRoute = RouteProp<RootStackParamList, "TaxiRideTracking">;

const CANCELABLE = new Set([
  "draft",
  "quoted",
  "pending_payment",
  "paid",
  "dispatching",
]);

export default function TaxiRideTrackingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<TrackingRoute>();
  const rideId = route.params.rideId;

  const [ride, setRide] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchTaxiRide(rideId);
      setRide((result?.ride as Record<string, unknown>) ?? null);
    } catch (e: unknown) {
      console.log("[TaxiRideTracking]", e);
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [load]);

  const status = String(ride?.status ?? "").toLowerCase();
  const canCancel = CANCELABLE.has(status) && !ride?.driver_id;
  const pickupLat = Number(ride?.pickup_lat);
  const pickupLng = Number(ride?.pickup_lng);
  const dropoffLat = Number(ride?.dropoff_lat);
  const dropoffLng = Number(ride?.dropoff_lng);

  async function handleCancel() {
    Alert.alert("Cancel ride", "Cancel this taxi ride?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes, cancel",
        style: "destructive",
        onPress: async () => {
          setCancelling(true);
          try {
            await cancelTaxiRide(rideId);
            await load();
          } catch (e: unknown) {
            Alert.alert(
              "Cancel failed",
              e instanceof Error ? e.message : "Unable to cancel"
            );
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
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
            <Text style={{ color: "#94A3B8" }}>Map unavailable</Text>
          </View>
        )}

        <ScrollView
          style={{
            maxHeight: 320,
            backgroundColor: "rgba(15,23,42,0.96)",
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 18,
          }}
        >
          <Text style={{ color: "#F8FAFC", fontSize: 22, fontWeight: "800" }}>
            {formatStatus(status)}
          </Text>
          <Text style={{ color: "#94A3B8", marginTop: 4 }}>
            {formatTaxiCents(ride?.total_cents, String(ride?.currency ?? "USD"))}
          </Text>

          <Text style={{ color: "#CBD5E1", marginTop: 12 }}>
            Pickup: {String(ride?.pickup_address ?? "—")}
          </Text>
          <Text style={{ color: "#CBD5E1", marginTop: 6 }}>
            Dropoff: {String(ride?.dropoff_address ?? "—")}
          </Text>

          {ride?.driver_id ? (
            <Text style={{ color: "#86EFAC", marginTop: 10, fontWeight: "700" }}>
              Driver assigned
            </Text>
          ) : (
            <Text style={{ color: "#FDE68A", marginTop: 10 }}>
              Looking for a driver…
            </Text>
          )}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <TouchableOpacity
              onPress={() => navigation.navigate("TaxiChat", { rideId })}
              style={actionBtn("#2563EB")}
            >
              <Text style={actionText}>Chat</Text>
            </TouchableOpacity>

            {canCancel ? (
              <TouchableOpacity
                onPress={handleCancel}
                disabled={cancelling}
                style={actionBtn("#7F1D1D")}
              >
                <Text style={actionText}>
                  {cancelling ? "…" : "Cancel"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function formatStatus(status: string) {
  if (!status) return "Ride";
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
