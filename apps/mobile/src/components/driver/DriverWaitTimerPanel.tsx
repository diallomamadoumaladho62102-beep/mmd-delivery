import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as Location from "expo-location";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import {
  captureDeliveryProofPhoto,
  getDeliveryProofPhotoErrorMessage,
  uploadDeliveryProofPhoto,
} from "../../lib/deliveryProofPhoto";
import {
  cancelTaxiNoShow,
  depositAtDoorWithProof,
  driverArrivedWaitTimer,
  fetchWaitTimerStatus,
  formatTimer,
  formatWaitFee,
  type WaitTimerEntityType,
  type WaitTimerState,
} from "../../lib/waitTimerApi";

type Props = {
  entityType: WaitTimerEntityType;
  entityId: string;
  mode: "delivery" | "taxi";
  onDepositAuthorized?: (proofPhotoUrl: string) => void;
  onTaxiNoShowCanceled?: () => void;
};

function isNetworkErrorMessage(message: string): boolean {
  return /network|fetch|timeout|failed to fetch|connection/i.test(message);
}

function statusSignature(value: WaitTimerState | null): string {
  if (!value?.ok) return "none";
  const timer = value.timer;
  return [
    value.driver_arrived_at ?? "",
    value.wait_timer_started_at ?? "",
    timer?.elapsed_seconds ?? 0,
    timer?.wait_fee_cents ?? 0,
    timer?.can_deposit_at_door ?? false,
    timer?.can_cancel_no_penalty ?? false,
  ].join("|");
}

