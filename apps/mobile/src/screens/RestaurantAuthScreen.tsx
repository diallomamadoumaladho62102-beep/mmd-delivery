import { toUserFacingError } from "../lib/userFacingError";
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
import { validatePassword } from "../lib/authValidation";

import { getResetPasswordRedirectUrl } from "../lib/productionSite";
import LegalSignupLinks from "../components/LegalSignupLinks";

const RESET_PASSWORD_URL = getResetPasswordRedirectUrl();

type GeocodedAddress = {
  latitude: number;
  longitude: number;
  formattedAddress: string;
};

function cleanEmail(value: string) {
  return (value || "").trim().toLowerCase();
}

function cleanText(value: string) {
  return (value || "").trim();
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  return fallback;
}

function isValidCoordinate(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

async function geocodeRestaurantAddress(address: string): Promise<GeocodedAddress> {
  const cleanAddress = cleanText(address);

  if (!cleanAddress) {
    throw new Error("Adresse du restaurant obligatoire.");
  }

  const { geocodeAddressViaApi } = await import("../lib/serverGeocode");
  const result = await geocodeAddressViaApi(cleanAddress);

  const latitude = result.latitude;
  const longitude = result.longitude;

  if (!isValidCoordinate(latitude, longitude)) {
    throw new Error(
      "Adresse introuvable. Entre une adresse complète avec ville, État et ZIP code."
    );
  }

  return {
    latitude,
    longitude,
    formattedAddress: result.formattedAddress,
  };
}

export function RestaurantAuthScreen() {
  const { t } = useTranslation();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantAddress, setRestaurantAddress] = useState("");

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
        ? t("restaurant.auth.subtitleLogin", "Connecte-toi avec ton compte restaurant.")
        : t("restaurant.auth.subtitleSignup", "Crée ton compte restaurant avec son adresse complète."),
    [mode, t]
  );

  async function ensureRestaurantAccount(params: {
    userId: string;
    email: string;
    createRestaurantProfileIfMissing?: boolean;
    allowCreateRestaurantRole?: boolean;
    restaurantName?: string;
    restaurantAddress?: string;
    locationLat?: number;
    locationLng?: number;
  }) {
    const {
      userId,
      email: userEmail,
      createRestaurantProfileIfMissing = true,
      allowCreateRestaurantRole = false,
      restaurantName: nextRestaurantName,
      restaurantAddress: nextRestaurantAddress,
      locationLat,
      locationLng,
    } = params;

    const { data: existingProfile, error: existingProfileError } = await supabase
      .from("profiles")
      .select("id,email,role")
      .eq("id", userId)
      .maybeSingle();

    if (existingProfileError) throw new Error(existingProfileError.message);

    const existingRole = String((existingProfile as any)?.role ?? "").trim().toLowerCase();

    if (existingRole && existingRole !== "restaurant") {
      throw new Error(
        existingRole === "driver"
          ? t("restaurant.auth.errors.accountIsDriver", "Ce compte est enregistré comme chauffeur. Connecte-toi depuis la section Driver.")
          : existingRole === "client"
            ? t("restaurant.auth.errors.accountIsClient", "Ce compte est enregistré comme client. Connecte-toi depuis la section Client.")
            : t("restaurant.auth.errors.accountWrongRole", "Ce compte n’est pas un compte restaurant.")
      );
    }

    if (!existingProfile) {
      if (!allowCreateRestaurantRole) {
        throw new Error(
          t("restaurant.auth.errors.notRestaurantAccount", "Ce compte n’est pas encore configuré comme restaurant.")
        );
      }

      const { error } = await supabase.from("profiles").insert({
        id: userId,
        role: "restaurant",
        email: userEmail,
      });

      if (error) throw new Error(toUserFacingError(error, "Une action temporairement impossible s'est produite. Veuillez réessayer."));
    } else {
      const { error } = await supabase
        .from("profiles")
        .update({ email: userEmail })
        .eq("id", userId)
        .eq("role", "restaurant");

      if (error) throw new Error(toUserFacingError(error, "Une action temporairement impossible s'est produite. Veuillez réessayer."));
    }

    const { data: existingRestaurantProfile, error: existingRestaurantError } =
      await supabase
        .from("restaurant_profiles")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

    if (existingRestaurantError) throw new Error(existingRestaurantError.message);

    if (!existingRestaurantProfile && createRestaurantProfileIfMissing) {
      if (
        !nextRestaurantName ||
        !nextRestaurantAddress ||
        locationLat === undefined ||
        locationLng === undefined
      ) {
        throw new Error(
          t("restaurant.auth.errors.restaurantAddressRequired", "Nom et adresse complète du restaurant obligatoires.")
        );
      }

      const { error } = await supabase.from("restaurant_profiles").insert({
        user_id: userId,
        email: userEmail,
        restaurant_name: nextRestaurantName,
        address: nextRestaurantAddress,
        location_lat: locationLat,
        location_lng: locationLng,
        status: "pending",
        offers_delivery: true,
        offers_pickup: true,
        offers_dine_in: false,
        is_accepting_orders: false,
      });

      if (error) throw new Error(toUserFacingError(error, "Une action temporairement impossible s'est produite. Veuillez réessayer."));
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
      setMsg(t("restaurant.auth.errors.passwordRequired", "❌ Mot de passe obligatoire"));
      return;
    }

    setLoading(true);
    setMsg(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: e,
        password: p,
      });

      if (error) throw new Error(toUserFacingError(error, "Une action temporairement impossible s'est produite. Veuillez réessayer."));

      if (!data.session) {
        throw new Error(
          t("restaurant.auth.errors.sessionNotCreated", "Session non créée. Réessaie.")
        );
      }

      if (data.user?.id) {
        await ensureRestaurantAccount({
          userId: data.user.id,
          email: e,
          createRestaurantProfileIfMissing: false,
          allowCreateRestaurantRole: false,
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
    const name = cleanText(restaurantName);
    const address = cleanText(restaurantAddress);

    if (!e) {
      setMsg(t("restaurant.auth.errors.emailRequired", "❌ Email obligatoire"));
      return;
    }

    if (!p) {
      setMsg(t("restaurant.auth.errors.passwordRequired", "❌ Mot de passe obligatoire"));
      return;
    }

    const passwordError = validatePassword(p);
    if (passwordError) {
      setMsg(passwordError);
      return;
    }

    if (!name) {
      setMsg(t("restaurant.auth.errors.restaurantNameRequired", "❌ Nom du restaurant obligatoire"));
      return;
    }

    if (!address) {
      setMsg(
        t("restaurant.auth.errors.restaurantAddressRequired", "❌ Adresse complète du restaurant obligatoire")
      );
      return;
    }

    setLoading(true);
    setMsg(null);

    try {
      const geocoded = await geocodeRestaurantAddress(address);

      const { data, error } = await supabase.auth.signUp({
        email: e,
        password: p,
        options: {
          data: {
            role: "restaurant",
          },
        },
      });

      if (error) throw new Error(toUserFacingError(error, "Une action temporairement impossible s'est produite. Veuillez réessayer."));

      const userId = data.user?.id;

      if (!userId) {
        throw new Error(
          t("restaurant.auth.errors.userNotCreated", "Compte créé, mais impossible de récupérer l’utilisateur.")
        );
      }

      await ensureRestaurantAccount({
        userId,
        email: e,
        createRestaurantProfileIfMissing: true,
        allowCreateRestaurantRole: true,
        restaurantName: name,
        restaurantAddress: geocoded.formattedAddress,
        locationLat: geocoded.latitude,
        locationLng: geocoded.longitude,
      });

      if (!data.session) {
        setMsg(
          t("restaurant.auth.success.createdCheckEmail", "✅ Compte créé. Vérifie ton email puis connecte-toi.")
        );
        setMode("login");
        return;
      }

      setMsg(
        t("restaurant.auth.success.createdAndSignedIn", "✅ Compte restaurant créé et connecté !")
      );
    } catch (error: unknown) {
      setMsg(
        t("restaurant.auth.errors.signupFailed", "❌ Création du compte impossible : ") +
          getErrorMessage(error, "Erreur inconnue")
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
        t("restaurant.auth.errors.emailRequiredForReset", "❌ Entre ton email avant de demander la réinitialisation.")
      );
      return;
    }

    setLoading(true);
    setMsg(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(e, {
        redirectTo: RESET_PASSWORD_URL,
      });

      if (error) throw new Error(toUserFacingError(error, "Une action temporairement impossible s'est produite. Veuillez réessayer."));

      setMsg(
        t("restaurant.auth.success.resetEmailSent", "✅ Email envoyé. Clique sur le lien reçu pour modifier ton mot de passe.")
      );
    } catch (error: unknown) {
      setMsg(
        t("restaurant.auth.errors.resetFailed", "❌ Impossible d’envoyer l’email : ") +
          getErrorMessage(error, "Erreur inconnue")
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
        ? t("restaurant.auth.actions.switchToSignup", "Je n’ai pas de compte → Créer un compte")
        : t("restaurant.auth.actions.switchToLogin", "J’ai déjà un compte → Se connecter"),
    [mode, t]
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
            <Text style={{ color: "white", fontSize: 22, fontWeight: "700", marginBottom: 8 }}>
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
              {t("restaurant.auth.fields.email", "Email")}
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

            <Text style={{ color: "#9CA3AF", fontWeight: "900", marginBottom: 8 }}>
              {t("restaurant.auth.fields.password", "Mot de passe")}
            </Text>

            <View style={{ position: "relative", marginBottom: mode === "login" ? 8 : 12 }}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={t("restaurant.auth.placeholders.password", "Mot de passe (min 6)")}
                placeholderTextColor="#94A3B8"
                secureTextEntry={!showPassword}
                autoCorrect={false}
                editable={!loading}
                style={{
                  backgroundColor: "#111827",
                  color: "white",
                  padding: 12,
                  paddingRight: 92,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#1f2937",
                  opacity: loading ? 0.8 : 1,
                }}
              />

              <TouchableOpacity
                disabled={loading}
                onPress={() => setShowPassword((value) => !value)}
                style={{
                  position: "absolute",
                  right: 10,
                  top: 0,
                  bottom: 0,
                  justifyContent: "center",
                  opacity: loading ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "#93C5FD", fontWeight: "900", fontSize: 12 }}>
                  {showPassword
                    ? t("restaurant.auth.actions.hidePassword", "Cacher")
                    : t("restaurant.auth.actions.showPassword", "Voir")}
                </Text>
              </TouchableOpacity>
            </View>

            {mode === "signup" ? (
              <>
                <Text style={{ color: "#9CA3AF", fontWeight: "900", marginBottom: 8 }}>
                  {t("restaurant.auth.fields.restaurantName", "Nom du restaurant")}
                </Text>

                <TextInput
                  value={restaurantName}
                  onChangeText={setRestaurantName}
                  placeholder={t("restaurant.auth.placeholders.restaurantName", "Exemple : Fouta Halal")}
                  placeholderTextColor="#94A3B8"
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

                <Text style={{ color: "#9CA3AF", fontWeight: "900", marginBottom: 8 }}>
                  {t("restaurant.auth.fields.restaurantAddress", "Adresse complète")}
                </Text>

                <TextInput
                  value={restaurantAddress}
                  onChangeText={setRestaurantAddress}
                  placeholder={t(
                    "restaurant.auth.placeholders.restaurantAddress",
                    "Exemple : 123 Main St, New York, NY 10001"
                  )}
                  placeholderTextColor="#94A3B8"
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
              </>
            ) : null}

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
                  {t("restaurant.auth.actions.forgotPassword", "Mot de passe oublié ?")}
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

            {mode === "signup" ? <LegalSignupLinks disabled={loading} /> : null}

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
                setShowPassword(false);
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

export default RestaurantAuthScreen;