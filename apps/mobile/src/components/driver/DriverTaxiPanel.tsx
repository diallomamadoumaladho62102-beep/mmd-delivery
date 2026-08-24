import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Platform,
  Modal,
  TextInput,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveDriverTabBottomPadding } from "../../lib/driverScreenSafeArea";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { supabase } from "../../lib/supabase";
import { isDriverOnlineEligible } from "../../lib/accountStatus";
import {
  acceptTaxiOffer,
  arriveTaxiPickup,
  arriveTaxiStop,
  cancelTaxiRideByDriver,
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
import { getFreshPosition } from "../../lib/locationPermissionState";
import {
  filterActiveTaxiOffers,
  formatOfferCountdown,
} from "../../lib/taxiOfferExpiry";
import {
  startDriverMissionAlert,
  stopDriverMissionAlert,
} from "../../lib/driverMissionAlertService";
import { DriverTaxiActiveRideCard } from "./DriverTaxiActiveRideCard";
import { startMaskedCall } from "../../lib/maskedCall";
import { driverArrivedWaitTimer } from "../../lib/waitTimerApi";
import * as Location from "expo-location";

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
  /** When true, panel is the primary bottom offer surface (sheet is hidden). */
  elevated?: boolean;
  onActiveOffersChange?: (hasActiveOffers: boolean) => void;
  /** Sync Home Active jobs taxi card with panel ride state (clear on complete). */
  onActiveRideChange?: (ride: Record<string, unknown> | null) => void;
};

function formatOfferRemaining(expiresAt: string, nowMs: number): string {
  return formatOfferCountdown(expiresAt, nowMs);
}

const DRIVER_TAB_CLEARANCE = Platform.select({ android: 78, ios: 58, default: 68 }) ?? 64;
const DRIVER_NAV_SAFE_OFFSET = Platform.select({ android: 36, ios: 22, default: 28 }) ?? 28;
/** Clearance above the home bottom sheet peek when taxi offers float over the map. */
const TAXI_IDLE_SHEET_PEEK = 112;

