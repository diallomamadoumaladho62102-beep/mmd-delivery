import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { DriverWaitTimerPanel } from "./DriverWaitTimerPanel";
import { TaxiSafetyRecordingPanel } from "../taxi/TaxiSafetyRecordingPanel";
import { SafetyAudioCard } from "../tracking/SafetyAudioCard";
import { OtpDigitInput } from "../shared/OtpDigitInput";
import { formatDriverPayout } from "../../lib/taxiDriverApi";
import { clientDisplayInitials } from "../../lib/driverTaxiClientDisplay";

type Props = {
  rideId: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  payoutLabel: string;
  vehicleClass?: string | null;
  paymentLabel?: string | null;
  preferenceLines?: Array<{ emoji: string; label: string }>;
  stops?: Array<{ stop_order: number; address?: string; status?: string }>;
  /** Client identification for the assigned ride (from /api/taxi/rides/active). */
  clientName?: string | null;
  clientAvatarUrl?: string | null;
  actionId: string | null;
  onNavigate: (stage: "pickup" | "dropoff") => void;
  onChat: () => void;
  onCall: () => void;
  onArrive: () => void;
  onVerifyPickupCode: (code: string) => Promise<void>;
  onComplete: () => void;
  onCancel: () => void;
  onArriveStop: (stopOrder: number) => void;
  onCompleteStop: (stopOrder: number) => void;
  onNoShowCanceled: () => void;
};

function formatStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function DriverTaxiActiveRideCard({
  rideId,
  status,
  pickupAddress,
  dropoffAddress,
  payoutLabel,
  vehicleClass,
  paymentLabel,
  preferenceLines,
  stops,
  clientName,
  clientAvatarUrl,
  actionId,
  onNavigate,
  onChat,
  onCall,
  onArrive,
  onVerifyPickupCode,
  onComplete,
  onCancel,
  onArriveStop,
  onCompleteStop,
  onNoShowCanceled,
}: Props) {
  const { t } = useTranslation();
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeSuccess, setCodeSuccess] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const busy = actionId === rideId || verifying;
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = Boolean(clientAvatarUrl) && !avatarFailed;

  React.useEffect(() => {
    setAvatarFailed(false);
  }, [clientAvatarUrl]);

  const pressIn = () =>
    Animated.spring(scale, {
      toValue: 0.985,
      useNativeDriver: true,
      friction: 7,
    }).start();
  const pressOut = () =>
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 6,
    }).start();

  const openCodeModal = () => {
    setCode("");
    setCodeError(null);
    setCodeSuccess(false);
    setCodeOpen(true);
  };

  const closeCodeModal = () => {
    if (verifying) return;
    setCodeOpen(false);
    setCode("");
    setCodeError(null);
    setCodeSuccess(false);
  };

  const submitCode = useCallback(
    async (raw: string) => {
      const digits = raw.replace(/\D/g, "").slice(0, 4);
      if (digits.length !== 4 || verifying || codeSuccess) return;
      setVerifying(true);
      setCodeError(null);
      try {
        await onVerifyPickupCode(digits);
        setCodeSuccess(true);
        setTimeout(() => {
          setCodeOpen(false);
          setCode("");
          setCodeSuccess(false);
          setCodeError(null);
        }, 700);
      } catch (e: any) {
        const msg = String(e?.message || "").toLowerCase();
        if (msg.includes("invalid") || msg.includes("code")) {
          setCodeError(
            t(
              "taxi.driver.activeRide.incorrectCode",
              "Incorrect code. Ask the client and try again.",
            ),
          );
        } else {
          setCodeError(
            e?.message ||
              t(
                "taxi.driver.activeRide.verifyFailed",
                "Could not verify the code. Please try again.",
              ),
          );
        }
        setCode("");
      } finally {
        setVerifying(false);
      }
    },
    [onVerifyPickupCode, verifying, codeSuccess],
  );

  return (
    <View style={styles.card}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled
      >
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={styles.carBadge}>
              <Ionicons name="car" size={18} color="#111827" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {t("taxi.driver.activeRide.title", "Active taxi ride")}
              </Text>
              <View style={styles.badgeRow}>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>{formatStatus(status)}</Text>
                </View>
                {paymentLabel ? (
                  <Text style={styles.cashText}>• {paymentLabel}</Text>
                ) : null}
              </View>
            </View>
          </View>
          <View style={styles.classPill}>
            <Ionicons name="star" size={11} color="#F5C542" />
            <Text style={styles.classText}>
              {String(vehicleClass ?? "STANDARD").toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={styles.clientRow}>
          <View style={styles.clientAvatarWrap}>
            {showAvatar ? (
              <Image
                source={{ uri: String(clientAvatarUrl) }}
                style={styles.clientAvatar}
                accessibilityLabel={t(
                  "taxi.driver.activeRide.clientPhoto",
                  "Client photo",
                )}
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <View style={styles.clientAvatarFallback}>
                <Text style={styles.clientAvatarInitials}>
                  {clientDisplayInitials(clientName)}
                </Text>
              </View>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.clientLabel}>
              {t("taxi.driver.activeRide.client", "Client")}
            </Text>
            <Text style={styles.clientName} numberOfLines={1}>
              {String(clientName ?? "").trim() ||
                t("taxi.driver.activeRide.clientFallback", "Client")}
            </Text>
          </View>
        </View>

        <Text style={styles.price}>{payoutLabel}</Text>
        <View style={styles.fareMeta}>
          <Ionicons name="cash-outline" size={13} color="#94A3B8" />
          <Text style={styles.fareMetaText}>
            {t("taxi.driver.activeRide.estimatedFare", "Estimated fare")}
          </Text>
        </View>

        <View style={styles.routeCard}>
          <View style={styles.routeRow}>
            <View style={styles.routeLeft}>
              <View style={[styles.dot, styles.dotPickup]} />
              <View style={styles.routeLine} />
              <View style={[styles.dot, styles.dotDrop]} />
            </View>
            <View style={styles.routeBody}>
              <View style={styles.addrRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addrLabel}>
                    {t("taxi.driver.activeRide.pickup", "Pickup")}
                  </Text>
                  <Text style={styles.addrText} numberOfLines={2}>
                    {pickupAddress || "—"}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.roundBtn, styles.roundPickup]}
                  onPress={() => onNavigate("pickup")}
                >
                  <Ionicons name="navigate" size={16} color="#86EFAC" />
                </TouchableOpacity>
              </View>
              <View style={[styles.addrRow, { marginTop: 14 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addrLabel}>
                    {t("taxi.driver.activeRide.dropoff", "Drop-off")}
                  </Text>
                  <Text style={styles.addrText} numberOfLines={2}>
                    {dropoffAddress || "—"}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.roundBtn, styles.roundDrop]}
                  onPress={() => onNavigate("dropoff")}
                >
                  <Ionicons name="location" size={16} color="#FCA5A5" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <ActionTile
            icon="navigate"
            color="#22C55E"
            label={t("taxi.driver.activeRide.navigate", "Navigate")}
            onPress={() =>
              onNavigate(status === "in_progress" ? "dropoff" : "pickup")
            }
          />
          <ActionTile
            icon="chatbubble"
            color="#3B82F6"
            label={t("taxi.driver.activeRide.chat", "Chat")}
            onPress={onChat}
          />
          <ActionTile
            icon="call"
            color="#A855F7"
            label={t("taxi.driver.activeRide.call", "Call")}
            onPress={onCall}
          />
        </View>

        <SafetyAudioCard rideId={rideId} rideActive role="driver" />

        <TaxiSafetyRecordingPanel
          rideId={rideId}
          role="driver"
          rideActive
          premium
        />

        {status === "accepted" || status === "driver_arrived" ? (
          <View style={styles.waitWrap}>
            <DriverWaitTimerPanel
              entityType="taxi_ride"
              entityId={rideId}
              mode="taxi"
              variant="premium"
              onTaxiNoShowCanceled={onNoShowCanceled}
            />
          </View>
        ) : null}

        {(preferenceLines?.length ?? 0) > 0 ? (
          <View style={styles.prefsBox}>
            <Text style={styles.prefsTitle}>Client Preferences</Text>
            {preferenceLines!.map((line) => (
              <Text key={line.label} style={styles.prefLine}>
                {line.emoji} {line.label}
              </Text>
            ))}
          </View>
        ) : null}

        {status === "in_progress"
          ? stops
              ?.slice()
              .sort((a, b) => a.stop_order - b.stop_order)
              .map((stop) => (
                <View key={stop.stop_order} style={styles.stopRow}>
                  <Text style={styles.stopText} numberOfLines={1}>
                    Stop {stop.stop_order}: {stop.address ?? ""} ({stop.status})
                  </Text>
                  <View style={styles.row}>
                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={() => onArriveStop(stop.stop_order)}
                    >
                      <Text style={styles.secondaryText}>Arrive stop</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={() => onCompleteStop(stop.stop_order)}
                    >
                      <Text style={styles.secondaryText}>Complete stop</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
          : null}

        {status === "accepted" ? (
          <Animated.View style={{ transform: [{ scale }], marginTop: 12 }}>
            <Pressable
              onPressIn={pressIn}
              onPressOut={pressOut}
              onPress={onArrive}
              disabled={busy}
              style={styles.primaryBtn}
            >
              {busy ? (
                <ActivityIndicator color="#111827" />
              ) : (
                <>
                  <View style={styles.primaryIcon}>
                    <Ionicons name="checkmark" size={16} color="#111827" />
                  </View>
                  <Text style={styles.primaryText}>
                    {t("taxi.driver.activeRide.arrivedPickup", "Arrived at pickup")}
                  </Text>
                </>
              )}
            </Pressable>
          </Animated.View>
        ) : null}

        {status === "driver_arrived" ? (
          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 12 }]}
            disabled={busy}
            onPress={openCodeModal}
          >
            <View style={styles.primaryIcon}>
              <Ionicons name="keypad" size={15} color="#111827" />
            </View>
            <Text style={styles.primaryText}>
              {t("taxi.driver.activeRide.verifyPickupCode", "Verify Pickup Code")}
            </Text>
          </TouchableOpacity>
        ) : null}

        {status === "in_progress" ? (
          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 12 }]}
            disabled={busy}
            onPress={onComplete}
          >
            <Text style={styles.primaryText}>
              {busy
                ? "…"
                : t("taxi.driver.activeRide.completeRide", "Complete ride")}
            </Text>
          </TouchableOpacity>
        ) : null}

        {status === "accepted" || status === "driver_arrived" ? (
          <TouchableOpacity
            style={styles.cancelBtn}
            disabled={busy}
            onPress={() => {
              // Parent shows reason picker + activity impact + reassignment.
              onCancel();
            }}
          >
            <View style={styles.cancelIcon}>
              <Ionicons name="close" size={14} color="#F87171" />
            </View>
            <Text style={styles.cancelText}>
              {busy
                ? "…"
                : t("taxi.driver.activeRide.cancelTitle", "Cancel ride")}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      <Modal
        transparent
        visible={codeOpen}
        animationType="fade"
        onRequestClose={closeCodeModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Verify Pickup Code</Text>
            <Text style={styles.modalHint}>
              Ask the client for their 4-digit boarding code. The keyboard opens
              automatically — no photo is required.
            </Text>
            <View style={{ marginTop: 18 }}>
              <OtpDigitInput
                length={4}
                value={code}
                onChange={(v) => {
                  setCode(v);
                  if (codeError) setCodeError(null);
                }}
                onComplete={(digits) => void submitCode(digits)}
                autoFocus
                disabled={verifying}
                error={codeError}
                success={codeSuccess}
                mode="numeric"
              />
            </View>
            {verifying ? (
              <View style={styles.verifyingRow}>
                <ActivityIndicator color="#F5C542" />
                <Text style={styles.verifyingText}>Verifying…</Text>
              </View>
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={closeCodeModal}
                disabled={verifying || codeSuccess}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ActionTile({
  icon,
  color,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.actionTile} onPress={onPress}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export function formatActiveRidePayout(
  cents: unknown,
  currency: string,
): string {
  return formatDriverPayout(cents, currency);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(2,6,23,0.97)",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    padding: 14,
    maxHeight: 560,
  },
  scrollContent: { paddingBottom: 4 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  carBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F5C542",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: "#F8FAFC", fontWeight: "800", fontSize: 17 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  statusPill: {
    backgroundColor: "rgba(34,197,94,0.2)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusPillText: { color: "#86EFAC", fontWeight: "800", fontSize: 11 },
  cashText: { color: "#94A3B8", fontSize: 12, fontWeight: "600" },
  classPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(245,197,66,0.45)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  classText: { color: "#FDE68A", fontWeight: "800", fontSize: 10 },
  clientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(15,23,42,0.75)",
    borderWidth: 1,
    borderColor: "rgba(51,65,85,0.9)",
  },
  clientAvatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: "hidden",
  },
  clientAvatar: { width: 56, height: 56, borderRadius: 28 },
  clientAvatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(34,197,94,0.2)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  clientAvatarInitials: {
    color: "#86EFAC",
    fontSize: 18,
    fontWeight: "900",
  },
  clientLabel: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  clientName: {
    color: "#F8FAFC",
    fontSize: 17,
    fontWeight: "800",
    marginTop: 2,
  },
  price: {
    color: "#4ADE80",
    fontSize: 40,
    fontWeight: "900",
    marginTop: 14,
    letterSpacing: 0.2,
  },
  fareMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
    marginBottom: 12,
  },
  fareMetaText: { color: "#94A3B8", fontSize: 12, fontWeight: "600" },
  routeCard: {
    borderRadius: 18,
    backgroundColor: "rgba(15,23,42,0.85)",
    borderWidth: 1,
    borderColor: "rgba(51,65,85,0.9)",
    padding: 12,
  },
  routeRow: { flexDirection: "row", gap: 10 },
  routeLeft: { width: 18, alignItems: "center", paddingTop: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  dotPickup: { borderColor: "#22C55E", backgroundColor: "transparent" },
  dotDrop: { borderColor: "#EF4444", backgroundColor: "transparent" },
  routeLine: {
    width: 2,
    flex: 1,
    backgroundColor: "rgba(148,163,184,0.35)",
    marginVertical: 4,
  },
  routeBody: { flex: 1 },
  addrRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  addrLabel: { color: "#64748B", fontSize: 11, fontWeight: "700" },
  addrText: { color: "#E2E8F0", fontSize: 13, fontWeight: "600", marginTop: 2 },
  roundBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  roundPickup: {
    backgroundColor: "rgba(34,197,94,0.12)",
    borderColor: "rgba(34,197,94,0.35)",
  },
  roundDrop: {
    backgroundColor: "rgba(239,68,68,0.12)",
    borderColor: "rgba(239,68,68,0.35)",
  },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  actionTile: {
    flex: 1,
    minHeight: 68,
    borderRadius: 16,
    backgroundColor: "rgba(15,23,42,0.95)",
    borderWidth: 1,
    borderColor: "#1E293B",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  actionLabel: { color: "#E2E8F0", fontWeight: "700", fontSize: 12 },
  waitWrap: { marginTop: 10 },
  prefsBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(15,23,42,0.7)",
    borderWidth: 1,
    borderColor: "#334155",
    gap: 4,
  },
  prefsTitle: { color: "#E2E8F0", fontWeight: "800", marginBottom: 2 },
  prefLine: { color: "#CBD5E1", fontSize: 12 },
  stopRow: { marginTop: 8 },
  stopText: { color: "#94A3B8", fontSize: 12 },
  row: { flexDirection: "row", gap: 8, marginTop: 6 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: "#1E3A8A",
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  secondaryText: { color: "#DBEAFE", fontWeight: "700", fontSize: 12 },
  primaryBtn: {
    backgroundColor: "#F5C542",
    borderRadius: 18,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  primaryIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(17,24,39,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#111827", fontWeight: "900", fontSize: 16 },
  cancelBtn: {
    marginTop: 10,
    borderRadius: 18,
    minHeight: 50,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.55)",
    backgroundColor: "rgba(15,23,42,0.9)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  cancelIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#F87171",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: "#FCA5A5", fontWeight: "800", fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    borderRadius: 24,
    backgroundColor: "#0B1220",
    borderWidth: 1,
    borderColor: "rgba(245,197,66,0.35)",
    padding: 18,
  },
  modalTitle: { color: "#F8FAFC", fontWeight: "900", fontSize: 18 },
  modalHint: { color: "#94A3B8", marginTop: 8, lineHeight: 19, fontSize: 13 },
  verifyingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
  },
  verifyingText: { color: "#FDE68A", fontWeight: "700", fontSize: 13 },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 16,
  },
  modalCancel: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#475569",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalCancelText: { color: "#E2E8F0", fontWeight: "700" },
});
