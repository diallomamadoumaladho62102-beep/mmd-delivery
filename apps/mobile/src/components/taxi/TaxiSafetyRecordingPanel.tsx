import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import {
  bindDriverSafetyCamera,
  requestSafetyAudioPermissions,
  startDriverSafetyVideoCapture,
  stopDriverSafetyVideoCapture,
} from "../../lib/taxiSafetyRecordingCapture";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  fetchSafetyRecordingStatus,
  getSafetyRecordingDownloadUrl,
  startSafetyRecording,
  stopSafetyRecording,
  uploadSafetyRecordingFile,
} from "../../lib/taxiSafetyRecordingApi";

type Props = {
  rideId: string;
  role: "client" | "driver";
  rideActive: boolean;
  /** Compact premium row used inside the floating taxi card. */
  premium?: boolean;
};

/**
 * Optional Safety Video for drivers (camera + mic).
 * Safety Audio for both roles lives in SafetyAudioCard.
 */
export function TaxiSafetyRecordingPanel({
  rideId,
  role,
  rideActive,
  premium = false,
}: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof fetchSafetyRecordingStatus>
  > | null>(null);
  const [localRecordingId, setLocalRecordingId] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  // Video panel is driver-only in production UI.
  const recordingType = "driver_video" as const;
  const allowed = status?.driver_video_allowed !== false;

  const refresh = useCallback(async () => {
    if (!rideId) return;
    try {
      const next = await fetchSafetyRecordingStatus(rideId);
      setStatus(next);
    } catch (error) {
      console.log("[safety recording] status error:", error);
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 12000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    return () => {
      bindDriverSafetyCamera(null);
    };
  }, []);

  const otherPartyActive = Boolean(
    status?.client_audio_active || status?.driver_audio_active,
  );
  const ownActive = Boolean(status?.driver_video_active);

  const runStart = async () => {
    if (!rideActive || !allowed || role !== "driver") return;
    setBusy(true);
    try {
      if (!permission?.granted) {
        const next = await requestPermission();
        if (!next.granted) {
          Alert.alert(
            t("taxi.tracking.safety.cameraTitle", "Camera"),
            t(
              "taxi.tracking.safety.cameraBody",
              "Allow camera access for in-app safety recording. Recording stays inside MMD Delivery.",
            ),
          );
          return;
        }
      }
      const micOk = await requestSafetyAudioPermissions();
      if (!micOk) {
        Alert.alert(
          t("taxi.tracking.safety.micTitle", "Microphone"),
          t(
            "taxi.tracking.safety.videoMicBody",
            "Allow microphone access for safety video audio. You can enable it in Settings if blocked.",
          ),
        );
        return;
      }
      if (!cameraReady || !cameraRef.current) {
        Alert.alert(
          t("taxi.tracking.safety.cameraTitle", "Camera"),
          t(
            "taxi.tracking.safety.cameraStarting",
            "Safety camera is starting. Tap Record again in a moment.",
          ),
        );
        return;
      }

      const started = await startSafetyRecording({ rideId, recordingType });
      const recordingId = String(started.recording?.id ?? "");
      setLocalRecordingId(recordingId);
      await startDriverSafetyVideoCapture();
      await refresh();
    } catch (error) {
      Alert.alert(
        t("taxi.tracking.safety.errorTitle", "Error"),
        toUserFacingError(
          error,
          t("taxi.tracking.safety.startFailed", "Unable to start recording."),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleStart = () => {
    Alert.alert(
      t("taxi.tracking.safety.videoConsentTitle", "Start Safety Video?"),
      t(
        "taxi.tracking.safety.videoConsentBody",
        "This uses your camera and microphone inside MMD Delivery only. The other party is notified. Consent is independent — their mic is not turned on by this action.",
      ),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("taxi.tracking.safety.consentConfirm", "I understand — Record"),
          onPress: () => void runStart(),
        },
      ],
    );
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      const activeRecording = (status?.recordings ?? []).find(
        (row) =>
          String(row.recording_type) === recordingType &&
          String(row.status) === "recording" &&
          String(row.initiator_role) === "driver",
      );
      const recordingId = localRecordingId ?? String(activeRecording?.id ?? "");
      if (!recordingId) {
        Alert.alert(
          t("taxi.tracking.safety.errorTitle", "Error"),
          t("taxi.tracking.safety.noActive", "No active recording."),
        );
        return;
      }

      const capture = await stopDriverSafetyVideoCapture();
      await stopSafetyRecording(recordingId);

      if (capture) {
        await uploadSafetyRecordingFile({
          rideId,
          recordingId,
          uri: capture.uri,
          mimeType: capture.mimeType,
          extension: capture.extension,
        });
      }

      setLocalRecordingId(null);
      Alert.alert(
        t("taxi.tracking.safety.uploadTitle", "Safety audio"),
        t(
          "taxi.tracking.safety.stoppedOk",
          "Recording stopped and stored securely.",
        ),
      );
      await refresh();
    } catch (error) {
      Alert.alert(
        t("taxi.tracking.safety.errorTitle", "Error"),
        toUserFacingError(
          error,
          t("taxi.tracking.safety.stopFailed", "Unable to stop recording."),
        ),
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
        toUserFacingError(
          error,
          t("taxi.tracking.safety.downloadFailed", "Unable to download the recording."),
        ),
      );
    }
  };

  if (!rideActive || loading || role !== "driver") return null;
  if (!allowed) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedText}>
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
      String(row.initiator_role) === "driver" &&
      String(row.recording_type) === "driver_video" &&
      ["available", "locked_for_review"].includes(String(row.status)),
  );

  return (
    <View style={premium ? styles.premiumWrap : styles.wrap}>
      <CameraView
        ref={(ref) => {
          cameraRef.current = ref;
          bindDriverSafetyCamera(ref);
        }}
        style={styles.hiddenCamera}
        facing="front"
        mode="video"
        mute={false}
        onCameraReady={() => setCameraReady(true)}
      />

      {(ownActive || otherPartyActive) && (
        <View style={styles.activeBanner}>
          <View style={styles.recDot} />
          <Text style={styles.activeText}>
            {ownActive
              ? t(
                  "taxi.tracking.safety.videoActive",
                  "RECORDING — safety video is active (camera + mic). Tap Stop to end.",
                )
              : t(
                  "taxi.tracking.safety.otherActive",
                  "The other party started a safety recording on their device. Your microphone stays off unless you start yours.",
                )}
          </Text>
        </View>
      )}

      {premium ? (
        <View style={styles.premiumRow}>
          <View style={styles.premiumIcon}>
            <Ionicons name="videocam" size={20} color="#C4B5FD" />
          </View>
          <View style={styles.premiumCopy}>
            <Text style={styles.premiumTitle}>
              {t("taxi.tracking.safety.videoTitle", "Safety video (optional)")}
            </Text>
            <Text style={styles.premiumSub}>
              {t(
                "taxi.tracking.safety.videoSubtitle",
                "Record an in-app front-camera video with audio for protection. Never starts silently.",
              )}
            </Text>
          </View>
          {!ownActive ? (
            <TouchableOpacity
              style={styles.recordPill}
              disabled={busy}
              onPress={handleStart}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name="videocam" size={14} color="#FFF" />
                  <Text style={styles.recordPillText}>
                    {t("taxi.tracking.safety.videoRecord", "Record video")}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.stopPill}
              disabled={busy}
              onPress={() => void handleStop()}
            >
              <Text style={styles.recordPillText}>
                {t("taxi.tracking.safety.stop", "Stop")}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={styles.row}>
          {!ownActive ? (
            <TouchableOpacity
              style={styles.startBtn}
              disabled={busy}
              onPress={handleStart}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.btnText}>
                  {t("taxi.tracking.safety.videoRecord", "Record video")}
                </Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.stopBtn}
              disabled={busy}
              onPress={() => void handleStop()}
            >
              <Text style={styles.btnText}>
                {t("taxi.tracking.safety.stopRecording", "Stop recording")}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {downloadable.map((row) => (
        <TouchableOpacity
          key={String(row.id)}
          style={styles.downloadBtn}
          onPress={() => void handleDownload(String(row.id))}
        >
          <Text style={styles.btnText}>
            {t("taxi.tracking.safety.downloadBeforeExpiry", {
              date: String(row.expires_at ?? "").slice(0, 10),
              defaultValue: "Download before expiry ({{date}})",
            })}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 12 },
  premiumWrap: { marginTop: 10 },
  hiddenCamera: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0.01,
    left: 0,
    top: 0,
    zIndex: -1,
  },
  blocked: {
    backgroundColor: "#334155",
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
  },
  blockedText: { color: "#E2E8F0", lineHeight: 20 },
  activeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(29,78,216,0.35)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.25)",
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
  },
  activeText: { color: "#EFF6FF", fontWeight: "700", flex: 1, fontSize: 12 },
  premiumRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(30,27,75,0.72)",
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.28)",
  },
  premiumIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(124,58,237,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  premiumCopy: { flex: 1, minWidth: 0 },
  premiumTitle: { color: "#F8FAFC", fontWeight: "800", fontSize: 14 },
  premiumSub: { color: "#C4B5FD", fontSize: 11, marginTop: 2, lineHeight: 15 },
  recordPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#7C3AED",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  stopPill: {
    backgroundColor: "#64748B",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  recordPillText: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  row: { flexDirection: "row", gap: 8 },
  startBtn: {
    flex: 1,
    backgroundColor: "#7C3AED",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  stopBtn: {
    flex: 1,
    backgroundColor: "#64748B",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  downloadBtn: {
    backgroundColor: "#2563EB",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  btnText: { color: "#FFF", fontWeight: "700", textAlign: "center" },
});
