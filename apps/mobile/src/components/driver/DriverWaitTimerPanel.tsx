import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import * as Location from "expo-location";
import { supabase } from "../lib/supabase";
import {
  cancelTaxiNoShow,
  depositAtDoorWithProof,
  driverArrivedWaitTimer,
  fetchWaitTimerStatus,
  formatTimer,
  formatWaitFee,
  type WaitTimerEntityType,
  type WaitTimerState,
} from "../lib/waitTimerApi";

type Props = {
  entityType: WaitTimerEntityType;
  entityId: string;
  mode: "delivery" | "taxi";
  onDepositAuthorized?: (proofPhotoUrl: string) => void;
  onTaxiNoShowCanceled?: () => void;
};

export function DriverWaitTimerPanel({
  entityType,
  entityId,
  mode,
  onDepositAuthorized,
  onTaxiNoShowCanceled,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<WaitTimerState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const next = await fetchWaitTimerStatus(token, { entityType, entityId });
      if (next.ok) setStatus(next);
    } catch (e) {
      console.log("[DriverWaitTimerPanel] refresh", e);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const onArrived = useCallback(async () => {
    setLoading(true);
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== "granted") {
        Alert.alert("Location required", "Enable location to confirm arrival.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Session expired");

      const result = await driverArrivedWaitTimer(token, {
        entity_type: entityType,
        entity_id: entityId,
        driver_lat: pos.coords.latitude,
        driver_lng: pos.coords.longitude,
      });
      if (!result.ok) throw new Error(result.error ?? "Arrival failed");
      setStatus(result);
    } catch (e: any) {
      const message = String(e?.message ?? e);
      if (message.includes("manual_arrival_required")) {
        Alert.alert(
          "Manual validation",
          "You are close but not within 50m. Contact support or retry when closer.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Confirm anyway",
              onPress: async () => {
                try {
                  const pos = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.High,
                  });
                  const { data } = await supabase.auth.getSession();
                  const token = data.session?.access_token;
                  if (!token) return;
                  const result = await driverArrivedWaitTimer(token, {
                    entity_type: entityType,
                    entity_id: entityId,
                    driver_lat: pos.coords.latitude,
                    driver_lng: pos.coords.longitude,
                    force_manual: true,
                  });
                  if (result.ok) setStatus(result);
                } catch (inner) {
                  Alert.alert("Error", inner instanceof Error ? inner.message : "Failed");
                }
              },
            },
          ]
        );
      } else {
        Alert.alert("Arrival blocked", message);
      }
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  const timer = status?.timer;
  const currency = status?.currency ?? "USD";
  const arrived = Boolean(status?.driver_arrived_at || status?.wait_timer_started_at);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Client wait timer</Text>

      {!arrived ? (
        <TouchableOpacity
          style={[styles.primaryBtn, loading && styles.disabled]}
          disabled={loading}
          onPress={() => void onArrived()}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Je suis arrivé</Text>
          )}
        </TouchableOpacity>
      ) : (
        <>
          <Text style={styles.timer}>{formatTimer(timer?.elapsed_seconds ?? 0)}</Text>
          <Text style={styles.meta}>
            Free wait: {timer?.free_wait_minutes ?? 5} min • Late fee:{" "}
            {formatWaitFee(timer?.wait_fee_cents ?? 0, currency)}
          </Text>
          {timer?.remaining_free_seconds ? (
            <Text style={styles.meta}>
              Free time left: {formatTimer(timer.remaining_free_seconds)}
            </Text>
          ) : null}

          {mode === "delivery" && timer?.can_deposit_at_door ? (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() =>
                Alert.alert(
                  "Deposit at door",
                  "Upload a proof photo using the delivery confirmation flow.",
                  [
                    {
                      text: "OK",
                      onPress: () => onDepositAuthorized?.(""),
                    },
                  ]
                )
              }
            >
              <Text style={styles.secondaryText}>Déposer avec photo</Text>
            </TouchableOpacity>
          ) : null}

          {mode === "taxi" && timer?.can_cancel_no_penalty ? (
            <TouchableOpacity
              style={styles.dangerBtn}
              disabled={loading}
              onPress={() => {
                Alert.alert(
                  "Cancel without penalty",
                  "Customer no-show validated by wait timer. Cancel this ride?",
                  [
                    { text: "No", style: "cancel" },
                    {
                      text: "Yes, cancel",
                      style: "destructive",
                      onPress: async () => {
                        setLoading(true);
                        try {
                          const { data } = await supabase.auth.getSession();
                          const token = data.session?.access_token;
                          if (!token) throw new Error("Session expired");
                          await cancelTaxiNoShow(token, entityId);
                          onTaxiNoShowCanceled?.();
                        } catch (e) {
                          Alert.alert(
                            "Error",
                            e instanceof Error ? e.message : "Cancel failed"
                          );
                        } finally {
                          setLoading(false);
                        }
                      },
                    },
                  ]
                );
              }}
            >
              <Text style={styles.dangerText}>Annuler sans pénalité</Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}
    </View>
  );
}

export { depositAtDoorWithProof };

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    borderRadius: 16,
    padding: 14,
    backgroundColor: "rgba(15,23,42,0.92)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  title: { color: "#E2E8F0", fontWeight: "900", fontSize: 14, marginBottom: 10 },
  timer: { color: "#F8FAFC", fontWeight: "900", fontSize: 32, letterSpacing: 1 },
  meta: { color: "#94A3B8", fontWeight: "700", fontSize: 12, marginTop: 6 },
  primaryBtn: {
    backgroundColor: "#8B5CF6",
    borderRadius: 12,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "900" },
  secondaryBtn: {
    marginTop: 12,
    backgroundColor: "rgba(34,197,94,0.14)",
    borderRadius: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.4)",
  },
  secondaryText: { color: "#BBF7D0", fontWeight: "900" },
  dangerBtn: {
    marginTop: 12,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderRadius: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.35)",
  },
  dangerText: { color: "#FCA5A5", fontWeight: "900" },
  disabled: { opacity: 0.6 },
});
