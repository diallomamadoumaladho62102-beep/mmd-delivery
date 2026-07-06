import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  captureDriverSafetyVideo,
  requestClientAudioPermissions,
  startClientAudioCapture,
  stopClientAudioCapture,
} from "../../lib/taxiSafetyRecordingCapture";
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
};

const CONSENT_MESSAGE =
  "Un enregistrement de sécurité est en cours pour protéger les deux parties.";

export function TaxiSafetyRecordingPanel({ rideId, role, rideActive }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof fetchSafetyRecordingStatus>> | null>(
    null,
  );
  const [localRecordingId, setLocalRecordingId] = useState<string | null>(null);

  const recordingType = role === "client" ? "client_audio" : "driver_video";
  const allowed =
    role === "client" ? status?.client_audio_allowed !== false : status?.driver_video_allowed !== false;

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
          Alert.alert("Microphone", "Autorisez le micro pour l'enregistrement de sécurité.");
          return;
        }
      }

      const started = await startSafetyRecording({ rideId, recordingType });
      const recordingId = String(started.recording?.id ?? "");
      setLocalRecordingId(recordingId);

      if (role === "client") {
        await startClientAudioCapture();
      } else {
        Alert.alert(
          "Enregistrement vidéo",
          "Le client et vous serez informés. Ouvrez la caméra pour enregistrer la vidéo de sécurité.",
        );
      }

      Alert.alert(
        "Enregistrement démarré",
        started.consent_message ?? CONSENT_MESSAGE,
      );
      await refresh();
    } catch (error) {
      Alert.alert("Erreur", error instanceof Error ? error.message : "Démarrage impossible");
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
        Alert.alert("Erreur", "Aucun enregistrement actif.");
        return;
      }

      let capture:
        | { uri: string; mimeType: string; extension: string }
        | null = null;

      if (role === "client") {
        capture = await stopClientAudioCapture();
      } else {
        capture = await captureDriverSafetyVideo();
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
      Alert.alert("Enregistrement", "Enregistrement arrêté et enregistré de façon sécurisée.");
      await refresh();
    } catch (error) {
      Alert.alert("Erreur", error instanceof Error ? error.message : "Arrêt impossible");
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (recordingId: string) => {
    try {
      const { download_url: downloadUrl } = await getSafetyRecordingDownloadUrl(recordingId);
      await Linking.openURL(downloadUrl);
    } catch (error) {
      Alert.alert("Erreur", error instanceof Error ? error.message : "Téléchargement impossible");
    }
  };

  if (!rideActive || loading) return null;
  if (!allowed) {
    return (
      <View style={panelStyle("#334155")}>
        <Text style={textStyleObj}>
          L&apos;enregistrement de sécurité n&apos;est pas autorisé dans cette zone.
        </Text>
      </View>
    );
  }

  const downloadable = (status?.recordings ?? []).filter(
    (row) =>
      String(row.initiator_role) === role &&
      ["available", "locked_for_review"].includes(String(row.status)),
  );

  return (
    <View style={{ gap: 8, marginTop: 12 }}>
      {(ownActive || otherPartyActive || status?.any_active) && (
        <View style={panelStyle("#1D4ED8")}>
          <Text style={[textStyleObj, { fontWeight: "800" as const }]}>{CONSENT_MESSAGE}</Text>
          {otherPartyActive ? (
            <Text style={[textStyleObj, { marginTop: 6 }]}>
              {role === "client"
                ? "Le chauffeur enregistre une vidéo de sécurité."
                : "Le client enregistre un audio de sécurité."}
            </Text>
          ) : null}
        </View>
      )}

      <View style={styles.row}>
        {!ownActive ? (
          <TouchableOpacity
            style={btnStyle("#DC2626")}
            disabled={busy}
            onPress={() => void handleStart()}
          >
            {busy ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={btnTextStyle}>
                {role === "client"
                  ? "Enregistrer audio de sécurité"
                  : "Enregistrer vidéo de sécurité"}
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={btnStyle("#64748B")}
            disabled={busy}
            onPress={() => void handleStop()}
          >
            <Text style={btnTextStyle}>Arrêter l&apos;enregistrement</Text>
          </TouchableOpacity>
        )}
      </View>

      {downloadable.map((row) => (
        <TouchableOpacity
          key={String(row.id)}
          style={btnStyle("#2563EB")}
          onPress={() => void handleDownload(String(row.id))}
        >
          <Text style={btnTextStyle}>
            Télécharger avant expiration ({String(row.expires_at ?? "").slice(0, 10)})
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = {
  row: { flexDirection: "row" as const, gap: 8 },
};

function panelStyle(bg: string) {
  return {
    backgroundColor: bg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  };
}


function btnStyle(bg: string) {
  return {
    flex: 1,
    backgroundColor: bg,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center" as const,
  };
}

const textStyleObj = { color: "#EFF6FF", lineHeight: 20 };
const btnTextStyle = { color: "#FFF", fontWeight: "700" as const, textAlign: "center" as const };
