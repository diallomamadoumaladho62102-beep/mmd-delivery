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
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../lib/supabase";
import { uploadFile } from "../lib/uploadFile";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

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

  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarLocalUri, setAvatarLocalUri] = useState<string | null>(null);

  const profileComplete = useMemo(() => {
    return (
      trimOrEmpty(fullName).length > 1 &&
      trimOrEmpty(phone).length >= 7 &&
      trimOrEmpty(address).length > 3 &&
      trimOrEmpty(city).length > 1 &&
      trimOrEmpty(state).length >= 2 &&
      trimOrEmpty(postalCode).length >= 4 &&
      trimOrEmpty(country).length >= 2 &&
      !!(avatarUrl || avatarLocalUri)
    );
  }, [
    fullName,
    phone,
    address,
    city,
    state,
    postalCode,
    country,
    avatarUrl,
    avatarLocalUri,
  ]);

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

        const { data, error } = await supabase
          .from("client_profiles")
          .select("*")
          .eq("user_id", uid)
          .maybeSingle();

        if (error) {
          console.log("load client_profiles error (ignored):", error);
          return;
        }

        const row = data as ProfileRow | null;
        if (!alive || !row) return;

        setFullName(row.full_name ?? "");
        setPhone(row.phone ?? "");

        const addr = row.address ?? row.address_line1 ?? "";
        setAddress(addr ?? "");

        setCity(row.city ?? "");
        setState(row.state ?? "");

        const zipLike = row.postal_code ?? row.zip ?? "";
        setPostalCode(zipLike ?? "");

        setCountry(row.country ?? "US");
        setAvatarUrl(row.avatar_url ?? null);
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
  }) {
    const { uid, addressLine1, city, state, postalCode, country } = params;

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
      if (trimOrEmpty(city).length < 2)
        return Alert.alert(
          t("client.profile.cityTitle", "Ville"),
          t("client.profile.cityError", "Entre une ville valide.")
        );
      if (trimOrEmpty(state).length < 2)
        return Alert.alert(
          t("client.profile.stateTitle", "État"),
          t("client.profile.stateError", "Ex: NY")
        );
      if (trimOrEmpty(postalCode).length < 4)
        return Alert.alert(
          t("client.profile.zipTitle", "ZIP"),
          t("client.profile.zipError", "Ex: 11207")
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

      await upsertClientAddress({
        uid,
        addressLine1: addr1,
        city: trimOrEmpty(city),
        state: normState,
        postalCode: zipVal,
        country: normCountry,
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
      >
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color="#fff" />
        <Text style={{ color: "#9CA3AF", marginTop: 10 }}>
          {t("client.profile.loading", "Chargement du profil...")}
        </Text>
      </SafeAreaView>
    );
  }

  const avatarPreview = avatarLocalUri || avatarUrl;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={{ flex: 1, padding: 20 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Text
          style={{
            fontSize: 24,
            fontWeight: "800",
            color: "white",
            marginBottom: 8,
          }}
        >
          {t("client.profile.title", "Profil client")}
        </Text>

        <Text style={{ color: "#9CA3AF", marginBottom: 18 }}>
          {t(
            "client.profile.subtitle",
            "Complète ton profil (photo, adresse, téléphone) pour passer des commandes."
          )}
        </Text>

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
              <Image source={{ uri: avatarPreview }} style={{ width: 64, height: 64 }} />
            ) : (
              <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                {t("client.profile.photo", "Photo")}
              </Text>
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

        <Label t={tt} labelKey="client.profile.fields.address" fallback="Adresse" />
        <Field
          value={address}
          onChangeText={setAddress}
          placeholder={t("client.profile.placeholders.address", "Ex: 686 Vermont St")}
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