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
} from "react-native";
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
import {
  isClientProfileComplete,
  scoreClientProfileCompleteness,
} from "../lib/profileCompleteness";
import { toUserFacingError } from "../lib/userFacingError";

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

  if (loading) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: "#020617",
          justifyContent: "center",
          alignItems: "center",
        }}
        edges={["bottom", "left", "right"]}
      >
        <StatusBar barStyle="light-content" />
        <ScreenHeader
          title={t("client.profile.title", "Profil client")}
          fallbackRoute="ClientHome"
          variant="dark"
        />
        <ActivityIndicator color="#fff" />
        <Text style={{ color: "#9CA3AF", marginTop: 10 }}>
          {t("client.profile.loading", "Chargement du profil...")}
        </Text>
      </SafeAreaView>
    );
  }

  const avatarPreview = avatarLocalUri || resolveAvatarUrl(avatarUrl);
  const displayInitials = initials(fullName);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }} edges={["bottom", "left", "right"]}>
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
          contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 40 }}
        >
        <View
          style={{
            marginBottom: 14,
            backgroundColor: "#431407",
            borderColor: "#FDBA74",
            borderWidth: 1,
            borderRadius: 14,
            paddingVertical: 12,
            paddingHorizontal: 14,
          }}
        >
          <Text style={{ color: "#FFEDD5", fontWeight: "800", fontSize: 13 }}>
            {t("client.profile.completeness", "Complétude du profil")} :{" "}
            {completeness.percent}%
          </Text>
          <Text style={{ color: "#FED7AA", fontSize: 11, marginTop: 4 }}>
            {completeness.missing.length
              ? `${t("client.profile.missing", "Manquant")} : ${completeness.missing.join(", ")}`
              : t("client.profile.complete", "Profil complet.")}
          </Text>
          {latitude != null && longitude != null ? (
            <Text style={{ color: "#86EFAC", fontSize: 11, marginTop: 4 }}>
              {t("client.profile.addressVerifiedBadge", "Adresse vérifiée")}
            </Text>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={() => navigation.navigate("ClientSettings")}
          activeOpacity={0.85}
          style={{
            marginBottom: 14,
            backgroundColor: "#0B1220",
            borderColor: "#1E293B",
            borderWidth: 1,
            borderRadius: 14,
            paddingVertical: 14,
            paddingHorizontal: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View>
            <Text style={{ color: "#E5E7EB", fontWeight: "900", fontSize: 15 }}>
              {t("client.profile.openSettings", "Settings")}
            </Text>
            <Text style={{ color: "#94A3B8", fontWeight: "700", marginTop: 3, fontSize: 12 }}>
              {t(
                "client.profile.openSettingsHint",
                "Language, notifications, security & more"
              )}
            </Text>
          </View>
          <Text style={{ color: "#93C5FD", fontWeight: "900", fontSize: 20 }}>›</Text>
        </TouchableOpacity>

        {/* Avatar */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            marginBottom: 16,
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: "#111827",
              borderWidth: 1,
              borderColor: "#374151",
              overflow: "hidden",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {avatarPreview ? (
              <Image
                source={{ uri: avatarPreview }}
                style={{ width: 64, height: 64 }}
                resizeMode="cover"
              />
            ) : (
              <View style={{ alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#E5E7EB", fontSize: 18, fontWeight: "900" }}>
                  {displayInitials}
                </Text>
                <Text style={{ color: "#9CA3AF", fontSize: 10, marginTop: 2 }}>
                  {t("client.profile.photo", "Photo")}
                </Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            onPress={pickAvatar}
            disabled={saving}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 10,
              backgroundColor: "#0B1220",
              borderWidth: 1,
              borderColor: "#334155",
              opacity: saving ? 0.7 : 1,
            }}
          >
            <Text style={{ color: "#93C5FD", fontWeight: "800" }}>
              {avatarPreview
                ? t("client.profile.changePhoto", "Changer la photo")
                : t("client.profile.addPhoto", "Ajouter une photo")}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Champs */}
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
          style={{
            borderWidth: 1,
            borderColor: "#374151",
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: "#E5E7EB",
            backgroundColor: "#0B1220",
            marginBottom: 4,
          }}
        />

        <View style={{ flexDirection: "row", gap: 10 }}>
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

        <View style={{ flexDirection: "row", gap: 10 }}>
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

        <Text style={{ color: "#64748B", marginTop: 6 }}>
          {t('client.profile.hint', 'Astuce: État = "NY", Pays = "US".')}
        </Text>

        <TouchableOpacity
          onPress={handleSave}
          disabled={saving || !profileComplete}
          style={{
            marginTop: 18,
            backgroundColor: profileComplete ? "#3B82F6" : "#334155",
            paddingVertical: 14,
            borderRadius: 10,
            alignItems: "center",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={{ color: "white", fontWeight: "800", fontSize: 16 }}>
              {t("client.profile.saveAndContinue", "Enregistrer et continuer")}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSignOut}
          disabled={signingOut || saving}
          style={{
            marginTop: 14,
            borderWidth: 1,
            borderColor: "rgba(148,163,184,0.35)",
            borderRadius: 12,
            paddingVertical: 12,
            alignItems: "center",
            backgroundColor: "rgba(15,23,42,0.9)",
            opacity: signingOut ? 0.7 : 1,
          }}
        >
          {signingOut ? (
            <ActivityIndicator color="#E2E8F0" />
          ) : (
            <Text style={{ color: "#E2E8F0", fontWeight: "800" }}>
              {t("client.profile.signOut.button", "Sign Out")}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() =>
            navigation.navigate("DeleteAccount", { role: "client" })
          }
          style={{
            marginTop: 14,
            borderWidth: 1,
            borderColor: "rgba(220,38,38,0.45)",
            borderRadius: 12,
            paddingVertical: 12,
            alignItems: "center",
            backgroundColor: "rgba(220,38,38,0.12)",
          }}
        >
          <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>
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
  return (
    <Text style={{ color: "#E5E7EB", marginBottom: 6, marginTop: 10 }}>
      {t(labelKey, fallback)}
    </Text>
  );
}

function Field(props: any) {
  return (
    <TextInput
      {...props}
      placeholderTextColor="#6B7280"
      autoCapitalize={props.autoCapitalize ?? "none"}
      autoCorrect={props.autoCorrect ?? false}
      style={{
        borderWidth: 1,
        borderColor: "#374151",
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        color: "white",
        backgroundColor: "#0B1220",
        marginBottom: 4,
      }}
    />
  );
}

export default ClientProfileScreen;