export function DriverTaxiPanel({
  isOnline,
  elevated = false,
  onActiveOffersChange,
  onActiveRideChange,
}: Props) {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const idleBottomOffset =
    resolveDriverTabBottomPadding({
      tabClearance: DRIVER_TAB_CLEARANCE,
      navSafeOffset: DRIVER_NAV_SAFE_OFFSET,
      insetBottom: insets.bottom,
    }) + TAXI_IDLE_SHEET_PEEK;
  const [features, setFeatures] = useState<TaxiDriverFeatures | null>(null);
  const [driverApproved, setDriverApproved] = useState(false);
  const [offers, setOffers] = useState<TaxiOfferRow[]>([]);
  const [activeRide, setActiveRide] = useState<Record<string, unknown> | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [otherDetailPrompt, setOtherDetailPrompt] = useState<{
    rideId: string;
    value: string;
  } | null>(null);
  const actionLockRef = useRef(false);
  const ringingOfferIdsRef = useRef<Set<string>>(new Set());
  /** Avoid wiping Home SoT with initial null before first successful fetch. */
  const hydratedActiveRideRef = useRef(false);

  const taxiEnabled = features?.taxi_enabled === true;
  const showPanel = taxiEnabled && driverApproved;
  const activeOffers = filterActiveTaxiOffers(offers, nowMs);

  useEffect(() => {
    onActiveOffersChange?.(activeOffers.length > 0);
  }, [activeOffers.length, onActiveOffersChange]);

  useEffect(() => {
    if (!hydratedActiveRideRef.current) return;
    onActiveRideChange?.(activeRide);
  }, [activeRide, onActiveRideChange]);

  useEffect(() => {
    if (!showPanel || !isOnline) {
      ringingOfferIdsRef.current.clear();
      void stopDriverMissionAlert();
      return;
    }

    if (activeOffers.length === 0) {
      ringingOfferIdsRef.current.clear();
      void stopDriverMissionAlert();
      return;
    }

    for (const offer of activeOffers) {
      const rideId = String(offer.taxi_ride_id ?? "").trim();
      if (!rideId || ringingOfferIdsRef.current.has(offer.id)) continue;
      ringingOfferIdsRef.current.add(offer.id);
      void startDriverMissionAlert({
        type: "taxi_offer_dispatch",
        taxiRideId: rideId,
        playLocalNotification: true,
      });
    }

    const activeIds = new Set(activeOffers.map((o) => o.id));
    for (const id of Array.from(ringingOfferIdsRef.current)) {
      if (!activeIds.has(id)) ringingOfferIdsRef.current.delete(id);
    }
  }, [activeOffers, isOnline, showPanel]);

  const refresh = useCallback(async () => {
    // Offers require online + taxi panel; active ride must survive offline/kill.
    if (!showPanel) {
      setOffers([]);
      return;
    }
    if (!isOnline) {
      setOffers([]);
      return;
    }

    setLoading(true);
    try {
      const [offersRes, activeRes] = await Promise.all([
        fetchMyTaxiOffers(),
        fetchActiveTaxiRide(),
      ]);
      setOffers((offersRes?.offers as TaxiOfferRow[]) ?? []);
      const ride = (activeRes?.ride as Record<string, unknown>) ?? null;
      // Only clear when server explicitly returns no active ride.
      hydratedActiveRideRef.current = true;
      setActiveRide(ride);
    } catch (e) {
      // Network error: keep prior activeRide — Home SoT refresh is independent.
      console.log("[DriverTaxiPanel] refresh error (kept prior active ride):", e);
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
    if (actionLockRef.current) return;
    actionLockRef.current = true;
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
        await stopDriverMissionAlert();
        Alert.alert(
          t("driver.taxiPanel.title", "Taxi"),
          takenOrExpired
            ? toUserFacingError(
                result,
                t(
                  "driver.taxiPanel.offerTakenOrExpired",
                  "This offer was taken or expired. Offers refreshed.",
                ),
              )
            : toUserFacingError(
                result,
                t("driver.taxiPanel.acceptFailed", "Accept failed"),
              ),
        );
        return;
      }
      await refresh();
      await stopDriverMissionAlert();
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
        t("driver.taxiPanel.title", "Taxi"),
        takenOrExpired
          ? toUserFacingError(
              e,
              t(
                "driver.taxiPanel.offerTakenOrExpired",
                "This offer was taken or expired. Offers refreshed.",
              ),
            )
          : toUserFacingError(e, t("driver.taxiPanel.acceptFailed", "Accept failed")),
      );
    } finally {
      actionLockRef.current = false;
      setActionId(null);
    }
  }

  async function handleReject(offer: TaxiOfferRow) {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setActionId(offer.id);
    try {
      await rejectTaxiOffer(offer.id);
      await refresh();
      await stopDriverMissionAlert();
    } catch (e: unknown) {
      Alert.alert(
        t("driver.taxiPanel.title", "Taxi"),
        toUserFacingError(e, t("driver.taxiPanel.rejectFailed", "Reject failed")),
      );
    } finally {
      actionLockRef.current = false;
      setActionId(null);
    }
  }

  async function lifecycle(action: "arrive" | "complete") {
    const rideId = String(activeRide?.id ?? "");
    if (!rideId || actionLockRef.current) return;
    actionLockRef.current = true;

    setActionId(rideId);
    try {
      const pos = await getFreshPosition({ timeoutMs: 8000 });
      if (
        pos.state !== "fresh" &&
        pos.state !== "cached" &&
        pos.state !== "weak_accuracy"
      ) {
        throw new Error("GPS required to confirm arrival or completion.");
      }
      const coords = { lat: pos.latitude, lng: pos.longitude };
      if (action === "arrive") {
        await arriveTaxiPickup(rideId, coords);
        // Also start customer wait timer (OTP boarding is separate).
        try {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (token) {
            const loc = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            await driverArrivedWaitTimer(token, {
              entity_type: "taxi_ride",
              entity_id: rideId,
              driver_lat: loc.coords.latitude,
              driver_lng: loc.coords.longitude,
            });
          }
        } catch (waitErr) {
          console.log("[DriverTaxiPanel] wait timer arrive:", waitErr);
        }
      }
      if (action === "complete") await completeTaxiRide(rideId, coords);
      await refresh();
    } catch (e: unknown) {
      Alert.alert(
        t("driver.taxiPanel.title", "Taxi"),
        toUserFacingError(e, t("driver.taxiPanel.actionFailed", "Action failed")),
      );
    } finally {
      actionLockRef.current = false;
      setActionId(null);
    }
  }

  async function verifyPickupAndStart(pickupCode: string) {
    const rideId = String(activeRide?.id ?? "");
    if (!rideId || actionLockRef.current) {
      throw new Error("Please wait and try again.");
    }
    actionLockRef.current = true;
    setActionId(rideId);
    try {
      await startTaxiRide(rideId, pickupCode);
      await refresh();
    } catch (e: unknown) {
      // Surface inline error in the OTP modal (bank-style UX).
      throw e instanceof Error
        ? e
        : new Error(
            toUserFacingError(
              e,
              t("driver.taxiPanel.invalidPickupCode", "Invalid pickup code."),
            ),
          );
    } finally {
      actionLockRef.current = false;
      setActionId(null);
    }
  }

  async function callClient() {
    const rideId = String(activeRide?.id ?? "");
    if (!rideId) return;
    try {
      await startMaskedCall({
        orderId: rideId,
        callerRole: "driver",
        targetRole: "client",
        sourceTable: "taxi_rides",
      });
    } catch (e: unknown) {
      Alert.alert(
        t("driver.taxiPanel.callTitle", "Call"),
        toUserFacingError(
          e,
          t("driver.taxiPanel.maskedCallFailed", "Unable to start masked call"),
        ),
      );
    }
  }

  async function submitDriverCancel(
    rideId: string,
    reasonCode: string,
    reasonDetail?: string,
  ) {
    if (!rideId || actionLockRef.current) return;
    actionLockRef.current = true;
    setActionId(rideId);
    try {
      await cancelTaxiRideByDriver(rideId, {
        reason_code: reasonCode,
        reason_detail: reasonDetail,
      });
      await refresh();
    } catch (e: unknown) {
      Alert.alert(
        t("driver.taxiPanel.title", "Taxi"),
        toUserFacingError(
          e,
          t("driver.taxiPanel.cancelFailed", "Cancel failed"),
        ),
      );
    } finally {
      actionLockRef.current = false;
      setActionId(null);
    }
  }

  async function handleDriverCancel() {
    const rideId = String(activeRide?.id ?? "");
    if (!rideId || actionLockRef.current) return;

    const reasonCodes = [
      "vehicle_issue",
      "personal_emergency",
      "unsafe_pickup",
      "customer_unreachable",
      "traffic_or_route_blocked",
      "wrong_trip_details",
      "other",
    ] as const;

    Alert.alert(
      t("driver.taxiPanel.cancelTitle", "Release this ride?"),
      t(
        "driver.taxiPanel.cancelWarn",
        "Cancelling after accept may affect your acceptance activity. The ride will be offered to another nearby driver — the customer is not refunded.",
      ),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        ...reasonCodes.map((code) => ({
          text: t(`driver.taxiPanel.cancelReasons.${code}`),
          style: "destructive" as const,
          onPress: () => {
            if (code === "other") {
              setOtherDetailPrompt({ rideId, value: "" });
              return;
            }
            void submitDriverCancel(rideId, code);
          },
        })),
      ],
    );
  }

  const status = String(activeRide?.status ?? "").toLowerCase();
  const rideId = String(activeRide?.id ?? "");

  // Idle "Taxi mode / STANDARD" card removed from Driver Home.
  // Panel only surfaces when there is a live offer or active ride.
  if (!activeRide && activeOffers.length === 0) {
    return null;
  }

  if (activeRide) {
    return (
      <View
        pointerEvents="box-none"
        style={[styles.wrap, elevated ? styles.wrapElevated : null]}
      >
        {loading ? (
          <ActivityIndicator color="#F59E0B" style={{ marginVertical: 8 }} />
        ) : null}
        <DriverTaxiActiveRideCard
          rideId={rideId}
          status={status}
          pickupAddress={String(activeRide.pickup_address ?? "")}
          dropoffAddress={String(activeRide.dropoff_address ?? "")}
          payoutLabel={formatDriverPayout(
            activeRide.driver_payout_cents,
            String(activeRide.currency ?? "USD"),
          )}
          vehicleClass={
            String(
              activeRide.vehicle_class ?? features?.vehicle_class ?? "STANDARD",
            ) || "STANDARD"
          }
          paymentLabel={
            String(activeRide.payment_method ?? "").toLowerCase() === "cash"
              ? "Cash"
              : String(activeRide.payment_status ?? "").toLowerCase() === "paid"
                ? "Paid"
                : null
          }
          preferenceLines={
            (activeRide.client_preference_lines as Array<{
              emoji: string;
              label: string;
            }>) ?? []
          }
          stops={
            (activeRide.taxi_ride_stops as Array<{
              stop_order: number;
              address?: string;
              status?: string;
            }>) ?? []
          }
          clientName={
            (activeRide.client_display as { full_name?: string | null } | null)
              ?.full_name ?? null
          }
          clientAvatarUrl={
            (activeRide.client_display as { avatar_url?: string | null } | null)
              ?.avatar_url ?? null
          }
          actionId={actionId}
          onNavigate={(stage) =>
            navigation.navigate("DriverMap", {
              orderId: rideId,
              sourceTable: "taxi_rides",
              destinationStage: stage,
            })
          }
          onChat={() => navigation.navigate("DriverTaxiChat", { rideId })}
          onCall={() => void callClient()}
          onArrive={() => void lifecycle("arrive")}
          onVerifyPickupCode={async (code) => {
            await verifyPickupAndStart(code);
          }}
          onComplete={() => void lifecycle("complete")}
          onCancel={() => void handleDriverCancel()}
          onArriveStop={(stopOrder) =>
            void arriveTaxiStop(rideId, stopOrder)
              .then(refresh)
              .catch((e: unknown) =>
                Alert.alert(
                  t("driver.taxiPanel.title", "Taxi"),
                  toUserFacingError(e, t("driver.taxiPanel.genericFailed", "Failed")),
                ),
              )
          }
          onCompleteStop={(stopOrder) =>
            void completeTaxiStop(rideId, stopOrder)
              .then(refresh)
              .catch((e: unknown) =>
                Alert.alert(
                  t("driver.taxiPanel.title", "Taxi"),
                  toUserFacingError(e, t("driver.taxiPanel.genericFailed", "Failed")),
                ),
              )
          }
          onNoShowCanceled={() => void refresh()}
        />
        <Modal
          transparent
          visible={otherDetailPrompt != null}
          animationType="fade"
          onRequestClose={() => setOtherDetailPrompt(null)}
        >
          <Pressable
            style={styles.otherBackdrop}
            onPress={() => setOtherDetailPrompt(null)}
          >
            <View style={styles.otherCard}>
              <Text style={styles.otherTitle}>
                {t("driver.taxiPanel.cancelOtherTitle", "Describe what happened")}
              </Text>
              <TextInput
                value={otherDetailPrompt?.value ?? ""}
                onChangeText={(value) =>
                  setOtherDetailPrompt((prev) =>
                    prev ? { ...prev, value } : prev,
                  )
                }
                placeholder={t(
                  "driver.taxiPanel.cancelOtherPlaceholder",
                  "Write a short explanation",
                )}
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoFocus
                style={styles.otherInput}
              />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <TouchableOpacity
                  style={[styles.otherBtn, { backgroundColor: "#334155" }]}
                  onPress={() => setOtherDetailPrompt(null)}
                >
                  <Text style={styles.otherBtnLabel}>
                    {t("common.cancel", "Cancel")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.otherBtn, { backgroundColor: "#DC2626" }]}
                  onPress={() => {
                    const ride = String(otherDetailPrompt?.rideId ?? "");
                    const detail = String(otherDetailPrompt?.value ?? "").trim();
                    setOtherDetailPrompt(null);
                    if (detail.length < 3) {
                      Alert.alert(
                        t(
                          "driver.taxiPanel.cancelOtherTitle",
                          "Describe what happened",
                        ),
                        t(
                          "driver.taxiPanel.cancelOtherTooShort",
                          "Please enter at least 3 characters.",
                        ),
                      );
                      return;
                    }
                    void submitDriverCancel(ride, "other", detail);
                  }}
                >
                  <Text style={styles.otherBtnLabel}>
                    {t("common.confirm", "Confirm")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </Modal>
      </View>
    );
  }

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        elevated ? styles.wrapElevated : { bottom: idleBottomOffset },
      ]}
    >
      <View style={[styles.card, elevated ? styles.cardElevated : null]}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Incoming taxi offer</Text>
          {features?.vehicle_class ? (
            <Text style={styles.badge}>{features.vehicle_class}</Text>
          ) : null}
          {features?.premium_eligible ? (
            <Text style={styles.badge}>Premium</Text>
          ) : null}
        </View>

        {loading ? <ActivityIndicator color="#F59E0B" style={{ marginVertical: 8 }} /> : null}

        {activeOffers.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Taxi offers</Text>
            {activeOffers.slice(0, 3).map((offer) => {
              const ride = offer.taxi_rides;
              const busy = actionId != null;
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
                  <Text style={styles.meta} numberOfLines={elevated ? 3 : 2}>
                    {ride?.pickup_address ?? "Pickup"}
                  </Text>
                  <Text style={styles.meta} numberOfLines={elevated ? 3 : 2}>
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

        {activeOffers.length === 0 && !loading ? (
          <Text style={styles.empty}>No taxi offers right now.</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 30,
  },
  wrapElevated: {
    position: "relative",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 80,
  },
  card: {
    backgroundColor: "rgba(15,23,42,0.94)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    padding: 14,
  },
  cardElevated: {
    backgroundColor: "rgba(2,6,23,0.97)",
    borderRadius: 24,
    borderColor: "rgba(245,158,11,0.45)",
    padding: 16,
    maxHeight: undefined,
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
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  acceptText: { color: "#052e16", fontWeight: "800", fontSize: 16 },
  rejectBtn: {
    flex: 1,
    backgroundColor: "#334155",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  rejectText: { color: "#E2E8F0", fontWeight: "700", fontSize: 15 },
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
  otherBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.72)",
    justifyContent: "center",
    padding: 20,
  },
  otherCard: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
  },
  otherTitle: { color: "#F8FAFC", fontWeight: "800", fontSize: 16 },
  otherInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.45)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#F8FAFC",
    fontSize: 15,
  },
  otherBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  otherBtnLabel: { color: "#F8FAFC", fontWeight: "800" },
});
