import React, { useEffect, useMemo, useState } from "react";
import {
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
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../lib/supabase";
import { uploadFile } from "../lib/uploadFile";
import { clearSelectedRole } from "../lib/authRole";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { AddressAutocomplete } from "../components/location/AddressAutocomplete";
import { PhoneVerifyCard } from "../components/client/PhoneVerifyCard";
import { getApiBaseUrl } from "../lib/apiBase";
import { getLegalSmsUrl, openLegalUrl } from "../lib/legalUrls";
import {
  isClientProfileComplete,
  scoreClientProfileCompleteness,
} from "../lib/profileCompleteness";
import { toUserFacingError } from "../lib/userFacingError";
import {
  BOOT_AUTH_TIMEOUT_MS,
  withTimeout,
} from "../lib/bootFailOpen";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_DARK,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientProfile">;

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  phone: string | null;

  address?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;

  city: string | null;
  state: string | null;

  zip?: string | null;
  postal_code?: string | null;

  country: string | null;
  avatar_url: string | null;
  updated_at?: string;
};

function trimOrEmpty(v: string) {
  return (v || "").trim();
}

function isHttpUrl(value: string | null | undefined) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function resolveAvatarUrl(value: string | null | undefined) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  if (isHttpUrl(clean)) return clean;

  const { data } = supabase.storage.from("avatars").getPublicUrl(clean);
  return data?.publicUrl || null;
}

function initials(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "CL";
}

// ✅ wrapper pour convertir i18next t(key, options) en t(key, fallback, vars)
const tf =
  (t: TFunction) =>
  (key: string, fallback?: string, vars?: Record<string, any>) =>
    t(key, { defaultValue: fallback ?? key, ...(vars ?? {}) });

