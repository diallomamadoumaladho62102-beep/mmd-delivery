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
} from "react-native";
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
      const { data, error } = await supabase.auth.signInWithPassword({
        email: e,
        password,
      });

      if (error) {
        console.error(error);
        throw new Error(error.message || t("client.auth.loginFailed"));
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
        e instanceof Error ? e.message : t("client.auth.cannotLogin")
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
        "Entre ton email, puis appuie sur mot de passe oublié."
      );
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(e, {
        redirectTo: RESET_PASSWORD_URL,
      });

      if (error) {
        throw new Error(error.message);
      }

      Alert.alert(
        "Email envoyé",
        "Vérifie ta boîte email. Clique sur le lien reçu pour modifier ton mot de passe."
      );
    } catch (err: unknown) {
      Alert.alert(
        t("client.auth.errorTitle"),
        err instanceof Error ? err.message : "Impossible d’envoyer l’email."
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
          country: signupCountry,
          is_default: true,
        });

      if (addrErr) {
        console.log("client_addresses insert error:", addrErr);
      }
    } catch (err) {
      console.log("client_addresses insert exception:", err);
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

    if (
      !trimOrEmpty(addressLine1) ||
      !trimOrEmpty(city) ||
      !trimOrEmpty(stateRegion) ||
      !trimOrEmpty(postalCode)
    ) {
      Alert.alert(
        t("client.auth.addressTitle"),
        t("client.auth.fullAddressRequired")
      );
      return;
    }

    const signupCountry = trimOrEmpty(country).toUpperCase();
    if (!/^[A-Z]{2}$/.test(signupCountry)) {
      Alert.alert(
        t("client.auth.addressTitle"),
        t("client.auth.countryRequired", "Select your country to continue.")
      );
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
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
      });

      if (error) {
        console.error(error);
        throw new Error(error.message || t("client.auth.signupFailed"));
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
        routes: [{ name: "Home" }],
      });
    } catch (e: unknown) {
      console.error(e);
      Alert.alert(
        t("client.auth.errorTitle"),
        e instanceof Error ? e.message : t("client.auth.cannotSignup")
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
        t("client.auth.photoTitle"),
        e instanceof Error ? e.message : t("client.auth.cannotPickPhoto")
      );
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            padding: 24,
            justifyContent: "center",
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View>
            <Text
              style={{
                fontSize: 26,
                fontWeight: "700",
                color: "white",
                marginBottom: 12,
              }}
            >
              {title}
            </Text>

            <Text
              style={{
                fontSize: 14,
                color: "#9CA3AF",
                marginBottom: 24,
              }}
            >
              {subtitle}
            </Text>

            {mode === "signup" ? (
              <View style={{ marginBottom: 18 }}>
                <Text
                  style={{
                    color: "#E5E7EB",
                    marginBottom: 10,
                    fontWeight: "700",
                  }}
                >
                  {t("client.auth.profilePhoto")}
                </Text>

                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                >
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: "#374151",
                      backgroundColor: "rgba(15,23,42,0.6)",
                      overflow: "hidden",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {avatar?.uri ? (
                      <Image
                        source={{ uri: avatar.uri }}
                        style={{ width: 64, height: 64 }}
                      />
                    ) : (
                      <Text style={{ color: "#94A3B8", fontWeight: "900" }}>
                        +
                      </Text>
                    )}
                  </View>

                  <TouchableOpacity
                    onPress={onPickAvatar}
                    disabled={loading}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderRadius: 10,
                      backgroundColor: "rgba(59,130,246,0.15)",
                      borderWidth: 1,
                      borderColor: "#3B82F6",
                      opacity: loading ? 0.7 : 1,
                    }}
                  >
                    <Text style={{ color: "#93C5FD", fontWeight: "800" }}>
                      {avatar?.uri
                        ? t("client.auth.changePhoto")
                        : t("client.auth.addPhoto")}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ height: 16 }} />

                <Text style={{ color: "#E5E7EB", marginBottom: 8 }}>
                  {t("client.auth.fullName")}
                </Text>
                <TextInput
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder={t("client.auth.fullNamePlaceholder")}
                  placeholderTextColor="#6B7280"
                  autoCapitalize="words"
                  style={{
                    borderWidth: 1,
                    borderColor: "#374151",
                    borderRadius: 8,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    color: "white",
                    marginBottom: 16,
                  }}
                />

                <Text style={{ color: "#E5E7EB", marginBottom: 8 }}>
                  {t("client.auth.phone")}
                </Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder={t("client.auth.phonePlaceholder")}
                  placeholderTextColor="#6B7280"
                  keyboardType="phone-pad"
                  style={{
                    borderWidth: 1,
                    borderColor: "#374151",
                    borderRadius: 8,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    color: "white",
                    marginBottom: 16,
                  }}
                />

                <Text style={{ color: "#E5E7EB", marginBottom: 8 }}>
                  {t("client.auth.address")}
                </Text>
                <TextInput
                  value={addressLine1}
                  onChangeText={setAddressLine1}
                  placeholder={t("client.auth.address1Placeholder")}
                  placeholderTextColor="#6B7280"
                  autoCapitalize="words"
                  style={{
                    borderWidth: 1,
                    borderColor: "#374151",
                    borderRadius: 8,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    color: "white",
                    marginBottom: 10,
                  }}
                />
                <TextInput
                  value={addressLine2}
                  onChangeText={setAddressLine2}
                  placeholder={t("client.auth.address2Placeholder")}
                  placeholderTextColor="#6B7280"
                  autoCapitalize="words"
                  style={{
                    borderWidth: 1,
                    borderColor: "#374151",
                    borderRadius: 8,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    color: "white",
                    marginBottom: 10,
                  }}
                />

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      value={city}
                      onChangeText={setCity}
                      placeholder={t("client.auth.cityPlaceholder")}
                      placeholderTextColor="#6B7280"
                      autoCapitalize="words"
                      style={{
                        borderWidth: 1,
                        borderColor: "#374151",
                        borderRadius: 8,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        color: "white",
                        marginBottom: 10,
                      }}
                    />
                  </View>

                  <View style={{ width: 110 }}>
                    <TextInput
                      value={stateRegion}
                      onChangeText={setStateRegion}
                      placeholder={t("client.auth.statePlaceholder")}
                      placeholderTextColor="#6B7280"
                      autoCapitalize="characters"
                      style={{
                        borderWidth: 1,
                        borderColor: "#374151",
                        borderRadius: 8,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        color: "white",
                        marginBottom: 10,
                      }}
                    />
                  </View>
                </View>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      value={postalCode}
                      onChangeText={setPostalCode}
                      placeholder={t("client.auth.postalPlaceholder")}
                      placeholderTextColor="#6B7280"
                      keyboardType="numbers-and-punctuation"
                      style={{
                        borderWidth: 1,
                        borderColor: "#374151",
                        borderRadius: 8,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        color: "white",
                        marginBottom: 6,
                      }}
                    />
                  </View>

                  <View style={{ width: 90 }}>
                    <TextInput
                      value={country}
                      onChangeText={setCountry}
                      placeholder={t("client.auth.countryPlaceholder")}
                      placeholderTextColor="#6B7280"
                      autoCapitalize="characters"
                      style={{
                        borderWidth: 1,
                        borderColor: "#374151",
                        borderRadius: 8,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        color: "white",
                        marginBottom: 6,
                      }}
                    />
                  </View>
                </View>

                <Text
                  style={{
                    color: "#64748B",
                    fontSize: 12,
                    marginTop: 6,
                    fontWeight: "700",
                  }}
                >
                  {t("client.auth.tipStateCountry")}
                </Text>



                <View style={{ height: 16 }} />

                <Text style={{ color: "#E5E7EB", marginBottom: 8 }}>
                  {t("client.auth.referral.title", "Referral code")}
                </Text>
                <TextInput
                  value={referralCode}
                  onChangeText={setReferralCode}
                  placeholder={t("client.auth.referral.placeholder", "MMD referral code")}
                  placeholderTextColor="#6B7280"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={{
                    borderWidth: 1,
                    borderColor: referralCode ? "#8B5CF6" : "#374151",
                    borderRadius: 8,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    color: "white",
                    marginBottom: 8,
                  }}
                />

                <Text
                  style={{
                    color: "#64748B",
                    fontSize: 12,
                    fontWeight: "700",
                  }}
                >
                  {t(
                    "client.auth.referral.autoFillHint",
                    "If you opened an MMD referral link, the code appears here automatically."
                  )}
                </Text>

                <View style={{ height: 18 }} />
              </View>
            ) : null}

            <Text style={{ color: "#E5E7EB", marginBottom: 8 }}>
              {t("client.auth.email")}
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t("client.auth.emailPlaceholder")}
              placeholderTextColor="#6B7280"
              autoCapitalize="none"
              keyboardType="email-address"
              style={{
                borderWidth: 1,
                borderColor: "#374151",
                borderRadius: 8,
                paddingHorizontal: 14,
                paddingVertical: 10,
                color: "white",
                marginBottom: 16,
              }}
            />

            <Text style={{ color: "#E5E7EB", marginBottom: 8 }}>
              {t("client.auth.password")}
            </Text>
            <View style={{ position: "relative", marginBottom: 24 }}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={t("client.auth.passwordPlaceholder")}
                placeholderTextColor="#6B7280"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
                style={{
                  borderWidth: 1,
                  borderColor: "#374151",
                  borderRadius: 8,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  paddingRight: 88,
                  color: "white",
                  opacity: loading ? 0.8 : 1,
                }}
              />
              <TouchableOpacity
                disabled={loading}
                onPress={() => setShowPassword((value) => !value)}
                style={{
                  position: "absolute",
                  right: 12,
                  top: 0,
                  bottom: 0,
                  justifyContent: "center",
                  opacity: loading ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "#93C5FD", fontWeight: "800", fontSize: 12 }}>
                  {showPassword ? "Cacher" : "Voir"}
                </Text>
              </TouchableOpacity>
            </View>

            {mode === "login" ? (
              <TouchableOpacity
                onPress={handleForgotPassword}
                disabled={loading}
                style={{ alignItems: "flex-end", marginTop: -12, marginBottom: 18 }}
              >
                <Text style={{ color: "#93C5FD", fontWeight: "800" }}>
                  Mot de passe oublié ?
                </Text>
              </TouchableOpacity>
            ) : null}

            {mode === "signup" ? <LegalSignupLinks disabled={loading} /> : null}

            <TouchableOpacity
              onPress={mode === "login" ? handleLogin : handleSignup}
              disabled={loading}
              style={{
                backgroundColor: "#3B82F6",
                paddingVertical: 14,
                borderRadius: 8,
                alignItems: "center",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text
                  style={{ color: "white", fontSize: 16, fontWeight: "600" }}
                >
                  {primaryBtnLabel}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setMode(mode === "login" ? "signup" : "login")}
              disabled={loading}
              style={{ marginTop: 14, alignItems: "center" }}
            >
              <Text style={{ color: "#93C5FD", fontWeight: "700" }}>
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

export default ClientAuthScreen;