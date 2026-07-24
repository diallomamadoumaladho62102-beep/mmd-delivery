import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useReduceMotion } from "../../hooks/useReduceMotion";
import {
  requestClientAudioPermissions,
  startClientAudioCapture,
  stopClientAudioCapture,
} from "../../lib/taxiSafetyRecordingCapture";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  fetchSafetyRecordingStatus,
  getSafetyRecordingDownloadUrl,
  startSafetyRecording,
  stopSafetyRecording,
  uploadSafetyRecordingFile,
} from "../../lib/taxiSafetyRecordingApi";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";

type Props = {
  rideId: string;
  rideActive: boolean;
};

function formatTimer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * Premium safety audio card for clients.
 * Uses the existing taxi safety-recording APIs (secure upload to ride-safety-recordings).
 * Does NOT invent trusted contacts — share opens the signed download URL when available.
 */
export function SafetyAudioCard({ rideId, rideActive }: Props) {
  const { t } = useTranslation();
  const network = useNetworkStatus();
  const reduceMotion = useReduceMotion();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof fetchSafetyRecordingStatus>
  > | null>(null);
  const [localRecordingId, setLocalRecordingId] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [pendingUpload, setPendingUpload] = useState(false);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const pulse = useRef(new Animated.Value(0.4)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!rideId) return;
    try {
      const next = await fetchSafetyRecordingStatus(rideId);
      setStatus(next);
    } catch (error) {
      console.log("[SafetyAudioCard] status error:", error);
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 12000);
    return () => clearInterval(timer);
  }, [refresh]);

  const ownActive = Boolean(status?.client_audio_active);
  const allowed = status?.client_audio_allowed !== false;

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!ownActive) {
      setElapsedSec(0);
      return;
    }
    setElapsedSec(0);
    timerRef.current = setInterval(() => {
      setElapsedSec((v) => v + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [ownActive]);

  useEffect(() => {
    if (!ownActive || reduceMotion) {
      pulse.setValue(ownActive ? 1 : 0.4);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [ownActive, pulse, reduceMotion]);

  const flushPendingUpload = useCallback(async () => {
    if (!pendingUpload || !localUri || !localRecordingId) return;
    if (network.quality === "offline") return;
    setBusy(true);
    try {
      await uploadSafetyRecordingFile({
        rideId,
        recordingId: localRecordingId,
        uri: localUri,
        mimeType: "audio/m4a",
        extension: "m4a",
      });
      setPendingUpload(false);
      setLocalUri(null);
      setLocalRecordingId(null);
      Alert.alert(
        t("taxi.tracking.safety.uploadTitle", "Safety audio"),
        t("taxi.tracking.safety.uploadOk", "Recording uploaded securely."),
      );
      await refresh();
    } catch (error) {
      Alert.alert(
        t("taxi.tracking.safety.uploadTitle", "Safety audio"),
        toUserFacingError(error, "Upload failed"),
      );
    } finally {
      setBusy(false);
    }
  }, [
    localRecordingId,
    localUri,
    network.quality,
    pendingUpload,
    refresh,
    rideId,
    t,
  ]);

  useEffect(() => {
    if (network.quality === "online" && pendingUpload) {
      void flushPendingUpload();
    }
  }, [network.quality, pendingUpload, flushPendingUpload]);

  const handleStart = async () => {
    if (!rideActive || !allowed) return;
    setBusy(true);
    try {
      const granted = await requestClientAudioPermissions();
      if (!granted) {
        Alert.alert(
          t("taxi.tracking.safety.micTitle", "Microphone"),
          t(
            "taxi.tracking.safety.micBody",
            "Allow microphone access to record a safety audio for this ride.",
          ),
        );
        return;
      }

      const started = await startSafetyRecording({
        rideId,
        recordingType: "client_audio",
      });
      const recordingId = String(started.recording?.id ?? "");
      setLocalRecordingId(recordingId);
      await startClientAudioCapture();
      Alert.alert(
        t("taxi.tracking.safety.startedTitle", "Recording started"),
        started.consent_message ??
          t(
            "taxi.tracking.safety.consent",
            "A safety recording is in progress to protect both parties.",
          ),
      );
      await refresh();
    } catch (error) {
      Alert.alert(
        t("taxi.tracking.safety.errorTitle", "Error"),
        toUserFacingError(error, "Unable to start recording"),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      const activeRecording = (status?.recordings ?? []).find(
        (row) =>
          String(row.recording_type) === "client_audio" &&
          String(row.status) === "recording" &&
          String(row.initiator_role) === "client",
      );
      const recordingId =
        localRecordingId ?? String(activeRecording?.id ?? "");
      if (!recordingId) {
        Alert.alert(
          t("taxi.tracking.safety.errorTitle", "Error"),
          t("taxi.tracking.safety.noActive", "No active recording."),
        );
        return;
      }

      const capture = await stopClientAudioCapture();
      await stopSafetyRecording(recordingId);

      if (capture?.uri) {
        if (network.quality === "offline") {
          setLocalUri(capture.uri);
          setLocalRecordingId(recordingId);
          setPendingUpload(true);
          Alert.alert(
            t("taxi.tracking.safety.pendingTitle", "Pending upload"),
            t(
              "taxi.tracking.safety.pendingBody",
              "You are offline. The recording is kept on this device and will upload when network returns.",
            ),
          );
        } else {
          await uploadSafetyRecordingFile({
            rideId,
            recordingId,
            uri: capture.uri,
            mimeType: capture.mimeType,
            extension: capture.extension,
          });
          setLocalRecordingId(null);
          Alert.alert(
            t("taxi.tracking.safety.uploadTitle", "Safety audio"),
            t(
              "taxi.tracking.safety.stoppedOk",
              "Recording stopped and stored securely.",
            ),
          );
        }
      }
      await refresh();
    } catch (error) {
      Alert.alert(
        t("taxi.tracking.safety.errorTitle", "Error"),
        toUserFacingError(error, "Unable to stop recording"),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (recordingId: string) => {
    try {
      const { download_url: downloadUrl } =
        await getSafetyRecordingDownloadUrl(recordingId);
      await Linking.openURL(downloadUrl);
    } catch (error) {
      Alert.alert(
        t("taxi.tracking.safety.errorTitle", "Error"),
        toUserFacingError(error, "Download unavailable"),
      );
    }
  };

  if (!rideActive) return null;

  if (loading) {
    return (
      <View style={[styles.card, styles.cardLoading]} accessibilityRole="progressbar">
        <ActivityIndicator color="#A78BFA" />
        <Text style={styles.body}>
          {t("taxi.tracking.safety.loading", "Loading safety tools…")}
        </Text>
      </View>
    );
  }

  if (!allowed) {
    return (
      <View style={styles.card}>
        <Text style={styles.body}>
          {t(
            "taxi.tracking.safety.notAllowed",
            "Safety recording is not allowed in this area.",
          )}
        </Text>
      </View>
    );
  }

  const downloadable = (status?.recordings ?? []).filter(
    (row) =>
      String(row.initiator_role) === "client" &&
      ["available", "locked_for_review"].includes(String(row.status)),
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.shield}>
          <Ionicons name="shield-checkmark" size={20} color="#FFFFFF" />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            {t("taxi.tracking.safety.title", "Record a safety audio")}
          </Text>
          <Text style={styles.body}>
            {t(
              "taxi.tracking.safety.subtitle",
              "Securely record audio for this ride. Files are private and uploaded to MMD safety storage — not end-to-end encrypted.",
            )}
          </Text>
        </View>
      </View>

      <View style={styles.meter}>
        <Text style={styles.timer} accessibilityLiveRegion="none">
          {formatTimer(elapsedSec)}
        </Text>
        <View style={styles.waveRow}>
          {Array.from({ length: 12 }).map((_, i) => (
            <Animated.View
              key={`w-${i}`}
              style={[
                styles.waveBar,
                {
                  height: ownActive ? 8 + ((i * 7) % 18) : 6,
                  opacity: ownActive ? pulse : 0.35,
                },
              ]}
            />
          ))}
        </View>
        {pendingUpload ? (
          <Text style={styles.pending}>
            {t("taxi.tracking.safety.pendingBadge", "Pending upload")}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {!ownActive ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("taxi.tracking.safety.record", "Record")}
            disabled={busy}
            onPress={() => void handleStart()}
            style={[styles.recordBtn, { backgroundColor: "#7C3AED" }]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="mic" size={18} color="#FFFFFF" />
                <Text style={styles.recordLabel}>
                  {t("taxi.tracking.safety.record", "Record")}
                </Text>
                <Ionicons name="chevron-forward" size={16} color="#E9D5FF" />
              </>
            )}
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("taxi.tracking.safety.stop", "Stop")}
            disabled={busy}
            onPress={() => void handleStop()}
            style={[styles.recordBtn, { backgroundColor: "#DC2626" }]}
          >
            <Animated.View style={{ opacity: pulse }}>
              <Ionicons name="stop" size={18} color="#FFFFFF" />
            </Animated.View>
            <Text style={styles.recordLabel}>
              {t("taxi.tracking.safety.recording", "Recording… Stop")}
            </Text>
          </Pressable>
        )}
      </View>

      {downloadable.length > 0 ? (
        <View style={styles.downloads}>
          {downloadable.map((row) => (
            <Pressable
              key={String(row.id)}
              accessibilityRole="button"
              accessibilityLabel={t(
                "taxi.tracking.safety.openRecording",
                "Open recording",
              )}
              onPress={() => void handleDownload(String(row.id))}
              style={styles.downloadBtn}
            >
              <Ionicons name="play-circle-outline" size={18} color="#A5B4FC" />
              <Text style={styles.downloadLabel} numberOfLines={1}>
                {t("taxi.tracking.safety.openSecure", "Open secure recording")}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#0F172A",
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "rgba(124,58,237,0.55)",
    padding: 16,
    gap: 14,
  },
  cardLoading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 88,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  shield: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#7C3AED",
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    color: "#F8FAFC",
    fontSize: 16,
    fontWeight: "800",
  },
  body: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  meter: {
    backgroundColor: "rgba(15,23,42,0.8)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 8,
  },
  timer: {
    color: "#F8FAFC",
    fontSize: 22,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  waveRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    height: 24,
  },
  waveBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: "#A78BFA",
  },
  pending: {
    color: "#FBBF24",
    fontSize: 11,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
  },
  recordBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  recordLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  downloads: {
    gap: 8,
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  downloadLabel: {
    color: "#C7D2FE",
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
  },
});
