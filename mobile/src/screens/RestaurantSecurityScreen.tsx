// apps/mobile/src/screens/RestaurantSecurityScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

export function RestaurantSecurityScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

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
          "Your session is missing. Please log in again."
        )
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
          "Password must contain at least 8 characters."
        )
      );
      return;
    }

    if (p1 !== p2) {
      Alert.alert(
        t("restaurant.security.passwordTitle", "Password"),
        t(
          "restaurant.security.mismatch",
          "The two passwords do not match."
        )
      );
      return;
    }

    try {
      setSaving(true);

      const { error } = await supabase.auth.updateUser({ password: p1 });
      if (error) {
        Alert.alert(
          t("restaurant.security.errorTitle", "Error"),
          error.message
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
          "Your password has been updated successfully."
        ),
        [{ text: t("common.ok", "OK"), onPress: () => navigation.goBack() }]
      );
    } catch (e: any) {
      console.log("restaurant updateUser password error:", e);
      Alert.alert(
        t("restaurant.security.errorTitle", "Error"),
        e?.message ??
          t(
            "restaurant.security.genericError",
            "Unable to update password."
          )
      );
    } finally {
      setSaving(false);
    }
  }, [saving, hasUser, newPassword, confirm, navigation, t]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <View style={{ padding: 16 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
            {t("common.back", "Back")}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "white", fontSize: 20, fontWeight: "900", marginTop: 14 }}>
          {t("restaurant.security.title", "Security")}
        </Text>

        <View
          style={{
            marginTop: 14,
            backgroundColor: "#0B1220",
            borderColor: "#111827",
            borderWidth: 1,
            borderRadius: 18,
            padding: 14,
          }}
        >
          <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
            {t("restaurant.security.accountLabel", "Restaurant account")}
          </Text>
          <Text style={{ color: "white", fontWeight: "900", marginTop: 6 }}>
            {email || "—"}
          </Text>

          <View style={{ height: 16 }} />

          <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
            {t("restaurant.security.newPasswordLabel", "New password")}
          </Text>

          <View
            style={{
              marginTop: 8,
              backgroundColor: "#0A1730",
              borderColor: "#111827",
              borderWidth: 1,
              borderRadius: 14,
              paddingHorizontal: 12,
              paddingVertical: 12,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="********"
              placeholderTextColor="#64748B"
              secureTextEntry={!showNew}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                flex: 1,
                color: "white",
                fontWeight: "800",
              }}
            />

            <TouchableOpacity onPress={() => setShowNew((v) => !v)} activeOpacity={0.85}>
              <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
                {showNew
                  ? t("restaurant.security.hide", "Hide")
                  : t("restaurant.security.show", "Show")}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 12 }} />

          <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
            {t("restaurant.security.confirmLabel", "Confirm password")}
          </Text>

          <View
            style={{
              marginTop: 8,
              backgroundColor: "#0A1730",
              borderColor: "#111827",
              borderWidth: 1,
              borderRadius: 14,
              paddingHorizontal: 12,
              paddingVertical: 12,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder="********"
              placeholderTextColor="#64748B"
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                flex: 1,
                color: "white",
                fontWeight: "800",
              }}
            />

            <TouchableOpacity
              onPress={() => setShowConfirm((v) => !v)}
              activeOpacity={0.85}
            >
              <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
                {showConfirm
                  ? t("restaurant.security.hide", "Hide")
                  : t("restaurant.security.show", "Show")}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 16 }} />

          <TouchableOpacity
            onPress={onSave}
            disabled={!canSubmit}
            activeOpacity={0.85}
            style={{
              backgroundColor: "#1D4ED8",
              borderRadius: 14,
              paddingVertical: 14,
              alignItems: "center",
              opacity: canSubmit ? 1 : 0.55,
            }}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "white", fontWeight: "900" }}>
                {t("restaurant.security.save", "Save new password")}
              </Text>
            )}
          </TouchableOpacity>

          <Text
            style={{
              color: "#64748B",
              fontWeight: "800",
              marginTop: 10,
              lineHeight: 18,
            }}
          >
            {t(
              "restaurant.security.tip",
              "Use a strong password with at least 8 characters."
            )}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}