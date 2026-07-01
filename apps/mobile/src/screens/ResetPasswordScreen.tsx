import React, { useCallback, useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import * as Linking from "expo-linking";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { validatePassword } from "../lib/authValidation";
import { clearSelectedRole } from "../lib/authRole";
import { rowDirection, textAlignStart } from "../i18n/rtl";

function getUrlParams(url: string) {
  const params: Record<string, string> = {};

  const [, hash = ""] = url.split("#");
  const [, query = ""] = url.split("?");

  const raw = [hash, query].filter(Boolean).join("&");

  raw.split("&").forEach((part) => {
    const [key, value] = part.split("=");
    if (key && value) {
      params[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  });

  return params;
}

export default function ResetPasswordScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const prepareRecoverySession = useCallback(async (url: string | null) => {
    try {
      if (!url) return;

      if (__DEV__) {
        console.log("RESET PASSWORD deep link received");
      }

      const params = getUrlParams(url);
      const accessToken = params.access_token;
      const refreshToken = params.refresh_token;

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          console.log("setSession recovery error:", error.message);
          Alert.alert(
            t("common.error", "Error"),
            t("auth.resetPassword.invalidLink", "Invalid or expired link. Request a new one.")
          );
        }
      }
    } catch (e) {
      console.log("prepareRecoverySession error:", e);
      Alert.alert(
        t("common.error", "Error"),
        t("auth.resetPassword.prepareFailed", "Unable to prepare password reset.")
      );
    } finally {
      setCheckingSession(false);
    }
  }, [t]);

  useEffect(() => {
    let alive = true;

    Linking.getInitialURL()
      .then((url) => {
        if (!alive) return;
        void prepareRecoverySession(url);
      })
      .catch((e) => {
        console.log("getInitialURL reset error:", e);
        setCheckingSession(false);
      });

    const sub = Linking.addEventListener("url", (event) => {
      void prepareRecoverySession(event.url);
    });

    return () => {
      alive = false;
      sub.remove();
    };
  }, [prepareRecoverySession]);

  const onUpdatePassword = useCallback(async () => {
    if (loading) return;

    const cleanedPassword = password.trim();
    const cleanedConfirmPassword = confirmPassword.trim();

    const passwordError = validatePassword(cleanedPassword);
    if (passwordError) {
      Alert.alert(t("common.error", "Error"), passwordError);
      return;
    }

    if (cleanedPassword !== cleanedConfirmPassword) {
      Alert.alert(
        t("common.error", "Error"),
        t("auth.resetPassword.mismatch", "Passwords do not match.")
      );
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase.auth.updateUser({
        password: cleanedPassword,
      });

      if (error) {
        Alert.alert(t("common.error", "Error"), error.message);
        return;
      }

      Alert.alert(
        t("common.success", "Success"),
        t("auth.resetPassword.updated", "Your password has been updated."),
        [
          {
            text: t("common.ok", "OK"),
            onPress: async () => {
              await clearSelectedRole();
              await supabase.auth.signOut();
              navigation.reset({
                index: 0,
                routes: [{ name: "RoleSelect" }],
              });
            },
          },
        ]
      );
    } finally {
      setLoading(false);
    }
  }, [password, confirmPassword, loading, navigation, t]);

  if (checkingSession) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: "#020617",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color="white" />
        <Text
          style={{
            color: "#9CA3AF",
            marginTop: 12,
            fontWeight: "700",
            textAlign: textAlignStart(),
          }}
        >
          {t("auth.resetPassword.preparingLink", "Preparing link...")}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ padding: 16, marginTop: 40 }}>
          <Text
            style={{
              color: "white",
              fontSize: 28,
              fontWeight: "900",
              textAlign: textAlignStart(),
            }}
          >
            {t("auth.resetPassword.newTitle", "New password")}
          </Text>

          <Text
            style={{
              color: "#9CA3AF",
              marginTop: 10,
              fontSize: 15,
              lineHeight: 22,
              fontWeight: "700",
              textAlign: textAlignStart(),
            }}
          >
            {t(
              "auth.resetPassword.newSubtitle",
              "Enter your new password to recover your MMD Delivery account."
            )}
          </Text>

          <View style={{ marginTop: 24 }}>
            <Text style={{ color: "#9CA3AF", fontWeight: "900", textAlign: textAlignStart() }}>
              {t("auth.resetPassword.password", "Password")}
            </Text>
            <View
              style={{
                marginTop: 8,
                borderRadius: 14,
                backgroundColor: "#0B1220",
                borderWidth: 1,
                borderColor: "#111827",
                flexDirection: rowDirection(),
                alignItems: "center",
              }}
            >
              <TextInput
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                placeholder={t("auth.resetPassword.newPasswordPlaceholder", "New password")}
                placeholderTextColor="#475569"
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  flex: 1,
                  padding: 14,
                  color: "white",
                  textAlign: textAlignStart(),
                }}
              />

              <TouchableOpacity
                onPress={() => setShowPassword((value) => !value)}
                activeOpacity={0.85}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                }}
              >
                <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
                  {showPassword
                    ? t("auth.resetPassword.hide", "Hide")
                    : t("auth.resetPassword.show", "Show")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ marginTop: 16 }}>
            <Text style={{ color: "#9CA3AF", fontWeight: "900", textAlign: textAlignStart() }}>
              {t("auth.resetPassword.confirmPassword", "Confirm password")}
            </Text>
            <View
              style={{
                marginTop: 8,
                borderRadius: 14,
                backgroundColor: "#0B1220",
                borderWidth: 1,
                borderColor: "#111827",
                flexDirection: rowDirection(),
                alignItems: "center",
              }}
            >
              <TextInput
                secureTextEntry={!showConfirmPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder={t("auth.resetPassword.confirmPlaceholder", "Confirm password")}
                placeholderTextColor="#475569"
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  flex: 1,
                  padding: 14,
                  color: "white",
                  textAlign: textAlignStart(),
                }}
              />

              <TouchableOpacity
                onPress={() => setShowConfirmPassword((value) => !value)}
                activeOpacity={0.85}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                }}
              >
                <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
                  {showConfirmPassword
                    ? t("auth.resetPassword.hide", "Hide")
                    : t("auth.resetPassword.show", "Show")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => void onUpdatePassword()}
            disabled={loading}
            activeOpacity={0.85}
            style={{
              marginTop: 26,
              backgroundColor: loading ? "#111827" : "#2563EB",
              padding: 15,
              borderRadius: 14,
              alignItems: "center",
            }}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "white", fontWeight: "900", fontSize: 16 }}>
                {t("auth.resetPassword.update", "Update password")}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() =>
              navigation.reset({
                index: 0,
                routes: [{ name: "RoleSelect" }],
              })
            }
            style={{ marginTop: 18, alignItems: "center" }}
          >
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
              {t("common.back", "Back")}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
