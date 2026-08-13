import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { deleteMyAccount } from "../lib/deleteAccountApi";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_BRIGHT,
  MMD_GOLD_DARK,
  MMD_MUTED,
  MMD_NAVY,
  MMD_WHITE,
} from "../theme/mmdUi";

type Role = "client" | "driver" | "restaurant";

type Props = {
  role?: Role;
};

const CONFIRM_WORD = "DELETE";

export function DeleteAccountScreen(props: Props) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, "DeleteAccount">>();
  const role: Role = props.role ?? route.params?.role ?? "client";

  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"info" | "confirm">("info");

  const roleLabel = useMemo(() => {
    if (role === "driver") return t("common.driver", "Driver");
    if (role === "restaurant") return t("common.restaurant", "Restaurant");
    return t("common.client", "Client");
  }, [role, t]);

  const canSubmit =
    password.trim().length >= 6 &&
    phrase.trim().toUpperCase() === CONFIRM_WORD &&
    !busy;

  const onCancel = useCallback(() => {
    if (busy) return;
    navigation.goBack();
  }, [busy, navigation]);

  const runDelete = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const result = await deleteMyAccount({
        password: password.trim(),
        expectedRole: role,
      });
      if (result.ok === false) {
        Alert.alert(
          t("account.delete.failedTitle", "Deletion failed"),
          result.error
        );
        return;
      }
      Alert.alert(
        t("account.delete.doneTitle", "Account deleted"),
        t(
          "account.delete.doneBody",
          "Your personal data has been anonymized. You have been signed out. Financial records required by law were retained."
        ),
        [
          {
            text: t("common.ok", "OK"),
            onPress: () => {
              navigation.reset({
                index: 0,
                routes: [{ name: "RoleSelect" }],
              });
            },
          },
        ]
      );
    } finally {
      setBusy(false);
    }
  }, [canSubmit, navigation, password, role, t]);

  const onFinalConfirm = useCallback(() => {
    Alert.alert(
      t("account.delete.finalTitle", "Delete permanently?"),
      t(
        "account.delete.finalBody",
        "This cannot be undone. You will lose access immediately."
      ),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("account.delete.confirmAction", "Delete my account"),
          style: "destructive",
          onPress: () => void runDelete(),
        },
      ]
    );
  }, [runDelete, t]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("account.delete.title", "Delete account")}
        onBack={onCancel}
        variant="dark"
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content}>
          {step === "info" ? (
            <>
              <Text style={styles.lead}>
                {t(
                  "account.delete.lead",
                  "You are about to permanently delete your {{role}} account on MMD Delivery.",
                  { role: roleLabel }
                )}
              </Text>
              <Text style={styles.sectionTitle}>
                {t("account.delete.whatHappens", "What happens")}
              </Text>
              <Text style={styles.bullet}>
                •{" "}
                {t(
                  "account.delete.bulletAccess",
                  "Immediate sign-out and ban on future login"
                )}
              </Text>
              <Text style={styles.bullet}>
                •{" "}
                {t(
                  "account.delete.bulletPii",
                  "Name, phone, email, addresses, and profile photos are anonymized"
                )}
              </Text>
              <Text style={styles.bullet}>
                •{" "}
                {t(
                  "account.delete.bulletPush",
                  "Push tokens and devices are removed"
                )}
              </Text>
              <Text style={styles.bullet}>
                •{" "}
                {t(
                  "account.delete.bulletKeep",
                  "Orders, rides, payments, payouts, and tax records are retained when legally required"
                )}
              </Text>
              <TouchableOpacity
                style={styles.primaryOuter}
                onPress={() => setStep("confirm")}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={[MMD_GOLD_DARK, MMD_GOLD_BRIGHT]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.primaryBtn}
                >
                  <Text style={styles.primaryBtnText}>
                    {t("account.delete.continue", "Continue")}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={onCancel}>
                <Text style={styles.secondaryBtnText}>
                  {t("common.cancel", "Cancel")}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.lead}>
                {t(
                  "account.delete.confirmLead",
                  "Enter your password and type DELETE to confirm."
                )}
              </Text>
              <Text style={styles.label}>
                {t("common.password", "Password")}
              </Text>
              <View style={styles.inputShell}>
                <TextInput
                  style={styles.input}
                  secureTextEntry
                  autoCapitalize="none"
                  value={password}
                  onChangeText={setPassword}
                  editable={!busy}
                  placeholder={t(
                    "account.delete.passwordPlaceholder",
                    "Current password"
                  )}
                  placeholderTextColor="#6B7280"
                />
              </View>
              <Text style={styles.label}>
                {t("account.delete.typeDelete", 'Type "DELETE"')}
              </Text>
              <View style={styles.inputShell}>
                <TextInput
                  style={styles.input}
                  autoCapitalize="characters"
                  value={phrase}
                  onChangeText={setPhrase}
                  editable={!busy}
                  placeholder={CONFIRM_WORD}
                  placeholderTextColor="#6B7280"
                />
              </View>
              <TouchableOpacity
                style={[styles.dangerBtn, !canSubmit && styles.btnDisabled]}
                disabled={!canSubmit}
                onPress={onFinalConfirm}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.dangerBtnText}>
                    {t("account.delete.confirmAction", "Delete my account")}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => setStep("info")}
                disabled={busy}
              >
                <Text style={styles.secondaryBtnText}>
                  {t("common.back", "Back")}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  content: { padding: 20, paddingBottom: 40 },
  lead: {
    fontSize: 15,
    color: MMD_MUTED,
    fontFamily: MMD_FONT.regular,
    lineHeight: 22,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    color: MMD_GOLD_BRIGHT,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  bullet: {
    fontSize: 14,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    lineHeight: 22,
    marginBottom: 4,
  },
  label: {
    fontSize: 12,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    color: MMD_GOLD_BRIGHT,
    marginTop: 12,
    marginBottom: 6,
  },
  inputShell: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 2,
    borderColor: MMD_WHITE,
    borderRadius: 10,
    padding: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "transparent",
    fontSize: 14,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    minHeight: 42,
  },
  primaryOuter: { marginTop: 24 },
  primaryBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: MMD_NAVY,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "700",
    fontSize: 14,
  },
  secondaryBtn: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 14,
    minHeight: 44,
    alignItems: "center",
  },
  secondaryBtnText: {
    color: MMD_GOLD_BRIGHT,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
  },
  dangerBtn: {
    marginTop: 24,
    backgroundColor: "#B91C1C",
    borderRadius: 10,
    paddingVertical: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerBtnText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "700",
    fontSize: 14,
  },
  btnDisabled: { opacity: 0.45 },
});

export default DeleteAccountScreen;