export function ClientProfileScreen() {
  const { t, i18n } = useTranslation(); // ✅ re-render on language change
  const navigation = useNavigation<Nav>();

  // ✅ t compatible avec nos composants maison (Label, etc.)
  const tt = useMemo(() => tf(t), [t]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [email, setEmail] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);

  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarLocalUri, setAvatarLocalUri] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const requirePhone =
    String(process.env.EXPO_PUBLIC_PHONE_OTP_ENABLED ?? "")
      .toLowerCase()
      .trim() === "true";
  const requireEmail =
    String(process.env.EXPO_PUBLIC_REQUIRE_EMAIL_VERIFICATION ?? "")
      .toLowerCase()
      .trim() === "true";

  const completeness = useMemo(
    () =>
      scoreClientProfileCompleteness({
        fullName,
        email,
        emailVerified,
        phone,
        phoneVerified,
        avatarUrl: avatarLocalUri || avatarUrl,
        addressLine: address,
        city,
        latitude,
        longitude,
      }),
    [
      fullName,
      email,
      emailVerified,
      phone,
      phoneVerified,
      avatarLocalUri,
      avatarUrl,
      address,
      city,
      latitude,
      longitude,
    ],
  );

  const profileComplete = useMemo(
    () =>
      isClientProfileComplete(
        {
          fullName,
          email,
          emailVerified,
          phone,
          phoneVerified,
          avatarUrl: avatarLocalUri || avatarUrl,
          addressLine: address,
          city,
          latitude,
          longitude,
        },
        {
          requirePhoneVerified: requirePhone,
          requireEmailVerified: requireEmail,
        },
      ),
    [
      fullName,
      email,
      emailVerified,
      phone,
      phoneVerified,
      avatarLocalUri,
      avatarUrl,
      address,
      city,
      latitude,
      longitude,
      requirePhone,
      requireEmail,
    ],
  );

  useEffect(() => {
    // ✅ utilise i18n.language => re-run si besoin (optionnel), surtout ça force le refresh des textes
    void i18n.language;

    let alive = true;

    const load = async () => {
      setLoading(true);
      try {
        await withTimeout(
          (async () => {
            const { data: sess } = await supabase.auth.getSession();
            const session = sess.session;
            if (!session) {
              Alert.alert(
                t("common.session", "Session"),
                t("common.notLoggedIn", "Tu n’es pas connecté.")
              );
              return;
            }

            const uid = session.user.id;
            setEmail(session.user.email ?? "");
            setEmailVerified(Boolean(session.user.email_confirmed_at));

            const [{ data, error }, { data: baseProfile }, { data: addrRow }] =
              await Promise.all([
                supabase
                  .from("client_profiles")
                  .select("*")
                  .eq("user_id", uid)
                  .maybeSingle(),
                supabase
                  .from("profiles")
                  .select("full_name, phone, phone_e164, phone_verified_at, email, avatar_url")
                  .eq("id", uid)
                  .maybeSingle(),
                supabase
                  .from("client_addresses")
                  .select(
                    "address_line1, city, state, postal_code, country, latitude, longitude, lat, lng",
                  )
                  .eq("user_id", uid)
                  .eq("is_default", true)
                  .maybeSingle(),
              ]);

            if (error) {
              console.log("load client_profiles error (ignored):", error);
            }

            if (!alive) return;

            const row = data as ProfileRow | null;
            setFullName(row?.full_name ?? baseProfile?.full_name ?? "");
            setPhone(
              row?.phone ??
                baseProfile?.phone_e164 ??
                baseProfile?.phone ??
                "",
            );
            setPhoneVerified(Boolean(baseProfile?.phone_verified_at));
            if (baseProfile?.email) setEmail(String(baseProfile.email));

            const addr =
              addrRow?.address_line1 ??
              row?.address ??
              row?.address_line1 ??
              "";
            setAddress(addr ?? "");
            setCity(addrRow?.city ?? row?.city ?? "");
            setState(addrRow?.state ?? row?.state ?? "");
            setPostalCode(
              addrRow?.postal_code ?? row?.postal_code ?? row?.zip ?? "",
            );
            setCountry(addrRow?.country ?? row?.country ?? "US");
            setAvatarUrl(row?.avatar_url ?? baseProfile?.avatar_url ?? null);

            const lat = Number(addrRow?.latitude ?? addrRow?.lat);
            const lng = Number(addrRow?.longitude ?? addrRow?.lng);
            setLatitude(Number.isFinite(lat) ? lat : null);
            setLongitude(Number.isFinite(lng) ? lng : null);

            try {
              const token = session.access_token;
              const consentRes = await fetch(`${getApiBaseUrl()}/api/sms/consent`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const consentJson = (await consentRes.json().catch(() => ({}))) as {
                sms_consent?: boolean;
              };
              if (alive) setSmsConsent(consentJson.sms_consent === true);
            } catch {
              // optional
            }
          })(),
          BOOT_AUTH_TIMEOUT_MS,
          "client_profile_load",
        );
      } catch (e) {
        console.log("load profile failed (ignored):", e);
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    return () => {
      alive = false;
    };
  }, [t, i18n.language]);

  async function pickAvatar() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        t("common.permission", "Permission"),
        t(
          "client.profile.permissionPhotosBody",
          "Autorise l’accès aux photos pour choisir une image."
        )
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled) return;

    const uri = result.assets?.[0]?.uri;
    if (!uri) return;

    setAvatarLocalUri(uri);
  }

  async function uploadAvatarIfNeeded(uid: string): Promise<string | null> {
    if (!avatarLocalUri) return avatarUrl;

    try {
      const { publicUrl } = await uploadFile({
        bucket: "avatars",
        path: `clients/${uid}/avatar.jpg`,
        uri: avatarLocalUri,
        contentType: "image/jpeg",
      });

      return publicUrl ?? null;
    } catch (e: any) {
      console.log("AVATAR_UPLOAD_ERROR =", JSON.stringify(e, null, 2));
      throw new Error(
        t(
          "client.profile.avatarUploadError",
          "Upload photo impossible. Vérifie Storage policies (avatars) + permissions."
        )
      );
    }
  }

  async function upsertClientAddress(params: {
    uid: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    latitude: number | null;
    longitude: number | null;
  }) {
    const {
      uid,
      addressLine1,
      city,
      state,
      postalCode,
      country,
      latitude: lat,
      longitude: lng,
    } = params;
    const coords =
      lat != null &&
      lng != null &&
      Number.isFinite(lat) &&
      Number.isFinite(lng)
        ? { latitude: lat, longitude: lng, lat, lng }
        : {};

    const { error: unsetErr } = await supabase
      .from("client_addresses")
      .update({ is_default: false })
      .eq("user_id", uid)
      .eq("is_default", true);

    if (unsetErr) {
      console.log("client_addresses unset default error:", unsetErr);
    }

    const upsertAttempt = await supabase.from("client_addresses").upsert(
      {
        user_id: uid,
        label: t("client.profile.mainAddressLabel", "Adresse principale"),
        address_line1: addressLine1,
        address_line2: null,
        city,
        state,
        postal_code: postalCode,
        country,
        is_default: true,
        ...coords,
      },
      { onConflict: "user_id,label" }
    );

    if (!upsertAttempt.error) return;

    console.log(
      "client_addresses upsert error (fallback to update/insert):",
      upsertAttempt.error
    );

    const label = t("client.profile.mainAddressLabel", "Adresse principale");

    const { data: existing, error: selErr } = await supabase
      .from("client_addresses")
      .select("id")
      .eq("user_id", uid)
      .eq("label", label)
      .maybeSingle();

    if (selErr) {
      console.log("client_addresses select for fallback error:", selErr);
    }

    if (existing?.id) {
      const { error: updErr } = await supabase
        .from("client_addresses")
        .update({
          address_line1: addressLine1,
          address_line2: null,
          city,
          state,
          postal_code: postalCode,
          country,
          is_default: true,
          updated_at: new Date().toISOString(),
          ...coords,
        })
        .eq("id", existing.id);

      if (updErr) {
        console.log("client_addresses fallback update error:", updErr);
        throw new Error(
          t(
            "client.profile.addressSaveUpdateError",
            "Adresse non enregistrée (update):"
          ) + ` ${updErr.message}`
        );
      }
      return;
    }

    const { error: insErr } = await supabase.from("client_addresses").insert({
      user_id: uid,
      label,
      address_line1: addressLine1,
      address_line2: null,
      city,
      state,
      postal_code: postalCode,
      country,
      is_default: true,
      ...coords,
    });

    if (insErr) {
      console.log("client_addresses fallback insert error:", insErr);
      throw new Error(
        t(
          "client.profile.addressSaveInsertError",
          "Adresse non enregistrée (insert):"
        ) + ` ${insErr.message}`
      );
    }
  }

  async function handleSignOut() {
    if (signingOut) return;

    Alert.alert(
      t("client.profile.signOut.title", "Sign Out"),
      t("client.profile.signOut.body", "Sign out of this device? Your account and data stay intact."),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("client.profile.signOut.confirm", "Sign Out"),
          style: "destructive",
          onPress: async () => {
            try {
              setSigningOut(true);
              await clearSelectedRole();
              const { error } = await supabase.auth.signOut();
              if (error) throw error;
              navigation.reset({
                index: 0,
                routes: [{ name: "RoleSelect" }],
              });
            } catch (e: unknown) {
              Alert.alert(
                t("common.error", "Erreur"),
                toUserFacingError(
                  e,
                  t("client.profile.signOut.error", "Unable to sign out right now."),
                ),
              );
            } finally {
              setSigningOut(false);
            }
          },
        },
      ],
    );
  }

  async function handleSave() {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const session = sess.session;
      if (!session) {
        Alert.alert(
          t("common.session", "Session"),
          t("common.notLoggedIn", "Tu n’es pas connecté.")
        );
        return;
      }

      if (trimOrEmpty(fullName).length < 2)
        return Alert.alert(
          t("client.profile.fullNameTitle", "Nom"),
          t("client.profile.fullNameError", "Entre ton nom complet.")
        );
      if (trimOrEmpty(phone).length < 7)
        return Alert.alert(
          t("client.profile.phoneTitle", "Téléphone"),
          t("client.profile.phoneError", "Entre un numéro valide.")
        );
      if (trimOrEmpty(address).length < 4)
        return Alert.alert(
          t("client.profile.addressTitle", "Adresse"),
          t("client.profile.addressError", "Entre une adresse valide.")
        );
      if (
        latitude == null ||
        longitude == null ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        return Alert.alert(
          t("client.profile.addressTitle", "Adresse"),
          t(
            "client.profile.addressMapboxError",
            "Sélectionne une adresse Mapbox dans la liste pour la normaliser.",
          ),
        );
      }
      if (trimOrEmpty(city).length < 2)
        return Alert.alert(
          t("client.profile.cityTitle", "Ville"),
          t("client.profile.cityError", "Entre une ville valide.")
        );

      setSaving(true);

      const uid = session.user.id;

      const finalAvatar = await uploadAvatarIfNeeded(uid);

      const normState = trimOrEmpty(state).toUpperCase();
      const normCountry = trimOrEmpty(country).toUpperCase();
      const addr1 = trimOrEmpty(address);
      const zipVal = trimOrEmpty(postalCode);

      const profilePayload: any = {
        user_id: uid,
        full_name: trimOrEmpty(fullName),
        phone: trimOrEmpty(phone),

        address: addr1,
        address_line1: addr1,
        address_line2: null,
        default_address: addr1,

        city: trimOrEmpty(city),
        state: normState,

        postal_code: zipVal,
        zip: zipVal,

        country: normCountry,
        avatar_url: finalAvatar ?? null,

        updated_at: new Date().toISOString(),
      };

      const { error: profErr } = await supabase
        .from("client_profiles")
        .upsert(profilePayload, { onConflict: "user_id" });

      if (profErr) {
        console.log("save profile error:", profErr);
        throw new Error(
          t(
            "client.profile.saveProfileError",
            "Sauvegarde impossible (client_profiles):"
          ) + ` ${profErr.message}`
        );
      }

      const { error: baseProfileErr } = await supabase.from("profiles").upsert(
        {
          id: uid,
          full_name: trimOrEmpty(fullName),
          phone: trimOrEmpty(phone),
          role: "client",
          avatar_url: finalAvatar ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (baseProfileErr) {
        console.log("profiles sync error (ignored):", baseProfileErr);
      }

      await upsertClientAddress({
        uid,
        addressLine1: addr1,
        city: trimOrEmpty(city),
        state: normState,
        postalCode: zipVal,
        country: normCountry,
        latitude,
        longitude,
      });

      setAvatarUrl(finalAvatar ?? null);
      setAvatarLocalUri(null);

      try {
        await fetch(`${getApiBaseUrl()}/api/sms/consent`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phone: trimOrEmpty(phone),
            consent: smsConsent,
            source: "mobile_profile",
          }),
        });
      } catch {
        // Profile save still succeeded
      }

      Alert.alert(
        t("common.ok", "OK"),
        t("client.profile.saved", "Profil enregistré."),
        [
          {
            text: t("common.continue", "Continuer"),
            onPress: () => {
              navigation.reset({
                index: 0,
                routes: [{ name: "ClientHome" as any }],
              });
            },
          },
        ]
      );
    } catch (e: any) {
      Alert.alert(
        t("common.error", "Erreur"),
        e?.message ?? t("client.profile.saveError", "Impossible d’enregistrer.")
      );
    } finally {
      setSaving(false);
    }
  }

  const { width } = useWindowDimensions();
  const logoSize = width >= 768 ? 96 : width < 340 ? 72 : 80;

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingRoot} edges={["top", "bottom", "left", "right"]}>
        <StatusBar barStyle="light-content" />
        <ScreenHeader
          title={t("client.profile.title", "Profil client")}
          fallbackRoute="ClientHome"
          variant="dark"
        />
        <Image source={MMD_LOGO} style={styles.loadingLogo} resizeMode="contain" />
        <Text style={styles.loadingBrand}>MMD DELIVERY</Text>
        <Text style={styles.loadingTagline}>
          {t("brand.tagline", "We Deliver With Heart ❤️")}
        </Text>
        <ActivityIndicator color={MMD_GOLD_DARK} size="large" style={{ marginTop: 16 }} />
        <Text style={styles.loadingCaption}>
          {t("client.profile.loading", "Chargement du profil...")}
        </Text>
      </SafeAreaView>
    );
  }

  const avatarPreview = avatarLocalUri || resolveAvatarUrl(avatarUrl);
  const displayInitials = initials(fullName);

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={t("client.profile.title", "Profil client")}
        subtitle={t(
          "client.profile.subtitle",
          "Complète ton profil (photo, adresse, téléphone) pour passer des commandes."
        )}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.logoWrap}>
            <Image
              source={MMD_LOGO}
              style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2 }}
              resizeMode="contain"
            />
          </View>

          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>
              {t("client.profile.completeness", "Complétude du profil")} :{" "}
              {completeness.percent}%
            </Text>
            <Text style={styles.bannerBody}>
              {completeness.missing.length
                ? `${t("client.profile.missing", "Manquant")} : ${completeness.missing.join(", ")}`
                : t("client.profile.complete", "Profil complet.")}
            </Text>
            {latitude != null && longitude != null ? (
              <Text style={styles.bannerOk}>
                {t("client.profile.addressVerifiedBadge", "Adresse vérifiée")}
              </Text>
            ) : null}
          </View>

          <TouchableOpacity
            onPress={() => navigation.navigate("ClientSettings")}
            activeOpacity={0.85}
            style={styles.settingsLink}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.settingsTitle}>
                {t("client.profile.openSettings", "Settings")}
              </Text>
              <Text style={styles.settingsHint}>
                {t(
                  "client.profile.openSettingsHint",
                  "Language, notifications, security & more"
                )}
              </Text>
            </View>
            <Text style={styles.settingsChevron}>›</Text>
          </TouchableOpacity>

          <View style={styles.avatarRow}>
            <View style={styles.avatarCircle}>
              {avatarPreview ? (
                <Image
                  source={{ uri: avatarPreview }}
                  style={styles.avatarImg}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitials}>{displayInitials}</Text>
                  <Text style={styles.avatarPhotoLabel}>
                    {t("client.profile.photo", "Photo")}
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              onPress={pickAvatar}
              disabled={saving}
              style={[styles.addPhotoBtn, saving ? { opacity: 0.7 } : null]}
            >
              <Text style={styles.addPhotoText}>
                {avatarPreview
                  ? t("client.profile.changePhoto", "Changer la photo")
                  : t("client.profile.addPhoto", "Ajouter une photo")}
              </Text>
            </TouchableOpacity>
          </View>

          <Label t={tt} labelKey="client.profile.fields.fullName" fallback="Nom complet" />
          <Field
            value={fullName}
            onChangeText={setFullName}
            placeholder={t("client.profile.placeholders.fullName", "Ex: Mamadou Diallo")}
          />

          <Label t={tt} labelKey="client.profile.fields.phone" fallback="Numéro de téléphone" />
          <Field
            value={phone}
            onChangeText={setPhone}
            placeholder={t("client.profile.placeholders.phone", "Ex: 929xxxxxxx")}
            keyboardType="phone-pad"
          />
          <PhoneVerifyCard
            phone={phone}
            verified={phoneVerified}
            onVerified={(e164) => {
              setPhoneVerified(true);
              setPhone(e164);
            }}
          />

          <TouchableOpacity
            onPress={() => setSmsConsent((prev) => !prev)}
            style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 12, marginBottom: 8 }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                borderWidth: 1.5,
                borderColor: "rgba(255,255,255,0.7)",
                backgroundColor: smsConsent ? "#37D451" : "transparent",
                marginTop: 2,
              }}
            />
            <Text style={{ flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 12, lineHeight: 17 }}>
              {t(
                "client.profile.smsConsent",
                "I agree to receive automated informational and transactional text messages from MMD Delivery about my account, verification, orders, deliveries, package deliveries, taxi rides, and customer support. Message frequency varies. Message and data rates may apply. Consent is not a condition of purchase. Reply STOP to cancel and HELP for help. Optional.",
              )}{" "}
              <Text
                style={{ textDecorationLine: "underline", color: "#93C5FD" }}
                onPress={() => void openLegalUrl(getLegalSmsUrl())}
              >
                SMS
              </Text>
            </Text>
          </TouchableOpacity>

          <Label t={tt} labelKey="client.profile.fields.address" fallback="Adresse" />
          <AddressAutocomplete
            value={address}
            onChangeText={(text) => {
              setAddress(text);
              setLatitude(null);
              setLongitude(null);
            }}
            onSelect={(place) => {
              setAddress(place.fullAddress);
              setLatitude(place.latitude);
              setLongitude(place.longitude);
            }}
            placeholder={t(
              "client.profile.placeholders.address",
              "Rechercher une adresse…",
            )}
            country={trimOrEmpty(country).toLowerCase() || undefined}
            style={styles.addressField}
          />

          <View style={styles.rowFields}>
            <View style={{ flex: 1 }}>
              <Label t={tt} labelKey="client.profile.fields.city" fallback="Ville" />
              <Field
                value={city}
                onChangeText={setCity}
                placeholder={t("client.profile.placeholders.city", "Ex: Brooklyn")}
              />
            </View>
            <View style={{ width: 90 }}>
              <Label t={tt} labelKey="client.profile.fields.state" fallback="État" />
              <Field
                value={state}
                onChangeText={setState}
                placeholder={t("client.profile.placeholders.state", "NY")}
                autoCapitalize="characters"
              />
            </View>
          </View>

          <View style={styles.rowFields}>
            <View style={{ flex: 1 }}>
              <Label t={tt} labelKey="client.profile.fields.postalCode" fallback="Code postal" />
              <Field
                value={postalCode}
                onChangeText={setPostalCode}
                placeholder={t("client.profile.placeholders.postalCode", "11207")}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ width: 90 }}>
              <Label t={tt} labelKey="client.profile.fields.country" fallback="Pays" />
              <Field
                value={country}
                onChangeText={setCountry}
                placeholder={t("client.profile.placeholders.country", "US")}
                autoCapitalize="characters"
              />
            </View>
          </View>

          <Text style={styles.hint}>
            {t('client.profile.hint', 'Astuce: État = "NY", Pays = "US".')}
          </Text>

          <TouchableOpacity
            onPress={handleSave}
            disabled={saving || !profileComplete}
            activeOpacity={0.9}
            style={[styles.saveWrap, (saving || !profileComplete) && { opacity: 0.7 }]}
          >
            <LinearGradient
              colors={[MMD_BLUE, "rgba(11,18,32,0.88)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.saveBtn}
            >
              {saving ? (
                <ActivityIndicator color="#F8FAFC" />
              ) : (
                <Text style={styles.saveText}>
                  {t("client.profile.saveAndContinue", "Enregistrer et continuer")}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleSignOut}
            disabled={signingOut || saving}
            style={[styles.signOutBtn, signingOut ? { opacity: 0.7 } : null]}
          >
            {signingOut ? (
              <ActivityIndicator color={MMD_WHITE} />
            ) : (
              <Text style={styles.signOutText}>
                {t("client.profile.signOut.button", "Sign Out")}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() =>
              navigation.navigate("DeleteAccount", { role: "client" })
            }
            style={styles.deleteBtn}
          >
            <Text style={styles.deleteText}>
              {t("account.delete.title", "Delete account")}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type LabelProps = {
  t: (key: string, fallback?: string, vars?: any) => string;
  labelKey: string;
  fallback: string;
};

function Label({ t, labelKey, fallback }: LabelProps) {
  return <Text style={styles.label}>{t(labelKey, fallback)}</Text>;
}

function Field(props: any) {
  return (
    <TextInput
      {...props}
      placeholderTextColor="rgba(255,255,255,0.55)"
      autoCapitalize={props.autoCapitalize ?? "none"}
      autoCorrect={props.autoCorrect ?? false}
      style={styles.field}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  loadingRoot: {
    flex: 1,
    backgroundColor: MMD_BLUE,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  loadingLogo: { width: 100, height: 100, borderRadius: 50 },
  loadingBrand: {
    marginTop: 16,
    color: MMD_WHITE,
    fontSize: 28,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    textAlign: "center",
  },
  loadingTagline: {
    marginTop: 8,
    color: MMD_GOLD_DARK,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
    textAlign: "center",
  },
  loadingCaption: {
    marginTop: 12,
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    textAlign: "center",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  logoWrap: {
    width: "100%",
    alignItems: "center",
    marginBottom: 8,
  },
  banner: {
    marginBottom: 14,
    backgroundColor: MMD_BLUE,
    borderColor: "rgba(255,255,255,0.3)",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4,
  },
  bannerTitle: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 16,
  },
  bannerBody: { color: MMD_WHITE, fontSize: 15 },
  bannerOk: { color: "#86EFAC", fontSize: 13, marginTop: 2 },
  settingsLink: {
    marginBottom: 14,
    backgroundColor: MMD_BLUE,
    borderColor: "rgba(255,255,255,0.3)",
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  settingsTitle: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 18,
  },
  settingsHint: {
    color: MMD_WHITE,
    fontWeight: "700",
    marginTop: 3,
    fontSize: 15,
  },
  settingsChevron: { color: MMD_WHITE, fontWeight: "800", fontSize: 23 },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 16,
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: MMD_BLUE,
    borderWidth: 1,
    borderColor: MMD_WHITE,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarImg: { width: 64, height: 64 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarInitials: {
    color: MMD_WHITE,
    fontSize: 21,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
  },
  avatarPhotoLabel: { color: MMD_WHITE, fontSize: 13, marginTop: 2 },
  addPhotoBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: MMD_WHITE,
  },
  addPhotoText: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 17,
  },
  label: {
    color: MMD_WHITE,
    marginBottom: 6,
    marginTop: 10,
    fontSize: 17,
    fontFamily: MMD_FONT.regular,
  },
  field: {
    borderWidth: 2.5,
    borderColor: MMD_WHITE,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 16,
    color: MMD_WHITE,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginBottom: 4,
    fontSize: 17,
  },
  addressField: {
    borderWidth: 2.5,
    borderColor: MMD_WHITE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 16,
    color: MMD_WHITE,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginBottom: 4,
    fontSize: 17,
  },
  rowFields: { flexDirection: "row", gap: 10 },
  hint: { color: MMD_WHITE, marginTop: 6, fontSize: 15 },
  saveWrap: { marginTop: 18, borderRadius: 10, overflow: "hidden" },
  saveBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: {
    color: "#F8FAFC",
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 19,
  },
  signOutBtn: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(11,14,32,0.52)",
  },
  signOutText: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 17,
  },
  deleteBtn: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "rgba(220,38,38,0.87)",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(220,38,38,0.95)",
  },
  deleteText: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 17,
  },
});

export default ClientProfileScreen;
