import React, { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { validatePassword } from "../lib/authValidation";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Linking from "expo-linking";
import { useTranslation } from "react-i18next";
import { getResetPasswordRedirectUrl } from "../lib/productionSite";
import LegalSignupLinks from "../components/LegalSignupLinks";
import { toUserFacingError } from "../lib/userFacingError";
import {
  AUTH_ACTION_TIMEOUT_MS,
  withTimeout,
} from "../lib/bootFailOpen";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_WHITE,
  mmdLogoSize,
} from "../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientAuth">;

const RESET_PASSWORD_URL = getResetPasswordRedirectUrl();

function normalizeReferralCode(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^ref=/i, "")
    .replace(/^code=/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .toUpperCase();

  return cleaned.length >= 4 ? cleaned : null;
}

function extractReferralCode(url: string | null): string | null {
  if (!url) return null;

  try {
    const parsed = Linking.parse(url);
    const qp = parsed.queryParams ?? {};

    const refFromQuery =
      normalizeReferralCode(qp.ref) ?? normalizeReferralCode(qp.code);

    if (refFromQuery) return refFromQuery;

    const path = String(parsed.path ?? "").replace(/^\/+|\/+$/g, "");
    const parts = path.split("/").filter(Boolean);

    const rIndex = parts.findIndex((part) => part.toLowerCase() === "r");
    if (rIndex >= 0 && parts[rIndex + 1]) {
      return normalizeReferralCode(parts[rIndex + 1]);
    }

    if (parts.length >= 2 && parts[0]?.toLowerCase() === "signup") {
      return normalizeReferralCode(parts[1]);
    }

    return null;
  } catch {
    const match = url.match(/(?:[?&](?:ref|code)=|\/r\/)([a-zA-Z0-9_-]+)/i);
    return normalizeReferralCode(match?.[1]);
  }
}

function cleanPhone(v: string) {
  const s = (v || "").trim();
  return s.replace(/[^\d+]/g, "");
}

function trimOrEmpty(v: string) {
  return (v || "").trim();
}

function getExtFromMimeOrUri(uri: string, mime?: string) {
  const u = (uri || "").toLowerCase();
  if (mime === "image/png" || u.endsWith(".png")) return "png";
  if (mime === "image/webp" || u.endsWith(".webp")) return "webp";
  return "jpg";
}

function decodeBase64(base64: string) {
  if (typeof globalThis.atob === "function") {
    return globalThis.atob(base64);
  }

  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  let buffer = 0;
  let accumulatedBits = 0;

  for (const ch of base64.replace(/=+$/, "")) {
    const value = chars.indexOf(ch);
    if (value === -1) continue;

    buffer = (buffer << 6) | value;
    accumulatedBits += 6;

    while (accumulatedBits >= 8) {
      accumulatedBits -= 8;
      output += String.fromCharCode((buffer >> accumulatedBits) & 0xff);
    }
  }

  return output;
}

function base64ToUint8Array(base64: string) {
  const binary = decodeBase64(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function pickImage(
  t: (k: string) => string
): Promise<{ uri: string; mime?: string } | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!perm.granted) {
    Alert.alert(
      t("client.auth.permissionTitle"),
      t("client.auth.permissionBody")
    );
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
  });

  if (result.canceled) return null;

  const asset = result.assets?.[0];
  if (!asset?.uri) return null;

  const mime =
    (asset as { mimeType?: string } | undefined)?.mimeType ||
    (asset.uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");

  return { uri: asset.uri, mime };
}

async function uploadAvatarToSupabase(params: {
  userId: string;
  uri: string;
  mime?: string;
}) {
  const { userId, uri, mime } = params;

  const BUCKET = "avatars";
  const ext = getExtFromMimeOrUri(uri, mime);
  const path = `clients/${userId}/avatar.${ext}`;

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const bytes = base64ToUint8Array(base64);

  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType:
      mime ||
      (ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/jpeg"),
    upsert: true,
  });

  if (error) throw error;

  const pub = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub?.data?.publicUrl || null;

  return { publicUrl, path };
}

