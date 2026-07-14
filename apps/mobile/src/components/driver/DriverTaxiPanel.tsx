import React, { useCallback, useEffect, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { supabase } from "../../lib/supabase";
import { isDriverOnlineEligible } from "../../lib/accountStatus";
import {
  acceptTaxiOffer,
  arriveTaxiPickup,
  arriveTaxiStop,
  completeTaxiRide,
  completeTaxiStop,
  fetchActiveTaxiRide,
  fetchMyTaxiOffers,
  formatDriverPayout,
  loadTaxiDriverFeatures,
  rejectTaxiOffer,
  startTaxiRide,
  type TaxiDriverFeatures,
} from "../../lib/taxiDriverApi";
import { subscribeTaxiOfferPushRefresh } from "../../lib/taxiPushEvents";
import { DriverWaitTimerPanel } from "./DriverWaitTimerPanel";
import { TaxiSafetyRecordingPanel } from "../taxi/TaxiSafetyRecordingPanel";
import {
  filterActiveTaxiOffers,
  formatOfferCountdown,
} from "../../lib/taxiOfferExpiry";

type Nav = NativeStackNavigationProp<RootStackParamList>;

type TaxiOfferRow = {
  id: string;
  taxi_ride_id: string;
  expires_at: string;
  distance_miles?: number | null;
  is_favorite_dispatch?: boolean | null;
  wave?: number | null;
  client_preference_lines?: Array<{ emoji: string; label: string }>;
  taxi_rides?: {
    pickup_address?: string | null;
    dropoff_address?: string | null;
    driver_payout_cents?: number | null;
    currency?: string | null;
    vehicle_class?: string | null;
    is_scheduled?: boolean | null;
    scheduled_pickup_at?: string | null;
    stop_count?: number | null;
    is_shared_ride?: boolean | null;
    premium_driver_only?: boolean | null;
    business_trip_type?: string | null;
    client_preference_lines?: Array<{ emoji: string; label: string }>;
    shared_passengers?: {
      segment_order: number;
      pickup_address?: string | null;
      dropoff_address?: string | null;
      status?: string | null;
    }[] | null;
    taxi_ride_stops?: {
      stop_order: number;
      address?: string | null;
      status?: string | null;
    }[] | null;
  } | null;
};

type Props = {
  isOnline: boolean;
};

function formatOfferRemaining(expiresAt: string, nowMs: number): string {
  return formatOfferCountdown(expiresAt, nowMs);
}

export function DriverTaxiPanel({ isOnline }: Props) {
  const navigation = useNavigation<Nav>();
  const [features, setFeatures] = useState<TaxiDriverFeatures | null>(null);
  const [driverApproved, setDriverApproved] = useState(false);
  const [offers, setOffers] = useState<TaxiOfferRow[]>([]);
  const [activeRide, setActiveRide] = useState<Record<string, unknown> | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const taxiEnabled = features?.taxi_enabled === true;
  const showPanel = taxiEnabled && driverApproved;
  const activeOffers = filterActiveTaxiOffers(offers, nowMs);

  const refresh = useCallback(async () => {
    if (!showPanel || !isOnline) {
      setOffers([]);
      setActiveRide(null);
      return;
    }

    setLoading(true);
    try {
      const [offersRes, activeRes] = await Promise.all([
        fetchMyTaxiOffers(),
        fetchActiveTaxiRide(),
      ]);
      setOffers((offersRes?.offers as TaxiOfferRow[]) ?? []);
      setActiveRide((activeRes?.ride as Record<string, unknown>) ?? null);
    } catch (e) {
      console.log("[DriverTaxiPanel]", e);
    } finally {
      setLoading(false);
    }
  }, [isOnline, showPanel]);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId || !mounted) return;

      const { data: driverProfile } = await supabase
        .from("driver_profiles")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle();

      setDriverApproved(isDriverOnlineEligible(driverProfile?.status));
      setFeatures(await loadTaxiDriverFeatures(userId));
    }

    void loadProfile();
    return () => {
      mounted = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useEffect(() => {
    return subscribeTaxiOfferPushRefresh(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!showPanel) {
    return null;
  }

  async function handleAccept(offer: TaxiOfferRow) {
    setActionId(offer.id);
    try {
      const result = await acceptTaxiOffer(offer.id);
      if (result?.ok === false) {
        const reason = String(
          result?.error ?? result?.reason_code ?? "Offer no longer available"
        ).toLowerCase();
        const takenOrExpired =
          reason.includes("taken") ||
          reason.includes("expired") ||
          reason.includes("not_available") ||
          reason.includes("already_assigned") ||
          reason.includes("no_longer") ||
          reason.includes("offer_not");
        await refresh();
        Alert.alert(
          "Taxi",
          takenOrExpired
            ? toUserFacingError(
                result,
                "This offer was taken or expired. Offers refreshed."
              )
            : toUserFacingError(result, "Accept failed")
        );
        return;
      }
      await refresh();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const lower = message.toLowerCase();
      const takenOrExpired =
        lower.includes("taken") ||
        lower.includes("expired") ||
        lower.includes("not available") ||
        lower.includes("already") ||
        lower.includes("status changed");
      await refresh();
      Alert.alert(
        "Taxi",
        takenOrExpired
          ? toUserFacingError(e, "This offer was taken or expired. Offers refreshed.")
          : toUserFacingError(e, "Accept failed")
      );
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(offer: TaxiOfferRow) {
    setActionId(offer.id);
    try {
      await rejectTaxiOffer(offer.id);
      await refresh();
    } catch (e: unknown) {
      Alert.alert("Taxi", toUserFacingError(e, "Reject failed"));
    } finally {
      setActionId(null);
    }
  }

  async function lifecycle(action: "arrive" | "start" | "complete") {
    const rideId = String(activeRide?.id ?? "");
    if (!rideId) return;

    setActionId(rideId);
    try {
      if (action === "arrive") await arriveTaxiPickup(rideId);
      if (action === "start") await startTaxiRide(rideId);
      if (action === "complete") await completeTaxiRide(rideId);
      await refresh();
    } catch (e: unknown) {
      Alert.alert("Taxi", toUserFacingError(e, "Action failed"));
    } finally {
      setActionId(null);
    }
  }

  const status = String(activeRide?.status ?? "").toLowerCase();
  const rideId = String(activeRide?.id ?? "");

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>🚕 Taxi mode</Text>
          <Text style={styles.badge}>{features?.vehicle_class ?? "standard"}</Text>
          {features?.premium_eligible ? (
            <Text style={styles.badge}>⭐ Premium</Text>
          ) : null}
        </View>

        {loading ? <ActivityIndicator color="#F59E0B" style={{ marginVertical: 8 }} /> : null}

        {activeRide ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active taxi ride</Text>
            <Text style={styles.meta}>{formatStatus(status)}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {String(activeRide.pickup_address ?? "")}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              → {String(activeRide.dropoff_address ?? "")}
            </Text>
            {(activeRide.taxi_ride_stops as { stop_order: number; address?: string; status?: string }[] | undefined)
              ?.sort((a, b) => a.stop_order - b.stop_order)
              .map((stop) => (
                <View key={stop.stop_order} style={{ marginTop: 6 }}>
                  <Text style={styles.meta} numberOfLines={1}>
                    Stop {stop.stop_order}: {String(stop.address ?? "")} ({stop.status})
                  </Text>
                  {status === "in_progress" ? (
                    <View style={styles.row}>
                      <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={() =>
                          arriveTaxiStop(rideId, stop.stop_order)
                            .then(refresh)
                            .catch((e: unknown) =>
                              Alert.alert("Taxi", toUserFacingError(e, "Failed"))
                            )
                        }
                      >
                        <Text style={styles.secondaryText}>Arrive stop</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={() =>
                          completeTaxiStop(rideId, stop.stop_order)
                            .then(refresh)
                            .catch((e: unknown) =>
                              Alert.alert("Taxi", toUserFacingError(e, "Failed"))
                            )
                        }
                      >
                        <Text style={styles.secondaryText}>Complete stop</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              ))}
            <Text style={styles.payout}>
              {formatDriverPayout(
                activeRide.driver_payout_cents,
                String(activeRide.currency ?? "USD")
              )}
            </Text>
            {(activeRide.client_preference_lines as Array<{ emoji: string; label: string }> | undefined)
              ?.length ? (
              <View style={styles.prefsBox}>
                <Text style={styles.prefsTitle}>Client Preferences</Text>
                {(activeRide.client_preference_lines as Array<{ emoji: string; label: string }>).map(
                  (line) => (
                    <Text key={line.label} style={styles.prefLine}>
                      {line.emoji} {line.label}
                    </Text>
                  ),
                )}
              </View>
            ) : null}

            <TaxiSafetyRecordingPanel rideId={rideId} role="driver" rideActive />

            <View style={styles.row}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() =>
                  navigation.navigate("DriverMap", {
                    orderId: rideId,
                    sourceTable: "taxi_rides",
                    destinationStage:
                      status === "in_progress" ? "dropoff" : "pickup",
                  })
                }
              >
                <Text style={styles.secondaryText}>Navigate</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() =>
                  navigation.navigate("DriverTaxiChat", { rideId })
                }
              >
                <Text style={styles.secondaryText}>Chat</Text>
              </TouchableOpacity>
            </View>

            {status === "accepted" || status === "driver_arrived" ? (
              <DriverWaitTimerPanel
                entityType="taxi_ride"
                entityId={rideId}
                mode="taxi"
                onTaxiNoShowCanceled={() => void refresh()}
              />
            ) : null}

            {status === "driver_arrived" ? (
              <LifecycleBtn
                label="Start ride"
                loading={actionId === rideId}
                onPress={() => lifecycle("start")}
              />
            ) : null}
            {status === "in_progress" ? (
              <LifecycleBtn
                label="Complete ride"
                loading={actionId === rideId}
                onPress={() => lifecycle("complete")}
              />
            ) : null}
          </View>
        ) : null}

        {!activeRide && activeOffers.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Taxi offers</Text>
            {activeOffers.slice(0, 3).map((offer) => {
              const ride = offer.taxi_rides;
              const busy = actionId === offer.id;
              return (
                <View key={offer.id} style={styles.offerCard}>
                  {offer.is_favorite_dispatch || offer.wave === 0 ? (
                    <Text style={styles.favoriteBadge}>⭐ Favorite client ride</Text>
                  ) : null}
                  {ride?.is_scheduled ? (
                    <Text style={styles.favoriteBadge}>📅 Scheduled ride</Text>
                  ) : null}
                  {ride?.is_shared_ride ? (
                    <Text style={styles.favoriteBadge}>👥 Shared ride</Text>
                  ) : null}
                  {ride?.premium_driver_only ? (
                    <Text style={styles.favoriteBadge}>✨ Premium ride</Text>
                  ) : null}
                  {ride?.business_trip_type === "business" ? (
                    <Text style={styles.favoriteBadge}>🏢 Business ride</Text>
                  ) : null}
                  {(ride?.shared_passengers ?? [])
                    .sort((a, b) => a.segment_order - b.segment_order)
                    .map((passenger) => (
                      <Text key={passenger.segment_order} style={styles.meta} numberOfLines={1}>
                        P{passenger.segment_order}: {passenger.pickup_address} →{" "}
                        {passenger.dropoff_address}
                      </Text>
                    ))}
                  <Text style={styles.meta} numberOfLines={1}>
                    {ride?.pickup_address ?? "Pickup"}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    → {ride?.dropoff_address ?? "Dropoff"}
                  </Text>
                  {offer.expires_at ? (
                    <Text style={styles.expiry}>
                      {formatOfferRemaining(offer.expires_at, nowMs)}
                    </Text>
                  ) : null}
                  <Text style={styles.payout}>
                    {formatDriverPayout(
                      ride?.driver_payout_cents,
                      String(ride?.currency ?? "USD")
                    )}
                  </Text>
                  {(offer.client_preference_lines ?? ride?.client_preference_lines ?? []).length >
                  0 ? (
                    <View style={styles.prefsBox}>
                      <Text style={styles.prefsTitle}>Client Preferences</Text>
                      {(offer.client_preference_lines ?? ride?.client_preference_lines ?? []).map(
                        (line: { emoji: string; label: string }) => (
                          <Text key={line.label} style={styles.prefLine}>
                            {line.emoji} {line.label}
                          </Text>
                        ),
                      )}
                    </View>
                  ) : null}
                  <View style={styles.row}>
                    <TouchableOpacity
                      style={styles.rejectBtn}
                      disabled={busy}
                      onPress={() => handleReject(offer)}
                    >
                      <Text style={styles.rejectText}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.acceptBtn}
                      disabled={busy}
                      onPress={() => handleAccept(offer)}
                    >
                      <Text style={styles.acceptText}>
                        {busy ? "…" : "Accept"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {!activeRide && activeOffers.length === 0 && !loading ? (
          <Text style={styles.empty}>No taxi offers right now.</Text>
        ) : null}
      </View>
    </View>
  );
}

function LifecycleBtn({
  label,
  onPress,
  loading,
}: {
  label: string;
  onPress: () => void;
  loading: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.lifecycleBtn}
      onPress={onPress}
      disabled={loading}
    >
      <Text style={styles.lifecycleText}>{loading ? "…" : label}</Text>
    </TouchableOpacity>
  );
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 190,
    zIndex: 30,
  },
  card: {
    backgroundColor: "rgba(15,23,42,0.94)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    padding: 14,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { color: "#FDE68A", fontWeight: "800", fontSize: 16 },
  badge: {
    color: "#F59E0B",
    fontWeight: "700",
    textTransform: "uppercase",
    fontSize: 12,
  },
  section: { marginTop: 10, gap: 6 },
  sectionTitle: { color: "#E2E8F0", fontWeight: "800" },
  meta: { color: "#94A3B8", fontSize: 13 },
  expiry: { color: "#FDE68A", fontSize: 12, fontWeight: "700", marginTop: 2 },
  payout: { color: "#86EFAC", fontWeight: "800", marginTop: 2 },
  favoriteBadge: {
    color: "#FDE68A",
    fontWeight: "800",
    marginBottom: 4,
    fontSize: 12,
  },
  row: { flexDirection: "row", gap: 8, marginTop: 8 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: "#1E3A8A",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  secondaryText: { color: "#DBEAFE", fontWeight: "700" },
  lifecycleBtn: {
    marginTop: 8,
    backgroundColor: "#F59E0B",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  lifecycleText: { color: "#111827", fontWeight: "800" },
  offerCard: {
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(30,41,59,0.9)",
    borderWidth: 1,
    borderColor: "#334155",
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: "#16A34A",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  acceptText: { color: "#052e16", fontWeight: "800" },
  rejectBtn: {
    flex: 1,
    backgroundColor: "#334155",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  rejectText: { color: "#E2E8F0", fontWeight: "700" },
  empty: { color: "#64748B", marginTop: 8, fontSize: 13 },
  prefsBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(15,23,42,0.65)",
    borderWidth: 1,
    borderColor: "#475569",
    gap: 4,
  },
  prefsTitle: { color: "#E2E8F0", fontWeight: "800", marginBottom: 2 },
  prefLine: { color: "#CBD5E1", fontSize: 12 },
});
