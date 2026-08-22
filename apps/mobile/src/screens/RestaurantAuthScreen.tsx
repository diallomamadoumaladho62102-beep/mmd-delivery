import { toUserFacingError } from "../lib/userFacingError";
import React, { useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
  Image,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { validatePassword } from "../lib/authValidation";

import { getResetPasswordRedirectUrl } from "../lib/productionSite";
import {
  getLegalPrivacyUrl,
  getLegalTermsUrl,
  openLegalUrl,
} from "../lib/legalUrls";
import {
  AUTH_ACTION_TIMEOUT_MS,
  withTimeout,
} from "../lib/bootFailOpen";
import {
  MMD_BLUE,
  MMD_CARD_BORDER,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

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

      if (error) throw new Error(toUserFacingError(error));
    } else {
      const { error } = await supabase
        .from("profiles")
        .update({ email: userEmail })
        .eq("id", userId)
        .eq("role", "restaurant");

      if (error) throw new Error(toUserFacingError(error));
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

      if (error) throw new Error(toUserFacingError(error));
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
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: e,
          password: p,
        }),
        AUTH_ACTION_TIMEOUT_MS,
        "restaurant_signIn",
      );

      if (error) throw new Error(toUserFacingError(error));

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

      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email: e,
          password: p,
          options: {
            data: {
              role: "restaurant",
            },
          },
        }),
        AUTH_ACTION_TIMEOUT_MS,
        "restaurant_signUp",
      );

      if (error) throw new Error(toUserFacingError(error));

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
      const { error } = await withTimeout(
        supabase.auth.resetPasswordForEmail(e, {
          redirectTo: RESET_PASSWORD_URL,
        }),
        AUTH_ACTION_TIMEOUT_MS,
        "restaurant_resetPassword",
      );

      if (error) throw new Error(toUserFacingError(error));

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
        ? t("restaurant.auth.actions.signIn", "Sign In")
        : t("restaurant.auth.actions.signUp", "Create Account"),
    [mode, t]
  );

  const secondaryLabel = useMemo(
    () =>
      mode === "login"
        ? t(
            "restaurant.auth.actions.switchToSignup",
            "Don't have an account? Sign Up",
          )
        : t(
            "restaurant.auth.actions.switchToLogin",
            "Already have an account? Sign In",
          ),
    [mode, t]
  );

  const onPrimary = mode === "login" ? signIn : signUp;
  const { width } = useWindowDimensions();
  const contentMax = width >= 768 ? 560 : undefined;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            contentMax ? { maxWidth: contentMax, alignSelf: "center", width: "100%" } : null,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Image
              source={MMD_LOGO}
              style={styles.headerLogo}
              resizeMode="contain"
              accessibilityLabel="MMD Delivery"
            />
            <Text style={styles.brandTitle}>MMD Delivery</Text>
            <Text style={styles.screenTitle}>
              {mode === "login"
                ? t("restaurant.auth.titleLogin", "Restaurant Login")
                : t(
                    "restaurant.auth.titleSignup",
                    "Create Restaurant Account",
                  )}
            </Text>
          </View>

          <View style={{ height: 32 }} />

          <View style={styles.card}>
            <View style={styles.fieldBlock}>
              <View style={styles.labelRow}>
                <Text style={styles.labelEmoji}>📧</Text>
                <Text style={styles.label}>
                  {t("restaurant.auth.fields.email", "Email")}
                </Text>
              </View>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder={t("restaurant.auth.placeholders.email", "you@email.com")}
                placeholderTextColor="rgba(255,255,255,0.55)"
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                style={styles.field}
              />
            </View>

            <View style={styles.fieldBlock}>
              <View style={styles.labelRow}>
                <Text style={styles.labelEmoji}>🔒</Text>
                <Text style={styles.label}>
                  {t("restaurant.auth.fields.password", "Password")}
                </Text>
              </View>
              <View style={{ position: "relative" }}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  secureTextEntry={!showPassword}
                  autoCorrect={false}
                  style={[styles.field, { paddingRight: 72 }]}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((v) => !v)}
                  style={styles.showBtn}
                >
                  <Text style={styles.showText}>
                    {showPassword
                      ? t("restaurant.auth.actions.hidePassword", "Hide")
                      : t("restaurant.auth.actions.showPassword", "Show")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {mode === "signup" ? (
              <>
                <View style={styles.fieldBlock}>
                  <View style={styles.labelRow}>
                    <Text style={styles.labelEmoji}>🍽️</Text>
                    <Text style={styles.label}>
                      {t(
                        "restaurant.auth.fields.restaurantName",
                        "Restaurant Name",
                      )}
                    </Text>
                  </View>
                  <TextInput
                    value={restaurantName}
                    onChangeText={setRestaurantName}
                    placeholder={t(
                      "restaurant.auth.placeholders.restaurantName",
                      "Example: Fouta Halal",
                    )}
                    placeholderTextColor="rgba(255,255,255,0.55)"
                    autoCorrect={false}
                    style={styles.field}
                  />
                </View>
                <View style={styles.fieldBlock}>
                  <View style={styles.labelRow}>
                    <Text style={styles.labelEmoji}>📍</Text>
                    <Text style={styles.label}>
                      {t(
                        "restaurant.auth.fields.restaurantAddress",
                        "Full Address",
                      )}
                    </Text>
                  </View>
                  <TextInput
                    value={restaurantAddress}
                    onChangeText={setRestaurantAddress}
                    placeholder={t(
                      "restaurant.auth.placeholders.restaurantAddress",
                      "Example: 123 Main St, New York, NY 10001",
                    )}
                    placeholderTextColor="rgba(255,255,255,0.55)"
                    autoCorrect={false}
                    style={styles.field}
                  />
                </View>

                <View style={styles.termsRow}>
                  <View style={styles.checkbox}>
                    <Text style={styles.checkmark}>✓</Text>
                  </View>
                  <Text style={styles.termsText}>
                    {t("restaurant.auth.terms.prefix", "I accept the")}{" "}
                    <Text
                      style={styles.termsLink}
                      onPress={() => void openLegalUrl(getLegalTermsUrl())}
                    >
                      {t("legal.terms", "Terms")}
                    </Text>
                    {" & "}
                    <Text
                      style={styles.termsLink}
                      onPress={() => void openLegalUrl(getLegalPrivacyUrl())}
                    >
                      {t("legal.privacy", "Privacy Policy")}
                    </Text>
                  </Text>
                </View>
              </>
            ) : null}

            {mode === "login" ? (
              <TouchableOpacity onPress={() => void forgotPassword()} style={styles.forgot}>
                <Text style={[styles.linkGold, { textAlign: "right" }]}>
                  {t("restaurant.auth.actions.forgotPassword", "Forgot password?")}
                </Text>
              </TouchableOpacity>
            ) : null}

            {!!msg ? (
              <Text
                style={[
                  styles.msg,
                  { color: msg.startsWith("❌") ? "#FCA5A5" : MMD_GOLD_CLASSIC },
                ]}
              >
                {msg}
              </Text>
            ) : null}

            <TouchableOpacity
              onPress={() => void onPrimary()}
              style={styles.cta}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaText}>{primaryLabel}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setMsg(null);
                setShowPassword(false);
                setMode((m) => (m === "login" ? "signup" : "login"));
              }}
              style={styles.switchBtn}
            >
              <Text style={styles.linkGold}>{secondaryLabel}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.spacer} />

          <View style={styles.footer}>
            <Image
              source={MMD_LOGO}
              style={styles.footerLogo}
              resizeMode="contain"
              accessibilityLabel="MMD Delivery"
            />
            <Text style={styles.footerLabel}>MMD Delivery</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 44,
    paddingBottom: 24,
  },
  header: { alignItems: "center", gap: 12 },
  headerLogo: { width: 64, height: 64, borderRadius: 14 },
  brandTitle: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 24,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    textAlign: "center",
  },
  screenTitle: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    textAlign: "center",
  },
  card: {
    backgroundColor: MMD_GLASS,
    borderColor: MMD_CARD_BORDER,
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    gap: 20,
  },
  fieldBlock: { gap: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  labelEmoji: { fontSize: 18 },
  label: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: MMD_CARD_BORDER,
    backgroundColor: MMD_GLASS,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: {
    color: MMD_WHITE,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    lineHeight: 14,
  },
  termsText: {
    flex: 1,
    color: MMD_WHITE,
    fontSize: 12,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  termsLink: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  field: {
    backgroundColor: MMD_GLASS,
    borderColor: MMD_CARD_BORDER,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 11 : 10,
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  showBtn: {
    position: "absolute",
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  showText: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  forgot: { alignItems: "flex-end" },
  linkGold: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
  },
  msg: {
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    lineHeight: 18,
    fontSize: 13,
  },
  cta: {
    backgroundColor: MMD_TAXI_GREEN,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  switchBtn: { alignItems: "center", paddingVertical: 4 },
  spacer: { flex: 1, minHeight: 24 },
  footer: { alignItems: "center", gap: 8 },
  footerLogo: { width: 40, height: 40, borderRadius: 10 },
  footerLabel: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});

export default RestaurantAuthScreen;