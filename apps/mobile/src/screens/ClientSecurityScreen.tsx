import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
  Image,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { toUserFacingError } from "../lib/userFacingError";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_BRIGHT,
  MMD_MUTED,
  MMD_NAVY,
  MMD_WHITE,
  mmdLogoSizeCompact,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

export function ClientSecurityScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const logoSize = mmdLogoSizeCompact(width, height);

  const [email, setEmail] = useState<string>("");
  const [hasUser, setHasUser] = useState<boolean>(true);

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!alive) return;

      if (error) {
        console.log("ClientSecurity getUser error:", error);
      }

      const u = data.user ?? null;
      setHasUser(!!u);
      setEmail(u?.email ?? "");
    })();

    return () => {
      alive = false;
    };
  }, []);

  const canSubmit = useMemo(() => {
    const p1 = newPassword.trim();
    const p2 = confirm.trim();
    return p1.length >= 8 && p1 === p2 && !saving && hasUser;
  }, [newPassword, confirm, saving, hasUser]);

  const onSave = useCallback(async () => {
    if (saving) return;

    if (!hasUser) {
      Alert.alert(
        t("client.security.sessionTitle", "Session"),
        t("client.security.sessionBody", "You are not signed in.")
      );
      return;
    }

    const p1 = newPassword.trim();
    const p2 = confirm.trim();

    if (p1.length < 8) {
      Alert.alert(
        t("client.security.passwordTitle", "Password"),
        t("client.security.min8", "Password must be at least 8 characters.")
      );
      return;
    }
    if (p1 !== p2) {
      Alert.alert(
        t("client.security.passwordTitle", "Password"),
        t("client.security.mismatch", "Passwords do not match.")
      );
      return;
    }

    try {
      setSaving(true);

      const { error } = await supabase.auth.updateUser({ password: p1 });
      if (error) {
        Alert.alert(
          t("client.security.errorTitle", "Error"),
          toUserFacingError(
            error,
            t(
              "client.security.genericError",
              "Unable to update password right now. Please try again."
            )
          )
        );
        return;
      }

      setNewPassword("");
      setConfirm("");
      setShowNew(false);
      setShowConfirm(false);

      Alert.alert(
        t("client.security.successTitle", "Password updated"),
        t("client.security.successBody", "Your password has been changed."),
        [{ text: t("common.ok", "OK"), onPress: () => navigation.goBack() }]
      );
    } catch (e: any) {
      console.log("ClientSecurity updateUser password error:", e);
      Alert.alert(
        t("client.security.errorTitle", "Error"),
        toUserFacingError(
          e,
          t(
            "client.security.genericError",
            "Unable to update password right now. Please try again."
          )
        )
      );
    } finally {
      setSaving(false);
    }
  }, [saving, hasUser, newPassword, confirm, navigation, t]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("client.security.title", "Security")}
        fallbackRoute="ClientSettings"
        variant="dark"
      />

      <View style={styles.content}>
        <Image
          source={MMD_LOGO}
          style={{
            width: logoSize,
            height: logoSize,
            borderRadius: logoSize / 2,
            alignSelf: "center",
            marginBottom: 16,
          }}
          resizeMode="contain"
          accessibilityLabel="MMD Delivery"
        />

        <View style={styles.card}>
          <Text style={styles.accountLabel}>
            {t("client.security.accountLabel", "Account")}
          </Text>
          <Text style={styles.email}>{email || "—"}</Text>

          <View style={{ height: 16 }} />

          <Text style={styles.fieldLabel}>
            {t("client.security.newPasswordLabel", "New password")}
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="********"
              placeholderTextColor="#6B7280"
              secureTextEntry={!showNew}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <TouchableOpacity onPress={() => setShowNew((v) => !v)} activeOpacity={0.85}>
              <Text style={styles.toggle}>
                {showNew
                  ? t("client.security.hide", "Hide")
                  : t("client.security.show", "Show")}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 12 }} />

          <Text style={styles.fieldLabel}>
            {t("client.security.confirmLabel", "Confirm password")}
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder="********"
              placeholderTextColor="#6B7280"
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <TouchableOpacity
              onPress={() => setShowConfirm((v) => !v)}
              activeOpacity={0.85}
            >
              <Text style={styles.toggle}>
                {showConfirm
                  ? t("client.security.hide", "Hide")
                  : t("client.security.show", "Show")}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 16 }} />

          <TouchableOpacity
            onPress={onSave}
            disabled={!canSubmit}
            activeOpacity={0.85}
            style={[styles.submitBtn, !canSubmit && styles.submitDisabled]}
          >
            {saving ? (
              <ActivityIndicator color={MMD_NAVY} />
            ) : (
              <Text style={styles.submitText}>
                {t("client.security.save", "Update password")}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.tip}>
            {t(
              "client.security.tip",
              "Use at least 8 characters. You’ll stay signed in on this device."
            )}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

export default ClientSecurityScreen;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  content: { padding: 16, paddingTop: 14, alignItems: "stretch" },
  card: {
    backgroundColor: MMD_NAVY,
    borderColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  accountLabel: {
    color: MMD_GOLD_BRIGHT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  email: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 16,
    marginTop: 6,
  },
  fieldLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  inputRow: {
    marginTop: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderColor: MMD_WHITE,
    borderWidth: 2,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  input: {
    flex: 1,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontWeight: "600",
    fontSize: 14,
    minHeight: 42,
    paddingHorizontal: 10,
  },
  toggle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
    paddingRight: 4,
  },
  submitBtn: {
    backgroundColor: MMD_GOLD_BRIGHT,
    borderRadius: 10,
    paddingVertical: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  submitDisabled: {
    backgroundColor: "#94A3B8",
    opacity: 0.55,
  },
  submitText: {
    color: MMD_NAVY,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "700",
    fontSize: 14,
  },
  tip: {
    color: MMD_MUTED,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    marginTop: 10,
    lineHeight: 18,
    fontSize: 12,
  },
});
