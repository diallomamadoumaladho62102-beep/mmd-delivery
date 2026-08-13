/**
 * Restaurant Security — Figma 348:7270 Premium Glass.
 * Logic: supabase password update + DeleteAccount navigation.
 */
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
  Image,
  StatusBar,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { toUserFacingError } from "../lib/userFacingError";
import ScreenHeader from "../components/navigation/ScreenHeader";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_LINK_BLUE,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");
const DANGER = "#FCA5A5";

export function RestaurantSecurityScreen() {
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
        console.log("RestaurantSecurity getUser error:", error);
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
        t("restaurant.security.sessionTitle", "Session"),
        t(
          "restaurant.security.sessionBody",
          "Your session is missing. Please log in again.",
        ),
      );
      return;
    }

    const p1 = newPassword.trim();
    const p2 = confirm.trim();

    if (p1.length < 8) {
      Alert.alert(
        t("restaurant.security.passwordTitle", "Password"),
        t(
          "restaurant.security.min8",
          "Password must contain at least 8 characters.",
        ),
      );
      return;
    }

    if (p1 !== p2) {
      Alert.alert(
        t("restaurant.security.passwordTitle", "Password"),
        t("restaurant.security.mismatch", "The two passwords do not match."),
      );
      return;
    }

    try {
      setSaving(true);

      const { error } = await supabase.auth.updateUser({ password: p1 });
      if (error) {
        Alert.alert(
          t("restaurant.security.errorTitle", "Error"),
          toUserFacingError(error, error.message),
        );
        return;
      }

      setNewPassword("");
      setConfirm("");
      setShowNew(false);
      setShowConfirm(false);

      Alert.alert(
        t("restaurant.security.successTitle", "Password updated"),
        t(
          "restaurant.security.successBody",
          "Your password has been updated successfully.",
        ),
        [{ text: t("common.ok", "OK"), onPress: () => navigation.goBack() }],
      );
    } catch (e: any) {
      console.log("restaurant updateUser password error:", e);
      Alert.alert(
        t("restaurant.security.errorTitle", "Error"),
        toUserFacingError(
          e,
          e?.message ??
            t("restaurant.security.genericError", "Unable to update password."),
        ),
      );
    } finally {
      setSaving(false);
    }
  }, [saving, hasUser, newPassword, confirm, navigation, t]);

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("restaurant.security.title", "Security")}
        subtitle="MMD Delivery"
        fallbackRoute="RestaurantCommandCenter"
        variant="mmd"
        rightSlot={
          <Image
            source={MMD_LOGO}
            style={styles.headerLogo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
        }
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          contentMax ? { maxWidth: contentMax, alignSelf: "center", width: "100%" } : null,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {email ? (
          <Text style={styles.accountEmail}>{email}</Text>
        ) : null}

        <View style={styles.passwordCard}>
          <View style={styles.cardHeader}>
            <View style={styles.iconPill}>
              <Ionicons name="lock-closed-outline" size={22} color={MMD_WHITE} />
            </View>
            <Text style={styles.cardTitle}>
              {t("restaurant.security.changePassword", "Change Password")}
            </Text>
          </View>

          <View style={styles.fields}>
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>
                {t("restaurant.security.newPasswordLabel", "New Password")}
              </Text>
              <View style={styles.inputRow}>
                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder={t(
                    "restaurant.security.newPasswordPlaceholder",
                    "Enter new password",
                  )}
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  secureTextEntry={!showNew}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
                <TouchableOpacity onPress={() => setShowNew((v) => !v)} activeOpacity={0.85}>
                  <Text style={styles.showToggle}>
                    {showNew
                      ? t("restaurant.security.hide", "Hide")
                      : t("restaurant.security.show", "Show")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>
                {t("restaurant.security.confirmLabel", "Confirm Password")}
              </Text>
              <View style={styles.inputRow}>
                <TextInput
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder={t(
                    "restaurant.security.confirmPlaceholder",
                    "Confirm new password",
                  )}
                  placeholderTextColor="rgba(255,255,255,0.4)"
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
                    {showConfirm
                      ? t("restaurant.security.hide", "Hide")
                      : t("restaurant.security.show", "Show")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <TouchableOpacity
            onPress={onSave}
            disabled={!canSubmit}
            activeOpacity={0.85}
            style={[styles.saveBtn, { opacity: canSubmit ? 1 : 0.55 }]}
          >
            {saving ? (
              <ActivityIndicator color={MMD_WHITE} />
            ) : (
              <Text style={styles.saveText}>
                {t("restaurant.security.save", "Save Password")}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.dangerCard}>
          <View style={styles.dangerHeader}>
            <View style={styles.dangerIcon}>
              <Ionicons name="warning-outline" size={18} color={DANGER} />
            </View>
            <Text style={styles.dangerTitle}>
              {t("restaurant.security.dangerZone", "Danger Zone")}
            </Text>
          </View>
          <Text style={styles.dangerBody}>
            {t(
              "restaurant.security.deleteHint",
              "Permanently delete your account and all data.",
            )}
          </Text>
          <TouchableOpacity
            onPress={() =>
              navigation.navigate("DeleteAccount", { role: "restaurant" })
            }
            activeOpacity={0.85}
            style={styles.deleteBtn}
          >
            <Text style={styles.deleteText}>
              {t("account.delete.title", "Delete Account")}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  headerLogo: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 24,
  },
  accountEmail: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
    marginTop: -8,
  },
  passwordCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: MMD_GLASS,
    padding: 24,
    gap: 20,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconPill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 18,
  },
  fields: { gap: 16, width: "100%" },
  fieldBlock: { gap: 8, width: "100%" },
  fieldLabel: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  input: {
    flex: 1,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 15,
    padding: 0,
  },
  showToggle: {
    color: MMD_LINK_BLUE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 13,
  },
  saveBtn: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 15,
  },
  dangerCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: MMD_GLASS,
    padding: 20,
    gap: 16,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  dangerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dangerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(252,165,163,0.2)",
    backgroundColor: "rgba(252,165,165,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerTitle: {
    color: DANGER,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 16,
  },
  dangerBody: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  deleteBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(252,165,166,0.4)",
    backgroundColor: "transparent",
    paddingVertical: 12,
    paddingHorizontal: 32,
    alignItems: "center",
  },
  deleteText: {
    color: DANGER,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
});

export default RestaurantSecurityScreen;
