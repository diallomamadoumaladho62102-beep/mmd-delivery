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

const RESET_PASSWORD_URL =
  "https://mmd-delivery.vercel.app/auth/reset-password";

function cleanEmail(value: string) {
  return (value || "").trim().toLowerCase();
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  return fallback;
}

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
            "Crée ton compte restaurant puis complète ton profil."
          ),
    [mode, t]
  );

  async function ensureRestaurantAccount(params: {
    userId: string;
    email: string;
    createRestaurantProfileIfMissing?: boolean;
  }) {
    const { userId, email: userEmail, createRestaurantProfileIfMissing = true } =
      params;

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        id: userId,
        role: "restaurant",
        email: userEmail,
      },
      { onConflict: "id" }
    );

    if (profileError) {
      throw new Error(profileError.message);
    }

    const { data: existingRestaurantProfile, error: existingError } =
      await supabase
        .from("restaurant_profiles")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (!existingRestaurantProfile && createRestaurantProfileIfMissing) {
      const { error: restaurantError } = await supabase
        .from("restaurant_profiles")
        .insert({
          user_id: userId,
          email: userEmail,
          status: "pending",
          offers_delivery: true,
          offers_pickup: true,
          offers_dine_in: false,
          is_accepting_orders: false,
        });

      if (restaurantError) {
        throw new Error(restaurantError.message);
      }
    }
  }

  async function signIn() {
    if (loading) return;

    const e = cleanEmail(email);
    const p = password.trim();

    if (!e) {
      setMsg(t("restaurant.auth.errors.emailRequired", "❌ Email obligatoire"));
      return;
    }

    if (!p) {
      setMsg(
        t(
          "restaurant.auth.errors.passwordRequired",
          "❌ Mot de passe obligatoire"
        )
      );
      return;
    }

    setLoading(true);
    setMsg(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: e,
        password: p,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data.session) {
        throw new Error(
          t(
            "restaurant.auth.errors.sessionNotCreated",
            "Session non créée. Réessaie."
          )
        );
      }

      const userId = data.user?.id;

      if (userId) {
        await ensureRestaurantAccount({
          userId,
          email: e,
          createRestaurantProfileIfMissing: false,
        });
      }

      setMsg(t("restaurant.auth.success.signedIn", "✅ Connecté !"));
    } catch (error: unknown) {
      setMsg(
        t("restaurant.auth.errors.signinFailed", "❌ Connexion impossible : ") +
          getErrorMessage(error, "Erreur inconnue")
      );
    } finally {
      setLoading(false);
    }
  }

  async function signUp() {
    if (loading) return;

    const e = cleanEmail(email);
    const p = password.trim();

    if (!e) {
      setMsg(t("restaurant.auth.errors.emailRequired", "❌ Email obligatoire"));
      return;
    }

    if (!p) {
      setMsg(
        t(
          "restaurant.auth.errors.passwordRequired",
          "❌ Mot de passe obligatoire"
        )
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
      const { data, error } = await supabase.auth.signUp({
        email: e,
        password: p,
        options: {
          data: {
            role: "restaurant",
          },
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      const userId = data.user?.id;

      if (!userId) {
        throw new Error(
          t(
            "restaurant.auth.errors.userNotCreated",
            "Compte créé, mais impossible de récupérer l’utilisateur."
          )
        );
      }

      await ensureRestaurantAccount({
        userId,
        email: e,
        createRestaurantProfileIfMissing: true,
      });

      if (!data.session) {
        setMsg(
          t(
            "restaurant.auth.success.createdCheckEmail",
            "✅ Compte créé. Vérifie ton email puis connecte-toi."
          )
        );
        setMode("login");
        return;
      }

      setMsg(
        t(
          "restaurant.auth.success.createdAndSignedIn",
          "✅ Compte restaurant créé et connecté !"
        )
      );
    } catch (error: unknown) {
      setMsg(
        t(
          "restaurant.auth.errors.signupFailed",
          "❌ Création du compte impossible : "
        ) + getErrorMessage(error, "Erreur inconnue")
      );
    } finally {
      setLoading(false);
    }
  }

  async function forgotPassword() {
    if (loading) return;

    const e = cleanEmail(email);

    if (!e) {
      setMsg(
        t(
          "restaurant.auth.errors.emailRequiredForReset",
          "❌ Entre ton email avant de demander la réinitialisation."
        )
      );
      return;
    }

    setLoading(true);
    setMsg(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(e, {
        redirectTo: RESET_PASSWORD_URL,
      });

      if (error) {
        throw new Error(error.message);
      }

      setMsg(
        t(
          "restaurant.auth.success.resetEmailSent",
          "✅ Email envoyé. Clique sur le lien reçu pour modifier ton mot de passe."
        )
      );
    } catch (error: unknown) {
      setMsg(
        t(
          "restaurant.auth.errors.resetFailed",
          "❌ Impossible d’envoyer l’email : "
        ) + getErrorMessage(error, "Erreur inconnue")
      );
    } finally {
      setLoading(false);
    }
  }

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
        ? t(
            "restaurant.auth.actions.switchToSignup",
            "Je n’ai pas de compte → Créer un compte"
          )
        : t(
            "restaurant.auth.actions.switchToLogin",
            "J’ai déjà un compte → Se connecter"
          ),
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
          contentContainerStyle={{
            flexGrow: 1,
            padding: 24,
            justifyContent: "center",
          }}
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

            <Text
              style={{
                color: "#9CA3AF",
                fontWeight: "900",
                marginBottom: 8,
              }}
            >
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
              editable={!loading}
              style={{
                backgroundColor: "#111827",
                color: "white",
                padding: 12,
                borderRadius: 10,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: "#1f2937",
                opacity: loading ? 0.8 : 1,
              }}
            />

            <Text
              style={{
                color: "#9CA3AF",
                fontWeight: "900",
                marginBottom: 8,
              }}
            >
              {passwordLabel}
            </Text>

            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={passwordPlaceholder}
              placeholderTextColor="#94A3B8"
              secureTextEntry
              autoCorrect={false}
              editable={!loading}
              style={{
                backgroundColor: "#111827",
                color: "white",
                padding: 12,
                borderRadius: 10,
                marginBottom: mode === "login" ? 8 : 12,
                borderWidth: 1,
                borderColor: "#1f2937",
                opacity: loading ? 0.8 : 1,
              }}
            />

            {mode === "login" ? (
              <TouchableOpacity
                disabled={loading}
                onPress={forgotPassword}
                style={{
                  alignItems: "flex-end",
                  marginBottom: 12,
                  paddingVertical: 4,
                  opacity: loading ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
                  {t(
                    "restaurant.auth.actions.forgotPassword",
                    "Mot de passe oublié ?"
                  )}
                </Text>
              </TouchableOpacity>
            ) : null}

            {!!msg && (
              <Text
                style={{
                  color: msg.startsWith("❌") ? "#FCA5A5" : "#93C5FD",
                  marginBottom: 12,
                  fontWeight: "700",
                  lineHeight: 18,
                }}
              >
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
                setMode((currentMode) =>
                  currentMode === "login" ? "signup" : "login"
                );
              }}
              style={{
                paddingVertical: 10,
                alignItems: "center",
                opacity: loading ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
                {secondaryLabel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={loading}
              onPress={() =>
                Alert.alert(
                  t("restaurant.auth.debug.title", "Info"),
                  t(
                    "restaurant.auth.debug.note",
                    "Si la confirmation email est activée dans Supabase, tu dois confirmer ton email avant de te connecter."
                  )
                )
              }
              style={{
                marginTop: 8,
                alignItems: "center",
                opacity: loading ? 0.6 : 1,
              }}
            >
              <Text
                style={{
                  color: "#64748B",
                  fontWeight: "800",
                  fontSize: 12,
                }}
              >
                {t("restaurant.auth.debug.help", "Besoin d’aide ?")}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default RestaurantAuthScreen;