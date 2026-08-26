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
  Image,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { SafeLinearGradient as LinearGradient } from "../components/SafeLinearGradient";
import * as Linking from "expo-linking";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { validatePassword } from "../lib/authValidation";
import { clearSelectedRole } from "../lib/authRole";
import { rowDirection, textAlignStart } from "../i18n/rtl";
import { BOOT_AUTH_TIMEOUT_MS } from "../lib/bootFailOpen";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD,
  MMD_WHITE,
  mmdLogoSize,
} from "../theme/mmdUi";

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

    const failOpenTimer = setTimeout(() => {
      if (!alive) return;
      setCheckingSession(false);
    }, BOOT_AUTH_TIMEOUT_MS);

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
      clearTimeout(failOpenTimer);
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

  const { width, height } = useWindowDimensions();
  const logoSize = mmdLogoSize(width, height);

  if (checkingSession) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: MMD_BLUE,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
      >
        <Image
          source={require("../../assets/brand/mmd-logo-ui.png")}
          style={{
            width: Math.min(140, logoSize + 40),
            height: Math.min(140, logoSize + 40),
            borderRadius: Math.min(140, logoSize + 40) / 2,
            marginBottom: 16,
          }}
          resizeMode="contain"
          accessibilityLabel="MMD Delivery"
        />
        <Text
          style={{
            color: MMD_GOLD,
            fontSize: 28,
            fontFamily: MMD_FONT.extrabold,
            fontWeight: "800",
            letterSpacing: 1,
            marginBottom: 8,
          }}
        >
          MMD DELIVERY
        </Text>
        <Text
          style={{
            color: MMD_WHITE,
            fontSize: 16,
            fontFamily: MMD_FONT.semibold,
            fontWeight: "600",
            marginBottom: 24,
          }}
        >
          {t("brand.tagline", "We Deliver With Heart ❤️")}
        </Text>
        <ActivityIndicator color={MMD_WHITE} />
        <Text
          style={{
            color: MMD_WHITE,
            marginTop: 12,
            fontFamily: MMD_FONT.bold,
            fontWeight: "700",
            textAlign: "center",
          }}
        >
          {t("auth.resetPassword.preparingLink", "Preparing link...")}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: MMD_BLUE }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            marginTop: 24,
            maxWidth: 560,
            width: "100%",
            alignSelf: "center",
            flexGrow: 1,
            justifyContent: "flex-start",
            paddingBottom: 40,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: "center", height: 100, marginBottom: 16 }}>
            <Image
              source={require("../../assets/brand/mmd-logo-ui.png")}
              style={{
                width: logoSize,
                height: logoSize,
                borderRadius: logoSize / 2,
              }}
              resizeMode="contain"
              accessibilityLabel="MMD Delivery"
            />
          </View>

          <Text
            style={{
              color: MMD_WHITE,
              fontSize: 36,
              fontFamily: MMD_FONT.bold,
              fontWeight: "700",
              textAlign: textAlignStart(),
            }}
          >
            {t("auth.resetPassword.newTitle", "New password")}
          </Text>

          <Text
            style={{
              color: MMD_WHITE,
              marginTop: 10,
              fontSize: 16,
              lineHeight: 22,
              fontFamily: MMD_FONT.regular,
              fontWeight: "400",
              textAlign: textAlignStart(),
            }}
          >
            {t(
              "auth.resetPassword.newSubtitle",
              "Enter your new password to recover your MMD Delivery account.",
            )}
          </Text>

          <View style={{ marginTop: 24 }}>
            <Text
              style={{
                color: MMD_WHITE,
                fontFamily: MMD_FONT.semibold,
                fontWeight: "600",
                fontSize: 17,
                textTransform: "uppercase",
                textAlign: textAlignStart(),
              }}
            >
              {t("auth.resetPassword.password", "Password")}
            </Text>
            <View
              style={{
                marginTop: 8,
                borderRadius: 10,
                backgroundColor: "rgba(255,255,255,0.1)",
                borderWidth: 2.5,
                borderColor: MMD_WHITE,
                flexDirection: rowDirection(),
                alignItems: "center",
              }}
            >
              <TextInput
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                placeholder={t(
                  "auth.resetPassword.newPasswordPlaceholder",
                  "New password",
                )}
                placeholderTextColor="rgba(255,255,255,0.55)"
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  flex: 1,
                  padding: 14,
                  color: MMD_WHITE,
                  fontSize: 18,
                  fontFamily: MMD_FONT.regular,
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
                <Text
                  style={{
                    color: MMD_WHITE,
                    fontFamily: MMD_FONT.extrabold,
                    fontWeight: "800",
                  }}
                >
                  {showPassword
                    ? t("auth.resetPassword.hide", "Hide")
                    : t("auth.resetPassword.show", "Show")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ marginTop: 16 }}>
            <Text
              style={{
                color: MMD_WHITE,
                fontFamily: MMD_FONT.semibold,
                fontWeight: "600",
                fontSize: 17,
                textTransform: "uppercase",
                textAlign: textAlignStart(),
              }}
            >
              {t("auth.resetPassword.confirmPassword", "Confirm password")}
            </Text>
            <View
              style={{
                marginTop: 8,
                borderRadius: 10,
                backgroundColor: "rgba(255,255,255,0.1)",
                borderWidth: 2.5,
                borderColor: MMD_WHITE,
                flexDirection: rowDirection(),
                alignItems: "center",
              }}
            >
              <TextInput
                secureTextEntry={!showConfirmPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder={t(
                  "auth.resetPassword.confirmPlaceholder",
                  "Confirm password",
                )}
                placeholderTextColor="rgba(255,255,255,0.55)"
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  flex: 1,
                  padding: 14,
                  color: MMD_WHITE,
                  fontSize: 18,
                  fontFamily: MMD_FONT.regular,
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
                <Text
                  style={{
                    color: MMD_WHITE,
                    fontFamily: MMD_FONT.extrabold,
                    fontWeight: "800",
                  }}
                >
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
              borderRadius: 16,
              overflow: "hidden",
              opacity: loading ? 0.7 : 1,
            }}
          >
            <LinearGradient
              colors={["#93C5FD", "#3B82F6", "#93C5FD"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{
                padding: 16,
                minHeight: 60,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {loading ? (
                <ActivityIndicator color="#1A0D00" />
              ) : (
                <Text
                  style={{
                    color: "#1A0D00",
                    fontFamily: MMD_FONT.bold,
                    fontWeight: "700",
                    fontSize: 20,
                  }}
                >
                  {t("auth.resetPassword.update", "Update password")}
                </Text>
              )}
            </LinearGradient>
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
            <Text
              style={{
                color: MMD_WHITE,
                fontFamily: MMD_FONT.bold,
                fontWeight: "700",
                fontSize: 18,
              }}
            >
              {t("common.back", "Back")}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
