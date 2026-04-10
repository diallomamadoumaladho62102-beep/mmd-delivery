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

export function DriverSecurityScreen() {
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
        Alert.alert(t("driver.security.errorTitle"), error.message);
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
        e?.message ?? t("driver.security.genericError")
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
            {t("common.back")}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "white", fontSize: 20, fontWeight: "900", marginTop: 14 }}>
          {t("driver.security.title")}
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
            {t("driver.security.accountLabel")}
          </Text>
          <Text style={{ color: "white", fontWeight: "900", marginTop: 6 }}>
            {email || "—"}
          </Text>

          <View style={{ height: 16 }} />

          <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
            {t("driver.security.newPasswordLabel")}
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
                {showNew ? t("driver.security.hide") : t("driver.security.show")}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 12 }} />

          <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
            {t("driver.security.confirmLabel")}
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
                {showConfirm ? t("driver.security.hide") : t("driver.security.show")}
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
                {t("driver.security.save")}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={{ color: "#64748B", fontWeight: "800", marginTop: 10, lineHeight: 18 }}>
            {t("driver.security.tip")}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
