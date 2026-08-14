/**
 * Driver Security — change password + delete account.
 * UI aligned to Figma 265:5928.
 */
import { toUserFacingError } from "../lib/userFacingError";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import ScreenHeader from "../components/navigation/ScreenHeader";
import {
  MMD_BLUE,
  MMD_DRIVER_LINK,
  MMD_FONT,
  MMD_LINK_BLUE,
  MMD_STROKE,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../theme/mmdUi";

const SAVE_GREEN = "#34C759";
const DELETE_BG = "rgba(180,30,30,0.12)";
const DELETE_TEXT = "rgba(180,30,30,0.96)";

export function DriverSecurityScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const contentMax = width >= 768 ? 560 : undefined;

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
        console.log("DriverSecurity getUser error:", error);
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
      Alert.alert(t("driver.security.sessionTitle"), t("driver.security.sessionBody"));
      return;
    }

    const p1 = newPassword.trim();
    const p2 = confirm.trim();

    if (p1.length < 8) {
      Alert.alert(t("driver.security.passwordTitle"), t("driver.security.min8"));
      return;
    }
    if (p1 !== p2) {
      Alert.alert(t("driver.security.passwordTitle"), t("driver.security.mismatch"));
      return;
    }

    try {
      setSaving(true);

      const { error } = await supabase.auth.updateUser({ password: p1 });
      if (error) {
        Alert.alert(
          t("driver.security.errorTitle"),
          toUserFacingError(error),
        );
        return;
      }

      setNewPassword("");
      setConfirm("");
      setShowNew(false);
      setShowConfirm(false);

      Alert.alert(t("driver.security.successTitle"), t("driver.security.successBody"), [
        { text: t("common.ok"), onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      console.log("updateUser password error:", e);
      Alert.alert(
        t("driver.security.errorTitle"),
        toUserFacingError(e, t("driver.security.genericError")),
      );
    } finally {
      setSaving(false);
    }
  }, [saving, hasUser, newPassword, confirm, navigation, t]);

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.security.title")}
        fallbackRoute="DriverTabs"
        variant="dark"
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          contentMax ? { maxWidth: contentMax, alignSelf: "center", width: "100%" } : null,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.accountLabel}>{t("driver.security.accountLabel")}</Text>
          <View style={{ height: 6 }} />
          <Text style={styles.email}>{email || "—"}</Text>

          <View style={{ height: 16 }} />

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{t("driver.security.newPasswordLabel")}</Text>
            <View style={styles.inputRow}>
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder={t("driver.security.passwordPlaceholder", "Password")}
                placeholderTextColor={MMD_LINK_BLUE}
                secureTextEntry={!showNew}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <TouchableOpacity onPress={() => setShowNew((v) => !v)} activeOpacity={0.85}>
                <Text style={styles.showToggle}>
                  {showNew ? t("driver.security.hide") : t("driver.security.show")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ height: 12 }} />

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{t("driver.security.confirmLabel")}</Text>
            <View style={styles.inputRow}>
              <TextInput
                value={confirm}
                onChangeText={setConfirm}
                placeholder={t("driver.security.passwordPlaceholder", "Password")}
                placeholderTextColor={MMD_LINK_BLUE}
                secureTextEntry={!showConfirm}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <TouchableOpacity
                onPress={() => setShowConfirm((v) => !v)}
                activeOpacity={0.85}
              >
                <Text style={styles.showToggle}>
                  {showConfirm ? t("driver.security.hide") : t("driver.security.show")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ height: 16 }} />

          <TouchableOpacity
            onPress={onSave}
            disabled={!canSubmit}
            activeOpacity={0.85}
            style={[styles.saveBtn, { opacity: canSubmit ? 1 : 0.55 }]}
          >
            {saving ? (
              <ActivityIndicator color={MMD_WHITE} />
            ) : (
              <Text style={styles.saveText}>{t("driver.security.save")}</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 10 }} />
          <Text style={styles.tip}>{t("driver.security.tip")}</Text>
        </View>

        <View style={{ height: 18 }} />

        <TouchableOpacity
          onPress={() => navigation.navigate("DeleteAccount", { role: "driver" })}
          activeOpacity={0.85}
          style={styles.deleteBtn}
        >
          <Text style={styles.deleteText}>
            {t("account.delete.title", "Delete account")}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: MMD_BLUE,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: MMD_BLUE,
    borderColor: MMD_STROKE,
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 14,
  },
  accountLabel: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 16,
  },
  email: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 16,
  },
  fieldBlock: {
    gap: 8,
  },
  fieldLabel: {
    color: "#E5E7EB",
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 16,
  },
  inputRow: {
    backgroundColor: MMD_BLUE,
    borderColor: MMD_STROKE,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 16,
  },
  showToggle: {
    color: MMD_DRIVER_LINK,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: SAVE_GREEN,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  saveText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 16,
  },
  tip: {
    color: MMD_LINK_BLUE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
    lineHeight: 18,
  },
  deleteBtn: {
    backgroundColor: DELETE_BG,
    borderColor: MMD_STROKE,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  deleteText: {
    color: DELETE_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 16,
  },
});

export default DriverSecurityScreen;