export function ClientAuthScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();

  const [mode, setMode] = useState<"login" | "signup">("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [referralCode, setReferralCode] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateRegion, setStateRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");

  const [avatar, setAvatar] = useState<{ uri: string; mime?: string } | null>(
    null
  );

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const readInitialReferral = async () => {
      const initialUrl = await Linking.getInitialURL();
      const code = extractReferralCode(initialUrl);

      if (code) {
        setReferralCode(code);
        setMode("signup");
      }
    };

    void readInitialReferral();

    const sub = Linking.addEventListener("url", (event) => {
      const code = extractReferralCode(event.url);

      if (code) {
        setReferralCode(code);
        setMode("signup");
      }
    });

    return () => sub.remove();
  }, []);

  const applyReferralIfAny = async () => {
    const code = normalizeReferralCode(referralCode);
    if (!code) return;

    const { data, error } = await supabase.rpc("accept_referral_code", {
      p_code: code,
    });

    if (error) {
      console.log("accept_referral_code error", error);
      return;
    }

    if (data && (data as { ok?: boolean; error?: string }).ok === false) {
      console.log(
        "referral not applied:",
        (data as { ok?: boolean; error?: string }).error
      );
    }
  };

  const title = useMemo(
    () =>
      mode === "login"
        ? t("client.auth.titleLogin")
        : t("client.auth.titleSignup"),
    [mode, t]
  );

  const subtitle = useMemo(
    () =>
      mode === "login"
        ? t("client.auth.subtitleLogin")
        : t("client.auth.subtitleSignup"),
    [mode, t]
  );

  async function handleLogin() {
    const e = email.trim().toLowerCase();

    if (!e || !password.trim()) {
      Alert.alert(
        t("client.auth.missingTitle"),
        t("client.auth.missingEmailPassword")
      );
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: e,
          password,
        }),
        AUTH_ACTION_TIMEOUT_MS,
        "client_signIn",
      );

      if (error) {
        console.error(error);
        throw new Error(toUserFacingError(error, t("client.auth.loginFailed")));
      }

      if (!data.session) {
        throw new Error(t("client.auth.sessionNotCreated"));
      }

      if (!data.user?.email_confirmed_at) {
        await supabase.auth.signOut();
        throw new Error(
          t(
            "client.auth.emailNotVerified",
            "Confirme ton email avant de te connecter.",
          ),
        );
      }

      await applyReferralIfAny();

      navigation.reset({
        index: 0,
        routes: [{ name: "ClientHome" }],
      });
    } catch (e: unknown) {
      console.error(e);
      Alert.alert(
        t("client.auth.errorTitle"),
        toUserFacingError(e, t("client.auth.cannotLogin"))
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    const e = email.trim().toLowerCase();

    if (!e) {
      Alert.alert(
        t("client.auth.missingTitle"),
        t(
          "client.auth.forgotPasswordEmailHint",
          "Enter your email, then tap forgot password.",
        ),
      );
      return;
    }

    setLoading(true);
    try {
      const { error } = await withTimeout(
        supabase.auth.resetPasswordForEmail(e, {
          redirectTo: RESET_PASSWORD_URL,
        }),
        AUTH_ACTION_TIMEOUT_MS,
        "client_resetPassword",
      );

      if (error) {
        throw new Error(
          toUserFacingError(
            error,
            t("client.auth.cannotSendEmail", "Unable to send email."),
          ),
        );
      }

      Alert.alert(
        t("client.auth.resetEmailSentTitle", "Email sent"),
        t(
          "client.auth.resetEmailSentBody",
          "Check your inbox. Click the link you received to reset your password.",
        ),
      );
    } catch (err: unknown) {
      Alert.alert(
        t("client.auth.errorTitle"),
        toUserFacingError(err, t("client.auth.cannotSendEmail", "Unable to send email.")),
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveClientProfile(params: {
    userId: string;
    email: string;
    avatarUrl: string | null;
    signupCountry: string;
  }) {
    const { userId, email, avatarUrl, signupCountry } = params;

    try {
      const { error: profileError } = await supabase.from("profiles").upsert(
        {
          id: userId,
          role: "client",
          full_name: trimOrEmpty(fullName),
          phone: cleanPhone(phone),
          email,
          avatar_url: avatarUrl,
        },
        { onConflict: "id" }
      );

      if (profileError) {
        console.log("profiles upsert error:", profileError);
      }
    } catch (err) {
      console.log("profiles upsert exception:", err);
    }

    try {
      await supabase.auth.updateUser({
        data: {
          role: "client",
          email,
          full_name: trimOrEmpty(fullName),
          phone: cleanPhone(phone),
          address_line1: trimOrEmpty(addressLine1),
          address_line2: trimOrEmpty(addressLine2),
          city: trimOrEmpty(city),
          state: trimOrEmpty(stateRegion),
          postal_code: trimOrEmpty(postalCode),
          country: signupCountry,
          avatar_url: avatarUrl,
        },
      });
    } catch (err) {
      console.log("updateUser metadata error:", err);
    }

    const fullAddress = [
      trimOrEmpty(addressLine1),
      trimOrEmpty(addressLine2),
      `${trimOrEmpty(city)} ${trimOrEmpty(stateRegion)} ${trimOrEmpty(postalCode)}`.trim(),
      trimOrEmpty(signupCountry),
    ]
      .filter(Boolean)
      .join(", ");

    try {
      const payload = {
        user_id: userId,
        phone: cleanPhone(phone),
        default_address: fullAddress,
        full_name: trimOrEmpty(fullName),
        avatar_url: avatarUrl,
        city: trimOrEmpty(city),
        state: trimOrEmpty(stateRegion),
        postal_code: trimOrEmpty(postalCode),
        country: signupCountry,
      };

      const { error } = await supabase
        .from("client_profiles")
        .upsert(payload, { onConflict: "user_id" });

      if (error) {
        console.log("client_profiles upsert error:", error);
      }
    } catch (err) {
      console.log("client_profiles upsert exception:", err);
    }

    // Only persist a saved address when the user actually provided one.
    // Full address is optional at signup (Apple 5.1.1(v)).
    if (trimOrEmpty(addressLine1)) {
      try {
        await supabase
          .from("client_addresses")
          .update({ is_default: false })
          .eq("user_id", userId)
          .eq("is_default", true);

        const { error: addrErr } = await supabase
          .from("client_addresses")
          .insert({
            user_id: userId,
            label: t("client.auth.mainAddressLabel"),
            address_line1: trimOrEmpty(addressLine1),
            address_line2: trimOrEmpty(addressLine2),
            city: trimOrEmpty(city),
            state: trimOrEmpty(stateRegion),
            postal_code: trimOrEmpty(postalCode),
            country: signupCountry || null,
            is_default: true,
          });

        if (addrErr) {
          console.log("client_addresses insert error:", addrErr);
        }
      } catch (err) {
        console.log("client_addresses insert exception:", err);
      }
    }
  }

  async function handleSignup() {
    const e = email.trim().toLowerCase();

    if (!e || !password.trim()) {
      Alert.alert(
        t("client.auth.missingTitle"),
        t("client.auth.missingEmailPassword")
      );
      return;
    }

    const passwordError = validatePassword(password.trim());
    if (passwordError) {
      Alert.alert(t("client.auth.passwordTitle"), passwordError);
      return;
    }

    if (!trimOrEmpty(fullName)) {
      Alert.alert(
        t("client.auth.profileTitle"),
        t("client.auth.fullNameRequired")
      );
      return;
    }

    const p = cleanPhone(phone);
    if (!p) {
      Alert.alert(t("client.auth.profileTitle"), t("client.auth.phoneRequired"));
      return;
    }

    // Full street address is optional at signup (Apple 5.1.1(v)).
    // Country may still be provided for market scope; never block signup on address.
    const signupCountryRaw = trimOrEmpty(country).toUpperCase();
    const signupCountry = /^[A-Z]{2}$/.test(signupCountryRaw)
      ? signupCountryRaw
      : "";

    setLoading(true);
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email: e,
          password,
          options: {
            data: {
              role: "client",
              full_name: trimOrEmpty(fullName),
              phone: p,
              address_line1: trimOrEmpty(addressLine1),
              address_line2: trimOrEmpty(addressLine2),
              city: trimOrEmpty(city),
              state: trimOrEmpty(stateRegion),
              postal_code: trimOrEmpty(postalCode),
              country: signupCountry,
              referral_code: normalizeReferralCode(referralCode),
            },
          },
        }),
        AUTH_ACTION_TIMEOUT_MS,
        "client_signUp",
      );

      if (error) {
        console.error(error);
        throw new Error(toUserFacingError(error, t("client.auth.signupFailed")));
      }

      const userId = data.user?.id;
      if (!userId) {
        Alert.alert(
          t("client.auth.accountCreatedTitle"),
          t("client.auth.accountCreatedLoginNow")
        );
        setMode("login");
        return;
      }

      let avatarUrl: string | null = null;

      if (avatar?.uri) {
        try {
          const up = await uploadAvatarToSupabase({
            userId,
            uri: avatar.uri,
            mime: avatar.mime,
          });
          avatarUrl = up.path;
        } catch (err) {
          console.log("avatar upload error:", err);
          Alert.alert(
            t("client.auth.photoTitle"),
            t("client.auth.photoUploadSkipped")
          );
        }
      }

      await saveClientProfile({ userId, email: e, avatarUrl, signupCountry });
      await applyReferralIfAny();

      if (!data.session) {
        Alert.alert(
          t("client.auth.accountCreatedTitle"),
          t("client.auth.verifyEmailThenLogin")
        );
        setMode("login");
        return;
      }

      navigation.reset({
        index: 0,
        routes: [{ name: "ClientHome" }],
      });
    } catch (e: unknown) {
      console.error(e);
      Alert.alert(
        t("client.auth.errorTitle"),
        toUserFacingError(e, t("client.auth.cannotSignup"))
      );
    } finally {
      setLoading(false);
    }
  }

  const primaryBtnLabel =
    mode === "login"
      ? t("client.auth.loginBtn")
      : t("client.auth.signupBtn");

  const onPickAvatar = async () => {
    try {
      const picked = await pickImage(t);
      if (!picked) return;
      setAvatar(picked);
    } catch (e: unknown) {
      Alert.alert(
        t("client.auth.photoTitle"), toUserFacingError(e, t("client.auth.cannotPickPhoto"))
      );
    }
  };

  const { width, height } = useWindowDimensions();
  const logoSize = mmdLogoSize(width, height);
  const fieldStyle = styles.field;
  const labelStyle = styles.label;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            <View style={styles.logoWrap}>
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
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            {mode === "signup" ? (
              <View style={{ marginBottom: 18 }}>
                <Text style={labelStyle}>{t("client.auth.profilePhoto")}</Text>

                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                >
                  <View style={styles.avatarCircle}>
                    {avatar?.uri ? (
                      <Image
                        source={{ uri: avatar.uri }}
                        style={{ width: 64, height: 64 }}
                      />
                    ) : (
                      <Text style={styles.avatarPlus}>+</Text>
                    )}
                  </View>

                  <TouchableOpacity
                    onPress={onPickAvatar}
                    disabled={loading}
                    style={[styles.photoBtn, loading && { opacity: 0.7 }]}
                  >
                    <Text style={styles.photoBtnText}>
                      {avatar?.uri
                        ? t("client.auth.changePhoto")
                        : t("client.auth.addPhoto")}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ height: 16 }} />

                <Text style={labelStyle}>{t("client.auth.fullName")}</Text>
                <TextInput
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder={t("client.auth.fullNamePlaceholder")}
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  autoCapitalize="words"
                  style={[fieldStyle, { marginBottom: 16 }]}
                />

                <Text style={labelStyle}>{t("client.auth.phone")}</Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder={t("client.auth.phonePlaceholder")}
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  keyboardType="phone-pad"
                  style={[fieldStyle, { marginBottom: 16 }]}
                />

                <Text style={labelStyle}>
                  {t("client.auth.addressOptional", "Address (optional)")}
                </Text>
                <Text
                  style={{
                    color: "rgba(255,255,255,0.65)",
                    fontSize: 12,
                    marginBottom: 8,
                    lineHeight: 16,
                  }}
                >
                  {t(
                    "client.auth.addressOptionalHint",
                    "You can add a delivery address later when you order food, packages, or a taxi.",
                  )}
                </Text>
                <TextInput
                  value={addressLine1}
                  onChangeText={setAddressLine1}
                  placeholder={t("client.auth.address1Placeholder")}
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  autoCapitalize="words"
                  style={[fieldStyle, { marginBottom: 10 }]}
                />
                <TextInput
                  value={addressLine2}
                  onChangeText={setAddressLine2}
                  placeholder={t("client.auth.address2Placeholder")}
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  autoCapitalize="words"
                  style={[fieldStyle, { marginBottom: 10 }]}
                />

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      value={city}
                      onChangeText={setCity}
                      placeholder={t("client.auth.cityPlaceholder")}
                      placeholderTextColor="rgba(255,255,255,0.55)"
                      autoCapitalize="words"
                      style={[fieldStyle, { marginBottom: 10 }]}
                    />
                  </View>

                  <View style={{ width: 110 }}>
                    <TextInput
                      value={stateRegion}
                      onChangeText={setStateRegion}
                      placeholder={t("client.auth.statePlaceholder")}
                      placeholderTextColor="rgba(255,255,255,0.55)"
                      autoCapitalize="characters"
                      style={[fieldStyle, { marginBottom: 10 }]}
                    />
                  </View>
                </View>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      value={postalCode}
                      onChangeText={setPostalCode}
                      placeholder={t("client.auth.postalPlaceholder")}
                      placeholderTextColor="rgba(255,255,255,0.55)"
                      keyboardType="numbers-and-punctuation"
                      style={[fieldStyle, { marginBottom: 6 }]}
                    />
                  </View>

                  <View style={{ width: 90 }}>
                    <TextInput
                      value={country}
                      onChangeText={setCountry}
                      placeholder={t("client.auth.countryPlaceholder")}
                      placeholderTextColor="rgba(255,255,255,0.55)"
                      autoCapitalize="characters"
                      style={[fieldStyle, { marginBottom: 6 }]}
                    />
                  </View>
                </View>

                <Text style={styles.hint}>{t("client.auth.tipStateCountry")}</Text>

                <View style={{ height: 16 }} />

                <Text style={labelStyle}>
                  {t("client.auth.referral.title", "Referral code")}
                </Text>
                <TextInput
                  value={referralCode}
                  onChangeText={setReferralCode}
                  placeholder={t(
                    "client.auth.referral.placeholder",
                    "MMD referral code",
                  )}
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={[fieldStyle, { marginBottom: 8 }]}
                />

                <Text style={styles.hint}>
                  {t(
                    "client.auth.referral.autoFillHint",
                    "If you opened an MMD referral link, the code appears here automatically.",
                  )}
                </Text>

                <View style={{ height: 18 }} />
              </View>
            ) : null}

            <Text style={labelStyle}>{t("client.auth.email")}</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t("client.auth.emailPlaceholder")}
              placeholderTextColor="rgba(255,255,255,0.55)"
              autoCapitalize="none"
              keyboardType="email-address"
              style={[fieldStyle, { marginBottom: 16 }]}
            />

            <Text style={labelStyle}>{t("client.auth.password")}</Text>
            <View style={{ position: "relative", marginBottom: 16 }}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={t("client.auth.passwordPlaceholder")}
                placeholderTextColor="rgba(255,255,255,0.55)"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
                style={[
                  fieldStyle,
                  { paddingRight: 88, opacity: loading ? 0.8 : 1 },
                ]}
              />
              <TouchableOpacity
                disabled={loading}
                onPress={() => setShowPassword((value) => !value)}
                style={styles.showPasswordBtn}
              >
                <Text style={styles.showPasswordText}>
                  {showPassword ? "Cacher" : "Voir"}
                </Text>
              </TouchableOpacity>
            </View>

            {mode === "login" ? (
              <TouchableOpacity
                onPress={handleForgotPassword}
                disabled={loading}
                style={styles.forgotBtn}
              >
                <Text style={styles.forgotText}>Mot de passe oublié ?</Text>
              </TouchableOpacity>
            ) : null}

            {mode === "signup" ? <LegalSignupLinks disabled={loading} /> : null}

            <TouchableOpacity
              onPress={mode === "login" ? handleLogin : handleSignup}
              disabled={loading}
              style={[styles.ctaWrap, loading && { opacity: 0.7 }]}
            >
              <LinearGradient
                colors={["#93C5FD", "#3B82F6", "#93C5FD"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.ctaGradient}
              >
                {loading ? (
                  <ActivityIndicator color="#1A0D00" />
                ) : (
                  <Text style={styles.ctaText}>{primaryBtnLabel}</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setMode(mode === "login" ? "signup" : "login")}
              disabled={loading}
              style={styles.switchModeBtn}
            >
              <Text style={styles.switchModeText}>
                {mode === "login"
                  ? t("client.auth.noAccount")
                  : t("client.auth.haveAccount")}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: MMD_BLUE,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 48,
    // flex-start: avoid RN center-clip on tall iPad / Dynamic Type layouts
    // so the Log in CTA stays reachable without relying on scroll quirks.
    justifyContent: "flex-start",
    flexGrow: 1,
  },
  content: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
    height: 100,
    marginBottom: 48,
  },
  title: {
    fontSize: 42,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    color: MMD_WHITE,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 19,
    fontFamily: MMD_FONT.regular,
    fontWeight: "400",
    color: MMD_WHITE,
    marginBottom: 40,
    lineHeight: 26,
  },
  label: {
    color: MMD_WHITE,
    marginBottom: 8,
    fontSize: 17,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  field: {
    borderWidth: 2.5,
    borderColor: MMD_WHITE,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 16,
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.regular,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: MMD_WHITE,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPlus: {
    color: MMD_WHITE,
    fontWeight: "900",
    fontSize: 28,
  },
  photoBtn: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 2.5,
    borderColor: MMD_WHITE,
  },
  photoBtnText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  hint: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    marginTop: 6,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  showPasswordBtn: {
    position: "absolute",
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  showPasswordText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 17,
  },
  forgotBtn: {
    alignItems: "flex-end",
    marginBottom: 18,
  },
  forgotText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 18,
    textAlign: "right",
  },
  ctaWrap: {
    borderRadius: 16,
    overflow: "hidden",
  },
  ctaGradient: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 60,
  },
  ctaText: {
    color: "#1A0D00",
    fontSize: 22,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  switchModeBtn: {
    marginTop: 24,
    alignItems: "center",
    paddingTop: 14,
  },
  switchModeText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 18,
    textAlign: "center",
  },
});

export default ClientAuthScreen;