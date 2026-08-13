/**
 * Driver identity selfie verification flow.
 * UI aligned to Figma 265:5922–5925 (Loading / Capture / Waiting / Success).
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { DriverBrandLoadingState } from "../components/driver/DriverBrandLoadingState";
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
import {
  MMD_BLUE,
  MMD_DRIVER_LINK,
  MMD_FONT,
  MMD_GREEN_SOFT,
  MMD_LINK_BLUE,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_TEXT_SOFT_BLUE,
  MMD_WHITE,
} from "../theme/mmdUi";

const IDENTITY_MESSAGE =
  "To protect clients, drivers and the MMD Delivery platform, we need to confirm your identity. Please take a clear selfie of your face.";

const SHIELD_BG = "#4f46e5";
const CAPTURE_BTN = "#d43737";
const WAITING_BTN = "#a78bfa";
const WAITING_BTN_TEXT = "#0f172a";
const SUCCESS_BTN = "#34d399";

type ScreenPhase =
  | "loading"
  | "capture"
  | "uploading"
  | "submitting"
  | "waiting"
  | "success"
  | "error";

export function DriverIdentityVerificationScreen() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const contentMax = width >= 768 ? 560 : undefined;
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
        return "Verification in progress";
      case "rejected":
        return "Verification refused";
      case "verified":
        return "Identity Confirmed";
      case "expired":
        return "Verification expired";
      default:
        return "Identity Verification";
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
        Alert.alert("Camera required", message, [
          { text: "Cancel", style: "cancel" },
          { text: "Open settings", onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      Alert.alert("Error", message);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!checkId || !photoUri) {
      Alert.alert("Selfie required", "Take a selfie before continuing.");
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
      Alert.alert("Upload failed", getDriverIdentityPhotoErrorMessage(error));
    }
  }, [checkId, photoUri]);

  const handleDone = useCallback(() => {
    if (gateStatus === "verified" || gateStatus === "not_required") {
      navigation.goBack();
      return;
    }
    void refreshStatus();
  }, [gateStatus, navigation, refreshStatus]);

  if (phase === "loading") {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title="Identity Verification"
          subtitle="Identity Verification"
          fallbackRoute="DriverTabs"
          variant="dark"
        />
        <Text style={styles.waitHint}>
          Please wait while we verify your identity.{"\n"}This may take a few moments.
        </Text>
        <DriverBrandLoadingState title="Loading..." logoAtBottom />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          contentMax ? { maxWidth: contentMax, alignSelf: "center", width: "100%" } : null,
        ]}
      >
        <ScreenHeader
          title="Identity Verification"
          subtitle={statusTitle}
          fallbackRoute="DriverTabs"
          variant="dark"
          style={{ paddingHorizontal: 0 }}
        />

        <View style={styles.hero}>
          <View style={styles.iconCircle}>
            <Ionicons name="shield-checkmark" size={34} color={MMD_WHITE} />
          </View>
          <Text style={styles.subtitle}>{IDENTITY_MESSAGE}</Text>
          {reason ? <Text style={styles.reason}>{reason}</Text> : null}
        </View>

        {phase === "waiting" ? (
          <View style={styles.card}>
            <Text style={styles.emojiIcon}>⏳</Text>
            <Text style={styles.cardTitle}>Pending Validation</Text>
            <Text style={styles.cardBody}>
              Your selfie has been received. Our team or automated system is validating your
              identity. You can go online once verification is complete.
            </Text>
            <TouchableOpacity style={styles.waitingBtn} onPress={refreshStatus} activeOpacity={0.85}>
              <Text style={styles.waitingBtnText}>Refresh Status</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {phase === "success" ? (
          <View style={styles.card}>
            <Text style={[styles.emojiIcon, { color: MMD_GREEN_SOFT }]}>✓</Text>
            <Text style={styles.cardTitle}>Identity Confirmed</Text>
            <Text style={styles.cardBody}>You can now go online.</Text>
            <TouchableOpacity style={styles.successBtn} onPress={handleDone} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {phase === "error" ? (
          <View style={styles.card}>
            <Ionicons name="alert-circle-outline" size={32} color="#fca5a5" />
            <Text style={styles.cardTitle}>Verification problem</Text>
            <Text style={styles.cardBody}>{errorMessage ?? "Something went wrong."}</Text>
            <TouchableOpacity style={styles.successBtn} onPress={refreshStatus} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {phase === "capture" || phase === "uploading" || phase === "submitting" ? (
          <View style={styles.card}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
            ) : (
              <View style={styles.previewPlaceholder}>
                <Text style={styles.previewCircle}>◯</Text>
                <Text style={styles.previewHint}>
                  Selfie required — centered face, good lighting
                </Text>
              </View>
            )}

            {phase === "uploading" || phase === "submitting" ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={MMD_WHITE} />
                <Text style={styles.helper}>
                  {phase === "uploading"
                    ? "Secure selfie upload…"
                    : "Submitting…"}
                </Text>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.captureBtn}
                  onPress={handleCapture}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryBtnText}>
                    {photoUri ? "Retake selfie" : "Take a Selfie"}
                  </Text>
                </TouchableOpacity>

                {photoUri ? (
                  <TouchableOpacity
                    style={styles.successBtn}
                    onPress={handleSubmit}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryBtnText}>Submit for verification</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={() =>
                    Alert.alert(
                      "Need help?",
                      "Contact MMD Delivery support if you cannot use the camera.",
                    )
                  }
                >
                  <Text style={styles.linkBtnText}>Camera issue?</Text>
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
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  container: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40, gap: 12 },
  waitHint: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
    paddingHorizontal: 16,
    marginTop: 8,
  },
  hero: { alignItems: "center", gap: 16, paddingVertical: 20, paddingHorizontal: 4 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: SHIELD_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  subtitle: {
    color: MMD_TEXT_SOFT_BLUE,
    fontSize: 18,
    lineHeight: 22,
    textAlign: "center",
    fontFamily: MMD_FONT.regular,
  },
  reason: {
    color: MMD_LINK_BLUE,
    fontSize: 13,
    textAlign: "center",
    fontFamily: MMD_FONT.regular,
  },
  card: {
    backgroundColor: MMD_BLUE,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    gap: 14,
    alignItems: "center",
  },
  emojiIcon: {
    fontSize: 28,
    textAlign: "center",
    color: "#a5b4fc",
  },
  cardTitle: {
    color: MMD_TEXT,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  cardBody: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 16,
    lineHeight: 21,
    textAlign: "center",
    fontFamily: MMD_FONT.regular,
  },
  centerBox: { alignItems: "center", gap: 10, paddingVertical: 20 },
  helper: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  preview: {
    width: "100%",
    height: 280,
    borderRadius: 16,
    backgroundColor: MMD_BLUE,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  previewPlaceholder: {
    width: "100%",
    height: 280,
    borderRadius: 16,
    backgroundColor: MMD_BLUE,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    gap: 16,
  },
  previewCircle: {
    color: MMD_LINK_BLUE,
    fontSize: 48,
    fontFamily: MMD_FONT.regular,
  },
  previewHint: {
    color: MMD_LINK_BLUE,
    textAlign: "center",
    fontSize: 15,
    fontFamily: MMD_FONT.regular,
  },
  captureBtn: {
    backgroundColor: CAPTURE_BTN,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  successBtn: {
    backgroundColor: SUCCESS_BTN,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  waitingBtn: {
    backgroundColor: WAITING_BTN,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  waitingBtnText: {
    color: WAITING_BTN_TEXT,
    fontSize: 16,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  primaryBtnText: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  linkBtn: { alignItems: "center", paddingVertical: 8 },
  linkBtnText: {
    color: MMD_DRIVER_LINK,
    fontSize: 16,
    fontFamily: MMD_FONT.regular,
  },
});

export default DriverIdentityVerificationScreen;