export function DriverWaitTimerPanel({
  entityType,
  entityId,
  mode,
  onDepositAuthorized,
  onTaxiNoShowCanceled,
}: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<WaitTimerState | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const statusSigRef = useRef("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const tr = useCallback(
    (key: string, fallback: string) => String(t(key, { defaultValue: fallback })),
    [t]
  );

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setRefreshing(true);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          setRefreshError(tr("driver.waitTimer.sessionExpired", "Session expirée"));
          return;
        }
        const next = await fetchWaitTimerStatus(token, { entityType, entityId });
        if (!mountedRef.current) return;
        if (!next.ok) {
          setRefreshError(next.error ?? tr("driver.waitTimer.loadFailed", "Statut indisponible"));
          return;
        }
        const sig = statusSignature(next);
        if (sig !== statusSigRef.current) {
          statusSigRef.current = sig;
          setStatus(next);
        }
        setRefreshError(null);
      } catch (e) {
        if (!mountedRef.current) return;
        const message = e instanceof Error ? e.message : String(e);
        setRefreshError(
          isNetworkErrorMessage(message)
            ? tr("driver.waitTimer.networkError", "Connexion instable. Réessaie.")
            : message
        );
      } finally {
        if (mountedRef.current) setRefreshing(false);
      }
    },
    [entityType, entityId, tr]
  );

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh({ silent: true }), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      void refresh({ silent: true });
    }, [refresh])
  );

  const onArrived = useCallback(async () => {
    setLoading(true);
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== "granted") {
        Alert.alert(
          tr("driver.waitTimer.locationTitle", "Localisation requise"),
          tr(
            "driver.waitTimer.locationBody",
            "Active la localisation pour confirmer ton arrivée (≤ 50 m)."
          )
        );
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error(tr("driver.waitTimer.sessionExpired", "Session expirée"));

      const result = await driverArrivedWaitTimer(token, {
        entity_type: entityType,
        entity_id: entityId,
        driver_lat: pos.coords.latitude,
        driver_lng: pos.coords.longitude,
      });

      if (!result.ok) {
        const err = String(result.error ?? "arrival_failed");
        if (err.includes("manual_arrival_required")) {
          Alert.alert(
            tr("driver.waitTimer.tooFarTitle", "Trop loin du point"),
            tr(
              "driver.waitTimer.tooFarBody",
              "Approche à moins de 50 m pour valider l’arrivée GPS et démarrer le chronomètre."
            )
          );
          return;
        }
        throw new Error(err);
      }

      statusSigRef.current = statusSignature(result);
      setStatus(result);
      setRefreshError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      Alert.alert(
        tr("driver.waitTimer.arrivalBlockedTitle", "Arrivée refusée"),
        isNetworkErrorMessage(message)
          ? tr("driver.waitTimer.networkError", "Connexion instable. Réessaie.")
          : message
      );
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, tr]);

  const onDepositAtDoor = useCallback(async () => {
    setLoading(true);
    try {
      let photoUri: string | null = null;
      try {
        photoUri = await captureDeliveryProofPhoto();
      } catch (e) {
        const code = String((e as Error)?.message ?? e);
        if (code === "CAMERA_PERMISSION_DENIED") {
          Alert.alert(
            tr("driver.waitTimer.cameraTitle", "Caméra requise"),
            tr(
              "driver.waitTimer.cameraBody",
              "Autorise la caméra pour photographier le dépôt devant la porte."
            )
          );
          return;
        }
        throw e;
      }

      if (!photoUri) return;

      const publicUrl = await uploadDeliveryProofPhoto({
        entityId,
        photoUri,
      });

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error(tr("driver.waitTimer.sessionExpired", "Session expirée"));

      const result = await depositAtDoorWithProof(token, {
        entity_type: entityType === "delivery_request" ? "delivery_request" : "order",
        entity_id: entityId,
        proof_photo_url: publicUrl,
      });

      if (!result.ok) {
        throw new Error(result.error ?? "deposit_failed");
      }

      onDepositAuthorized?.(publicUrl);
      Alert.alert(
        tr("driver.waitTimer.depositOkTitle", "Dépôt autorisé"),
        tr(
          "driver.waitTimer.depositOkBody",
          "Photo enregistrée. Tu peux finaliser la livraison avec cette preuve."
        )
      );
      await refresh({ silent: true });
    } catch (e) {
      Alert.alert(
        tr("common.error.title", "Erreur"),
        getDeliveryProofPhotoErrorMessage(e)
      );
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType, onDepositAuthorized, refresh, tr]);

  const onTaxiNoShow = useCallback(async () => {
    Alert.alert(
      tr("driver.waitTimer.noShowTitle", "Annuler sans pénalité"),
      tr(
        "driver.waitTimer.noShowBody",
        "No-show client validé par le chronomètre. Confirmer l’annulation ?"
      ),
      [
        { text: tr("common.cancel", "Annuler"), style: "cancel" },
        {
          text: tr("driver.waitTimer.noShowConfirm", "Oui, annuler"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              setLoading(true);
              try {
                const { data } = await supabase.auth.getSession();
                const token = data.session?.access_token;
                if (!token) throw new Error(tr("driver.waitTimer.sessionExpired", "Session expirée"));
                const result = await cancelTaxiNoShow(token, entityId);
                if (!result.ok) throw new Error(result.error ?? "cancel_failed");
                onTaxiNoShowCanceled?.();
              } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                Alert.alert(
                  tr("common.error.title", "Erreur"),
                  isNetworkErrorMessage(message)
                    ? tr("driver.waitTimer.networkError", "Connexion instable. Réessaie.")
                    : message
                );
              } finally {
                setLoading(false);
              }
            })();
          },
        },
      ]
    );
  }, [entityId, onTaxiNoShowCanceled, tr]);

  const timer = status?.timer;
  const currency = status?.currency ?? "USD";
  const arrived = Boolean(status?.driver_arrived_at || status?.wait_timer_started_at);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          {tr("driver.waitTimer.title", "Chronomètre d’attente client")}
        </Text>
        {refreshing ? <ActivityIndicator size="small" color="#94A3B8" /> : null}
      </View>

      {refreshError ? (
        <Text style={styles.errorText}>{refreshError}</Text>
      ) : null}

      {!arrived ? (
        <TouchableOpacity
          style={[styles.primaryBtn, loading && styles.disabled]}
          disabled={loading}
          onPress={() => void onArrived()}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>
              {tr("driver.waitTimer.arrivedCta", "Je suis arrivé")}
            </Text>
          )}
        </TouchableOpacity>
      ) : (
        <>
          <Text style={styles.timer}>{formatTimer(timer?.elapsed_seconds ?? 0)}</Text>
          <Text style={styles.meta}>
            {tr("driver.waitTimer.freeWait", "Attente gratuite")}: {timer?.free_wait_minutes ?? 5}{" "}
            min • {tr("driver.waitTimer.lateFee", "Frais")}:{" "}
            {formatWaitFee(timer?.wait_fee_cents ?? 0, currency)}
          </Text>
          {(timer?.remaining_free_seconds ?? 0) > 0 ? (
            <Text style={styles.meta}>
              {tr("driver.waitTimer.freeRemaining", "Temps gratuit restant")}:{" "}
              {formatTimer(timer?.remaining_free_seconds ?? 0)}
            </Text>
          ) : null}

          {mode === "delivery" && status?.leave_at_door === false ? (
            <Text style={styles.hint}>
              {tr(
                "driver.waitTimer.leaveAtDoorDisabled",
                "Le client n’a pas autorisé le dépôt devant la porte."
              )}
            </Text>
          ) : null}

          {mode === "delivery" && timer?.can_deposit_at_door ? (
            <TouchableOpacity
              style={[styles.secondaryBtn, loading && styles.disabled]}
              disabled={loading}
              onPress={() => void onDepositAtDoor()}
            >
              {loading ? (
                <ActivityIndicator color="#BBF7D0" />
              ) : (
                <Text style={styles.secondaryText}>
                  {tr("driver.waitTimer.depositCta", "Déposer avec photo")}
                </Text>
              )}
            </TouchableOpacity>
          ) : null}

          {mode === "taxi" && timer?.can_cancel_no_penalty ? (
            <TouchableOpacity
              style={[styles.dangerBtn, loading && styles.disabled]}
              disabled={loading}
              onPress={() => void onTaxiNoShow()}
            >
              <Text style={styles.dangerText}>
                {tr("driver.waitTimer.noShowCta", "Annuler sans pénalité (no-show)")}
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    borderRadius: 16,
    padding: 14,
    backgroundColor: "rgba(15,23,42,0.92)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: { color: "#E2E8F0", fontWeight: "900", fontSize: 14, flex: 1 },
  errorText: { color: "#FCA5A5", fontSize: 12, fontWeight: "700", marginBottom: 8 },
  timer: { color: "#F8FAFC", fontWeight: "900", fontSize: 32, letterSpacing: 1 },
  meta: { color: "#94A3B8", fontWeight: "700", fontSize: 12, marginTop: 6 },
  hint: { color: "#64748B", fontSize: 11, marginTop: 8, lineHeight: 16 },
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
