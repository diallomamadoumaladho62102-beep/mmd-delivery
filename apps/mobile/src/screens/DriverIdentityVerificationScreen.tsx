import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchDriverIdentityStatus,
  identityBlocksDriverOnline,
  submitDriverIdentityCheck,
  type DriverIdentityGateStatus,
} from "../lib/driverIdentityApi";
import { getStableDriverDeviceId } from "../lib/driverDeviceId";
import {
  captureDriverIdentitySelfie,
  getDriverIdentityPhotoErrorMessage,
  uploadDriverIdentitySelfie,
} from "../lib/driverIdentityPhoto";

const IDENTITY_MESSAGE =
  "Pour protéger les clients, les chauffeurs et la plateforme MMD Delivery, nous devons confirmer votre identité. Veuillez prendre un selfie clair de votre visage.";

type ScreenPhase = "loading" | "capture" | "uploading" | "submitting" | "waiting" | "success" | "error";

export function DriverIdentityVerificationScreen() {
  const navigation = useNavigation<any>();
  const [gateStatus, setGateStatus] = useState<DriverIdentityGateStatus>("required");
  const [reason, setReason] = useState<string | null>(null);
  const [checkId, setCheckId] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [phase, setPhase] = useState<ScreenPhase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setPhase("loading");
    setErrorMessage(null);

    try {
      const deviceId = await getStableDriverDeviceId();
      const status = await fetchDriverIdentityStatus({
        intent: "refresh",
        deviceId,
      });

      setGateStatus(status.gate_status);
      setReason(status.reason ?? status.message);
      setCheckId(status.active_check?.id ?? null);

      if (status.gate_status === "verified" || status.gate_status === "not_required") {
        setPhase("success");
        return;
      }

      if (["submitted", "manual_review"].includes(status.gate_status)) {
        setPhase("waiting");
        return;
      }

      if (status.gate_status === "rejected") {
        setPhase("capture");
        return;
      }

      if (identityBlocksDriverOnline(status.gate_status)) {
        setPhase("capture");
        return;
      }

      setPhase("capture");
    } catch (error) {
      setPhase("error");
      setErrorMessage(getDriverIdentityPhotoErrorMessage(error));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshStatus();
    }, [refreshStatus]),
  );

  const statusTitle = useMemo(() => {
    switch (gateStatus) {
      case "submitted":
      case "manual_review":
        return "Vérification en cours";
      case "rejected":
        return "Vérification refusée";
      case "verified":
        return "Identité confirmée";
      case "expired":
        return "Vérification expirée";
      default:
        return "Vérification d'identité";
    }
  }, [gateStatus]);

  const handleCapture = useCallback(async () => {
    try {
      const uri = await captureDriverIdentitySelfie();
      if (!uri) return;
      setPhotoUri(uri);
      setErrorMessage(null);
    } catch (error) {
      const message = getDriverIdentityPhotoErrorMessage(error);
      if (String((error as Error).message) === "CAMERA_PERMISSION_DENIED") {
        Alert.alert(
          "Caméra requise",
          message,
          [
            { text: "Annuler", style: "cancel" },
            { text: "Ouvrir réglages", onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
      Alert.alert("Erreur", message);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!checkId || !photoUri) {
      Alert.alert("Selfie requis", "Prenez un selfie avant de continuer.");
      return;
    }

    try {
      setPhase("uploading");
      await uploadDriverIdentitySelfie({ checkId, photoUri });

      setPhase("submitting");
      const result = await submitDriverIdentityCheck(checkId);
      setGateStatus(result.gate_status);

      if (result.gate_status === "verified") {
        setPhase("success");
        return;
      }

      setPhase("waiting");
    } catch (error) {
      setPhase("capture");
      setErrorMessage(getDriverIdentityPhotoErrorMessage(error));
      Alert.alert("Envoi impossible", getDriverIdentityPhotoErrorMessage(error));
    }
  }, [checkId, photoUri]);

  const handleDone = useCallback(() => {
    if (gateStatus === "verified" || gateStatus === "not_required") {
      navigation.goBack();
      return;
    }
    void refreshStatus();
  }, [gateStatus, navigation, refreshStatus]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <View style={styles.iconCircle}>
            <Ionicons name="shield-checkmark" size={34} color="#fff" />
          </View>
          <Text style={styles.title}>{statusTitle}</Text>
          <Text style={styles.subtitle}>{IDENTITY_MESSAGE}</Text>
          {reason ? <Text style={styles.reason}>{reason}</Text> : null}
        </View>

        {phase === "loading" ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={styles.helper}>Chargement…</Text>
          </View>
        ) : null}

        {phase === "waiting" ? (
          <View style={styles.card}>
            <Ionicons name="time-outline" size={28} color="#a5b4fc" />
            <Text style={styles.cardTitle}>En attente de validation</Text>
            <Text style={styles.cardBody}>
              Votre selfie a été reçu. Notre équipe ou le système automatique valide votre identité.
              Vous pourrez passer en ligne dès que la vérification est terminée.
            </Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={refreshStatus}>
              <Text style={styles.secondaryBtnText}>Actualiser le statut</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {phase === "success" ? (
          <View style={styles.card}>
            <Ionicons name="checkmark-circle" size={36} color="#34d399" />
            <Text style={styles.cardTitle}>Identité confirmée</Text>
            <Text style={styles.cardBody}>Vous pouvez maintenant passer en ligne.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleDone}>
              <Text style={styles.primaryBtnText}>Continuer</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {phase === "error" ? (
          <View style={styles.card}>
            <Ionicons name="alert-circle-outline" size={32} color="#fca5a5" />
            <Text style={styles.cardTitle}>Problème de vérification</Text>
            <Text style={styles.cardBody}>{errorMessage ?? "Une erreur est survenue."}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={refreshStatus}>
              <Text style={styles.primaryBtnText}>Réessayer</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {phase === "capture" || phase === "uploading" || phase === "submitting" ? (
          <View style={styles.card}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
            ) : (
              <View style={styles.previewPlaceholder}>
                <Ionicons name="person-circle-outline" size={72} color="#64748b" />
                <Text style={styles.previewHint}>Selfie requis — visage centré, bonne lumière</Text>
              </View>
            )}

            {phase === "uploading" || phase === "submitting" ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color="#6366f1" />
                <Text style={styles.helper}>
                  {phase === "uploading" ? "Envoi sécurisé du selfie…" : "Soumission en cours…"}
                </Text>
              </View>
            ) : (
              <>
                <TouchableOpacity style={styles.primaryBtn} onPress={handleCapture}>
                  <Ionicons name="camera" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>
                    {photoUri ? "Reprendre le selfie" : "Prendre un selfie"}
                  </Text>
                </TouchableOpacity>

                {photoUri ? (
                  <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmit}>
                    <Text style={styles.primaryBtnText}>Envoyer pour vérification</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={() =>
                    Alert.alert(
                      "Besoin d'aide ?",
                      "Contactez le support MMD Delivery si vous ne pouvez pas utiliser la caméra.",
                    )
                  }
                >
                  <Text style={styles.linkBtnText}>Problème avec la caméra ?</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b1020" },
  container: { padding: 20, paddingBottom: 40 },
  hero: { alignItems: "center", marginBottom: 20 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#4f46e5",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: { color: "#f8fafc", fontSize: 26, fontWeight: "700", textAlign: "center" },
  subtitle: {
    color: "#cbd5e1",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 10,
  },
  reason: {
    color: "#a5b4fc",
    fontSize: 13,
    marginTop: 12,
    textAlign: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#451a1a",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  bannerText: { color: "#fecaca", flex: 1, fontSize: 13 },
  card: {
    backgroundColor: "#111827",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#1f2937",
    gap: 14,
    alignItems: "stretch",
  },
  cardTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "700", textAlign: "center" },
  cardBody: { color: "#94a3b8", fontSize: 14, lineHeight: 21, textAlign: "center" },
  centerBox: { alignItems: "center", gap: 10, paddingVertical: 20 },
  helper: { color: "#94a3b8", fontSize: 14 },
  preview: { width: "100%", height: 280, borderRadius: 16, backgroundColor: "#0f172a" },
  previewPlaceholder: {
    width: "100%",
    height: 280,
    borderRadius: 16,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  previewHint: { color: "#64748b", marginTop: 8, textAlign: "center", fontSize: 13 },
  primaryBtn: {
    backgroundColor: "#4f46e5",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
  },
  secondaryBtnText: { color: "#cbd5e1", fontSize: 15, fontWeight: "600" },
  linkBtn: { alignItems: "center", paddingVertical: 8 },
  linkBtnText: { color: "#93c5fd", fontSize: 14 },
});

export default DriverIdentityVerificationScreen;
