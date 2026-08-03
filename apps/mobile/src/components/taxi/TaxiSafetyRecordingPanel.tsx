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
import {
  bindDriverSafetyCamera,
  requestClientAudioPermissions,
  startClientAudioCapture,
  startDriverSafetyVideoCapture,
  stopClientAudioCapture,
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

const CONSENT_MESSAGE =
  "A safety recording is active to protect both parties.";

export function TaxiSafetyRecordingPanel({
  rideId,
  role,
  rideActive,
  premium = false,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof fetchSafetyRecordingStatus>
  > | null>(null);
  const [localRecordingId, setLocalRecordingId] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const recordingType = role === "client" ? "client_audio" : "driver_video";
  const allowed =
    role === "client"
      ? status?.client_audio_allowed !== false
      : status?.driver_video_allowed !== false;

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
      if (role === "driver") bindDriverSafetyCamera(null);
    };
  }, [role]);

  const otherPartyActive =
    role === "client" ? status?.driver_video_active : status?.client_audio_active;
  const ownActive =
    role === "client" ? status?.client_audio_active : status?.driver_video_active;

  const handleStart = async () => {
    if (!rideActive || !allowed) return;
    setBusy(true);
    try {
      if (role === "client") {
        const granted = await requestClientAudioPermissions();
        if (!granted) {
          Alert.alert(
            "Microphone",
            "Allow microphone access for the safety recording.",
          );
          return;
        }
      } else {
        if (!permission?.granted) {
          const next = await requestPermission();
          if (!next.granted) {
            Alert.alert(
              "Camera",
              "Allow camera access for in-app safety recording. Recording stays inside MMD Delivery.",
            );
            return;
          }
        }
        if (!cameraReady || !cameraRef.current) {
          Alert.alert(
            "Camera",
            "Safety camera is starting. Tap Record again in a moment.",
          );
          return;
        }
      }

      const started = await startSafetyRecording({ rideId, recordingType });
      const recordingId = String(started.recording?.id ?? "");
      setLocalRecordingId(recordingId);

      if (role === "client") {
        await startClientAudioCapture();
      } else {
        await startDriverSafetyVideoCapture();
      }

      await refresh();
    } catch (error) {
      Alert.alert("Error", toUserFacingError(error, "Unable to start recording"));
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      const activeRecording = (status?.recordings ?? []).find(
        (row) =>
          String(row.recording_type) === recordingType &&
          String(row.status) === "recording" &&
          String(row.initiator_role) === role,
      );
      const recordingId = localRecordingId ?? String(activeRecording?.id ?? "");
      if (!recordingId) {
        Alert.alert("Error", "No active recording.");
        return;
      }

      let capture:
        | { uri: string; mimeType: string; extension: string }
        | null = null;

      if (role === "client") {
        capture = await stopClientAudioCapture();
      } else {
        capture = await stopDriverSafetyVideoCapture();
      }

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
      await refresh();
    } catch (error) {
      Alert.alert("Error", toUserFacingError(error, "Unable to stop recording"));
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
        "Error",
        toUserFacingError(error, "Unable to download recording"),
      );
    }
  };

  if (!rideActive || loading) return null;
  if (!allowed) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedText}>
          Safety recording is not allowed in this area.
        </Text>
      </View>
    );
  }

  const downloadable = (status?.recordings ?? []).filter(
    (row) =>
      String(row.initiator_role) === role &&
      ["available", "locked_for_review"].includes(String(row.status)),
  );

  const showHiddenCamera = role === "driver";

  return (
    <View style={premium ? styles.premiumWrap : styles.wrap}>
      {/* Tiny in-app camera — never opens the system Camera app. */}
      {showHiddenCamera ? (
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
      ) : null}

      {(ownActive || otherPartyActive || status?.any_active) && (
        <View style={styles.activeBanner}>
          <View style={styles.recDot} />
          <Text style={styles.activeText}>
            {ownActive
              ? role === "driver"
                ? "Safety video recording in background"
                : "Safety audio recording in progress"
              : CONSENT_MESSAGE}
          </Text>
        </View>
      )}

      {premium && role === "driver" ? (
        <View style={styles.premiumRow}>
          <View style={styles.premiumIcon}>
            <Ionicons name="shield-checkmark" size={20} color="#C4B5FD" />
          </View>
          <View style={styles.premiumCopy}>
            <Text style={styles.premiumTitle}>Safety first</Text>
            <Text style={styles.premiumSub}>
              Record a video for your safety and protection.
            </Text>
          </View>
          {!ownActive ? (
            <TouchableOpacity
              style={styles.recordPill}
              disabled={busy}
              onPress={() => void handleStart()}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name="videocam" size={14} color="#FFF" />
                  <Text style={styles.recordPillText}>Record video</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.stopPill}
              disabled={busy}
              onPress={() => void handleStop()}
            >
              <Text style={styles.recordPillText}>Stop</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={styles.row}>
          {!ownActive ? (
            <TouchableOpacity
              style={styles.startBtn}
              disabled={busy}
              onPress={() => void handleStart()}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.btnText}>
                  {role === "client"
                    ? "Record safety audio"
                    : "Record Safety Video"}
                </Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.stopBtn}
              disabled={busy}
              onPress={() => void handleStop()}
            >
              <Text style={styles.btnText}>Stop recording</Text>
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
            Download before expiry ({String(row.expires_at ?? "").slice(0, 10)})
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
