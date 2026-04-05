import React, { useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

export function RestaurantAuthScreen() {
  const { t } = useTranslation();

  const [mode, setMode] = useState<"login" | "signup">("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const title = useMemo(
    () =>
      mode === "login"
        ? t("restaurant.auth.titleLogin", "Connexion Restaurant")
        : t("restaurant.auth.titleSignup", "Créer un compte Restaurant"),
    [mode, t]
  );

  const subtitle = useMemo(
    () =>
      mode === "login"
        ? t(
            "restaurant.auth.subtitleLogin",
            "Connecte-toi avec ton compte restaurant."
          )
        : t(
            "restaurant.auth.subtitleSignup",
            "Crée ton compte restaurant puis connecte-toi."
          ),
    [mode, t]
  );

  const cleanEmail = (v: string) => (v || "").trim().toLowerCase();

  const signIn = async () => {
    if (loading) return;

    const e = cleanEmail(email);
    const p = (password || "").trim();

    if (!e) {
      setMsg(t("restaurant.auth.errors.emailRequired", "❌ Email obligatoire"));
      return;
    }
    if (!p) {
      setMsg(
        t("restaurant.auth.errors.passwordRequired", "❌ Mot de passe obligatoire")
      );
      return;
    }

    setLoading(true);
    setMsg(null);

    try {
      console.log("🟩 SIGNIN start", e);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: e,
        password: p,
      });

      console.log("🟩 SIGNIN data:", data);
      console.log("🟥 SIGNIN error:", error);

      if (error) {
        setMsg(
          t("restaurant.auth.errors.signinFailed", "❌ ") + (error.message || "")
        );
      } else {
        setMsg(t("restaurant.auth.success.signedIn", "✅ Connecté !"));
      }
    } catch (err: any) {
      console.log("🟥 SIGNIN exception:", err);
      setMsg(
        t("restaurant.auth.errors.unknown", "❌ ") +
          (err?.message ?? "Erreur inconnue")
      );
    } finally {
      setLoading(false);
    }
  };

  const signUp = async () => {
    if (loading) return;

    const e = cleanEmail(email);
    const p = (password || "").trim();

    if (!e) {
      setMsg(t("restaurant.auth.errors.emailRequired", "❌ Email obligatoire"));
      return;
    }
    if (!p) {
      setMsg(
        t("restaurant.auth.errors.passwordRequired", "❌ Mot de passe obligatoire")
      );
      return;
    }
    if (p.length < 6) {
      setMsg(
        t(
          "restaurant.auth.errors.passwordTooShort",
          "❌ Mot de passe trop court (min 6 caractères)"
        )
      );
      return;
    }

    setLoading(true);
    setMsg(null);

    try {
      console.log("🟦 SIGNUP start", e);

      const { data, error } = await supabase.auth.signUp({
        email: e,
        password: p,
        options: {
          data: {
            role: "restaurant",
          },
        },
      });

      console.log("🟦 SIGNUP data:", data);
      console.log("🟥 SIGNUP error:", error);

      if (error) {
        setMsg(t("restaurant.auth.errors.signupFailed", "❌ ") + error.message);
        return;
      }

      // Si Confirm Email est ON, Supabase renvoie souvent session=null
      if (!data?.session) {
        setMsg(
          t(
            "restaurant.auth.success.createdCheckEmail",
            "✅ Compte créé. Vérifie ton email (confirmation) puis connecte-toi."
          )
        );
        setMode("login");
      } else {
        setMsg(t("restaurant.auth.success.createdAndSignedIn", "✅ Compte créé et connecté !"));
      }
    } catch (err: any) {
      console.log("🟥 SIGNUP exception:", err);
      setMsg(
        t("restaurant.auth.errors.unknown", "❌ ") +
          (err?.message ?? "Erreur inconnue")
      );
    } finally {
      setLoading(false);
    }
  };

  const primaryLabel = useMemo(
    () =>
      mode === "login"
        ? t("restaurant.auth.actions.signIn", "Se connecter")
        : t("restaurant.auth.actions.signUp", "Créer un compte"),
    [mode, t]
  );

  const secondaryLabel = useMemo(
    () =>
      mode === "login"
        ? t("restaurant.auth.actions.switchToSignup", "Je n’ai pas de compte → Créer un compte")
        : t("restaurant.auth.actions.switchToLogin", "J’ai déjà un compte → Se connecter"),
    [mode, t]
  );

  const emailLabel = t("restaurant.auth.fields.email", "Email");
  const passwordLabel = t("restaurant.auth.fields.password", "Mot de passe");
  const passwordPlaceholder = t(
    "restaurant.auth.placeholders.password",
    "Mot de passe (min 6)"
  );

  const onPrimary = mode === "login" ? signIn : signUp;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0b1220" }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: "center" }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text
              style={{
                color: "white",
                fontSize: 22,
                fontWeight: "700",
                marginBottom: 8,
              }}
            >
              {title}
            </Text>

            <Text
              style={{
                color: "#94A3B8",
                fontSize: 13,
                fontWeight: "700",
                marginBottom: 16,
                lineHeight: 18,
              }}
            >
              {subtitle}
            </Text>

            <Text style={{ color: "#9CA3AF", fontWeight: "900", marginBottom: 8 }}>
              {emailLabel}
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t("restaurant.auth.placeholders.email", "Email")}
              placeholderTextColor="#94A3B8"
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
              style={{
                backgroundColor: "#111827",
                color: "white",
                padding: 12,
                borderRadius: 10,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: "#1f2937",
              }}
            />

            <Text style={{ color: "#9CA3AF", fontWeight: "900", marginBottom: 8 }}>
              {passwordLabel}
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={passwordPlaceholder}
              placeholderTextColor="#94A3B8"
              secureTextEntry
              autoCorrect={false}
              style={{
                backgroundColor: "#111827",
                color: "white",
                padding: 12,
                borderRadius: 10,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: "#1f2937",
              }}
            />

            {!!msg && (
              <Text style={{ color: "#93C5FD", marginBottom: 12, fontWeight: "700" }}>
                {msg}
              </Text>
            )}

            <TouchableOpacity
              disabled={loading}
              onPress={onPrimary}
              style={{
                backgroundColor: mode === "login" ? "#22C55E" : "#0EA5E9",
                paddingVertical: 12,
                borderRadius: 12,
                alignItems: "center",
                marginBottom: 10,
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={{ color: "white", fontWeight: "800" }}>
                  {primaryLabel}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              disabled={loading}
              onPress={() => {
                setMsg(null);
                setMode((m) => (m === "login" ? "signup" : "login"));
              }}
              style={{ paddingVertical: 10, alignItems: "center" }}
            >
              <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
                {secondaryLabel}
              </Text>
            </TouchableOpacity>

            {/* Petit rappel pour dev/debug */}
            <TouchableOpacity
              onPress={() =>
                Alert.alert(
                  t("restaurant.auth.debug.title", "Info"),
                  t(
                    "restaurant.auth.debug.note",
                    "Si la confirmation email est activée dans Supabase, tu dois confirmer ton email avant de te connecter."
                  )
                )
              }
              style={{ marginTop: 8, alignItems: "center" }}
            >
              <Text style={{ color: "#64748B", fontWeight: "800", fontSize: 12 }}>
                {t("restaurant.auth.debug.help", "Besoin d’aide ?")}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
