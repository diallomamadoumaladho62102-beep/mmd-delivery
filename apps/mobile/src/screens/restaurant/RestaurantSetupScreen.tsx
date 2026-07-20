import { toUserFacingError } from "../../lib/userFacingError";
import React, { useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Switch,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
} from "react-native";
import { supabase } from "../../lib/supabase";
import { useTranslation } from "react-i18next";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";

type Props = { navigation: any };
type DocType = "license" | "tax" | "id";

type GeocodedAddress = {
  latitude: number;
  longitude: number;
  formattedAddress: string;
};

const BUCKET = "restaurant-docs";
const AVATARS_BUCKET = "avatars";
function cleanText(v: string) {
  return (v || "").trim();
}

function isHttpUrl(value: string | null | undefined) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function resolveStorageUrl(bucket: string, value: string | null | undefined) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  if (isHttpUrl(clean)) return clean;

  const normalizedPath = clean.replace(new RegExp(`^${bucket}\\/`), "");
  const { data } = supabase.storage.from(bucket).getPublicUrl(normalizedPath);
  return data?.publicUrl || null;
}

function initials(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "RS";
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

async function geocodeRestaurantAddress(fullAddress: string): Promise<GeocodedAddress> {
  const cleanAddress = cleanText(fullAddress);

  if (!cleanAddress) {
    throw new Error("Adresse complète du restaurant obligatoire.");
  }

  const { geocodeAddressViaApi } = await import("../../lib/serverGeocode");
  const result = await geocodeAddressViaApi(cleanAddress);

  const latitude = result.latitude;
  const longitude = result.longitude;

  if (!isValidCoordinate(latitude, longitude)) {
    throw new Error(
      "Adresse introuvable. Entre une adresse complète avec ville, État et code postal."
    );
  }

  return {
    latitude,
    longitude,
    formattedAddress: result.formattedAddress,
  };
}

function decodeBase64(base64: string) {
  if (typeof globalThis.atob === "function") return globalThis.atob(base64);

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
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function getExt(name?: string, mimeType?: string) {
  const n = (name || "").toLowerCase();

  if (mimeType === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (mimeType === "image/png" || n.endsWith(".png")) return "png";
  if (mimeType === "image/webp" || n.endsWith(".webp")) return "webp";
  return "jpg";
}

export default function RestaurantSetupScreen({ navigation }: Props) {
  const { t } = useTranslation();

  const [restaurantName, setRestaurantName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [cuisineType, setCuisineType] = useState("");
  const [description, setDescription] = useState("");
  const [logoLocalUri, setLogoLocalUri] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [coverLocalUri, setCoverLocalUri] = useState<string | null>(null);
  const [coverPath, setCoverPath] = useState<string | null>(null);

  const [offersDelivery, setOffersDelivery] = useState(true);
  const [offersPickup, setOffersPickup] = useState(true);
  const [offersDineIn, setOffersDineIn] = useState(false);

  const [docs, setDocs] = useState<
    Partial<Record<DocType, { uri: string; name: string; mimeType?: string }>>
  >({});

  const [loading, setLoading] = useState(false);

  const logoPreview = useMemo(
    () => logoLocalUri || resolveStorageUrl(AVATARS_BUCKET, logoPath),
    [logoLocalUri, logoPath]
  );

  const coverPreview = useMemo(
    () => coverLocalUri || resolveStorageUrl(AVATARS_BUCKET, coverPath),
    [coverLocalUri, coverPath]
  );

  useEffect(() => {
    let alive = true;

    async function loadExistingProfile() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user || !alive) return;

        const { data, error } = await supabase
          .from("restaurant_profiles")
          .select(
            "restaurant_name, phone, address, city, postal_code, cuisine_type, description, offers_delivery, offers_pickup, offers_dine_in, avatar_url, logo_url, cover_image_url, status"
          )
          .eq("user_id", user.id)
          .maybeSingle();

        if (error || !data || !alive) return;

        const row = data as any;

        setRestaurantName(row.restaurant_name ?? "");
        setPhone(row.phone ?? "");
        setAddress(row.address ?? "");
        setCity(row.city ?? "");
        setPostalCode(row.postal_code ?? "");
        setCuisineType(row.cuisine_type ?? "");
        setDescription(row.description ?? "");
        setOffersDelivery(Boolean(row.offers_delivery ?? true));
        setOffersPickup(Boolean(row.offers_pickup ?? true));
        setOffersDineIn(Boolean(row.offers_dine_in ?? false));
        setLogoPath(row.logo_url ?? row.avatar_url ?? null);
        setCoverPath(row.cover_image_url ?? null);
      } catch (error) {
        console.log("RestaurantSetup load existing profile ignored:", error);
      }
    }

    void loadExistingProfile();

    return () => {
      alive = false;
    };
  }, []);

  async function pickRestaurantLogo() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          t("restaurant.setup.alerts.permissionTitle", "Permission"),
          t(
            "restaurant.setup.alerts.permissionPhotos",
            "Autorise l’accès aux photos pour choisir le logo du restaurant."
          )
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      setLogoLocalUri(result.assets[0].uri);
    } catch (err: unknown) {
      Alert.alert(
        t("restaurant.setup.alerts.errorTitle", "Erreur"),
        toUserFacingError(err, "Impossible de choisir le logo."
)
      );
    }
  }

  async function uploadRestaurantLogoIfNeeded(userId: string) {
    if (!logoLocalUri) return logoPath;

    const filePath = `restaurants/${userId}/logo.jpg`;

    const base64 = await FileSystem.readAsStringAsync(logoLocalUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const bytes = base64ToUint8Array(base64);

    const { error } = await supabase.storage
      .from(AVATARS_BUCKET)
      .upload(filePath, bytes, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "3600",
      });

    if (error) throw new Error(toUserFacingError(error, "Une action temporairement impossible s'est produite. Veuillez réessayer."));

    return filePath;
  }

  async function pickRestaurantCover() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          t("restaurant.setup.alerts.permissionTitle", "Permission"),
          t(
            "restaurant.setup.alerts.permissionPhotosCover",
            "Autorise l’accès aux photos pour choisir la couverture du restaurant."
          )
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.85,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      setCoverLocalUri(result.assets[0].uri);
    } catch (err: unknown) {
      Alert.alert(
        t("restaurant.setup.alerts.errorTitle", "Erreur"),
        toUserFacingError(err, "Impossible de choisir la couverture.")
      );
    }
  }

  async function uploadRestaurantCoverIfNeeded(userId: string) {
    if (!coverLocalUri) return coverPath;

    const filePath = `restaurants/${userId}/cover.jpg`;

    const base64 = await FileSystem.readAsStringAsync(coverLocalUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const bytes = base64ToUint8Array(base64);

    const { error } = await supabase.storage
      .from(AVATARS_BUCKET)
      .upload(filePath, bytes, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "3600",
      });

    if (error) {
      throw new Error(
        toUserFacingError(error, "Une action temporairement impossible s'est produite. Veuillez réessayer.")
      );
    }

    return resolveStorageUrl(AVATARS_BUCKET, filePath) ?? filePath;
  }

  async function pickDocument(docType: DocType) {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      setDocs((prev) => ({
        ...prev,
        [docType]: {
          uri: asset.uri,
          name: asset.name || `${docType}`,
          mimeType: asset.mimeType,
        },
      }));
    } catch (err: unknown) {
      Alert.alert(
        t("restaurant.setup.alerts.errorTitle", "Erreur"),
        toUserFacingError(err, "Impossible de choisir le document."
)
      );
    }
  }

  async function uploadRestaurantDocument(params: {
    userId: string;
    docType: DocType;
    uri: string;
    name: string;
    mimeType?: string;
  }) {
    const { userId, docType, uri, name, mimeType } = params;

    const ext = getExt(name, mimeType);
    const filePath = `${userId}/${docType}.${ext}`;

    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const bytes = base64ToUint8Array(base64);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, bytes, {
        contentType:
          mimeType ||
          (ext === "pdf"
            ? "application/pdf"
            : ext === "png"
              ? "image/png"
              : ext === "webp"
                ? "image/webp"
                : "image/jpeg"),
        upsert: true,
      });

    if (uploadError) throw new Error(uploadError.message);

    const { error: dbError } = await supabase
      .from("restaurant_documents")
      .upsert(
        {
          user_id: userId,
          doc_type: docType,
          file_path: filePath,
          status: "pending",
          reviewed_at: null,
          reviewed_by: null,
          review_notes: null,
        },
        { onConflict: "user_id,doc_type" }
      );

    if (dbError) throw new Error(dbError.message);
  }

  async function uploadSelectedDocuments(userId: string) {
    const entries = Object.entries(docs) as Array<
      [DocType, { uri: string; name: string; mimeType?: string }]
    >;

    for (const [docType, doc] of entries) {
      await uploadRestaurantDocument({
        userId,
        docType,
        uri: doc.uri,
        name: doc.name,
        mimeType: doc.mimeType,
      });
    }
  }

  const onSave = async () => {
    if (loading) return;

    const name = cleanText(restaurantName);
    const restaurantPhone = cleanText(phone);
    const restaurantAddress = cleanText(address);
    const restaurantCity = cleanText(city);
    const restaurantPostalCode = cleanText(postalCode);
    const restaurantCuisineType = cleanText(cuisineType);
    const fullAddress = cleanText(
      `${restaurantAddress}, ${restaurantCity}, NY ${restaurantPostalCode}`
    );

    if (
      !name ||
      !restaurantPhone ||
      !restaurantAddress ||
      !restaurantCity ||
      !restaurantPostalCode ||
      !restaurantCuisineType
    ) {
      Alert.alert(
        t("restaurant.setup.alerts.errorTitle", "Erreur"),
        t(
          "restaurant.setup.alerts.requiredFields",
          "Remplis le nom, téléphone, adresse, ville, code postal et type de cuisine."
        )
      );
      return;
    }

    setLoading(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw new Error(userError.message);

      if (!user) {
        throw new Error(t("restaurant.setup.alerts.notLoggedIn", "Pas connecté"));
      }

      const geocoded = await geocodeRestaurantAddress(fullAddress);
      const finalLogoPath = await uploadRestaurantLogoIfNeeded(user.id);
      const finalCoverUrl = await uploadRestaurantCoverIfNeeded(user.id);

      const { data: existingProfile } = await supabase
        .from("restaurant_profiles")
        .select("status")
        .eq("user_id", user.id)
        .maybeSingle();

      const existingStatus = String((existingProfile as any)?.status ?? "").toLowerCase();
      const nextStatus =
        existingStatus === "approved" ||
        existingStatus === "suspended" ||
        existingStatus === "disabled"
          ? existingStatus
          : "pending";

      const payload = {
        user_id: user.id,
        email: user.email,
        restaurant_name: name,
        phone: restaurantPhone,
        address: geocoded.formattedAddress,
        city: restaurantCity,
        postal_code: restaurantPostalCode,
        cuisine_type: restaurantCuisineType,
        description: cleanText(description) || null,
        avatar_url: finalLogoPath ?? null,
        logo_url: finalLogoPath ?? null,
        cover_image_url: finalCoverUrl ?? null,
        location_lat: geocoded.latitude,
        location_lng: geocoded.longitude,
        opening_hours: {
          monday: { open: "09:00", close: "22:00" },
          tuesday: { open: "09:00", close: "22:00" },
          wednesday: { open: "09:00", close: "22:00" },
          thursday: { open: "09:00", close: "22:00" },
          friday: { open: "09:00", close: "22:00" },
          saturday: { open: "09:00", close: "22:00" },
          sunday: { open: "09:00", close: "22:00" },
        },
        offers_delivery: offersDelivery,
        offers_pickup: offersPickup,
        offers_dine_in: offersDineIn,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      };

      const { error: profileError } = await supabase
        .from("restaurant_profiles")
        .upsert(payload, { onConflict: "user_id" });

      if (profileError) throw new Error(profileError.message);

      // Never overwrite staff/founder roles — upserting role:'restaurant' was
      // demoting the official founder (is_founder stayed true, admin locked out).
      const { data: existingBaseProfile } = await supabase
        .from("profiles")
        .select("role, is_founder")
        .eq("id", user.id)
        .maybeSingle();

      const existingRole = String(
        (existingBaseProfile as { role?: string } | null)?.role ?? "",
      ).toLowerCase();
      const isFounder =
        (existingBaseProfile as { is_founder?: boolean } | null)?.is_founder ===
        true;
      const isStaffOrFounder =
        isFounder ||
        ["admin", "ops", "finance", "support", "review"].includes(existingRole);

      const profileSyncPayload: Record<string, unknown> = {
        id: user.id,
        full_name: name,
        phone: restaurantPhone,
        avatar_url: finalLogoPath ?? null,
        updated_at: new Date().toISOString(),
      };
      if (!isStaffOrFounder) {
        profileSyncPayload.role = "restaurant";
      }

      const { error: baseProfileError } = await supabase
        .from("profiles")
        .upsert(profileSyncPayload, { onConflict: "id" });

      if (baseProfileError) {
        console.log("RestaurantSetup profiles sync ignored:", baseProfileError);
      }

      setLogoPath(finalLogoPath ?? null);
      setLogoLocalUri(null);
      setCoverPath(finalCoverUrl ?? null);
      setCoverLocalUri(null);

      await uploadSelectedDocuments(user.id);

      Alert.alert(
        t("restaurant.setup.alerts.successTitle", "OK"),
        t(
          "restaurant.setup.alerts.successBody",
          "Profil envoyé. Documents envoyés si ajoutés. En attente d'approbation admin."
        )
      );

      navigation.replace("RestaurantGate");
    } catch (err: unknown) {
      Alert.alert(
        t("restaurant.setup.alerts.errorTitle", "Erreur"),
        toUserFacingError(err, "Erreur inconnue"
)
      );
    } finally {
      setLoading(false);
    }
  };

  const docButton = (docType: DocType, label: string) => (
    <TouchableOpacity
      disabled={loading}
      onPress={() => pickDocument(docType)}
      style={{
        borderWidth: 1,
        borderColor: "#2563EB",
        borderRadius: 10,
        padding: 12,
        backgroundColor: "rgba(37,99,235,0.08)",
        opacity: loading ? 0.6 : 1,
      }}
    >
      <Text style={{ color: "#1D4ED8", fontWeight: "800" }}>{label}</Text>
      <Text style={{ marginTop: 4, color: "#475569", fontWeight: "600" }}>
        {docs[docType]?.name || "Aucun fichier choisi"}
      </Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 36 }}
    >
      <Text style={{ fontSize: 20, fontWeight: "700" }}>
        {t("restaurant.setup.title", "Profil restaurant")}
      </Text>

      <View
        style={{
          borderWidth: 1,
          borderColor: "#CBD5E1",
          borderRadius: 16,
          padding: 14,
          backgroundColor: "#F8FAFC",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: "#E2E8F0",
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "#CBD5E1",
            }}
          >
            {logoPreview ? (
              <Image
                source={{ uri: logoPreview }}
                style={{ width: 72, height: 72 }}
                resizeMode="cover"
              />
            ) : (
              <Text style={{ color: "#0F172A", fontSize: 18, fontWeight: "900" }}>
                {initials(restaurantName)}
              </Text>
            )}
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: "#0F172A", fontWeight: "900", fontSize: 15 }}>
              {t("restaurant.setup.logo.title", "Logo / photo du restaurant")}
            </Text>
            <Text style={{ color: "#475569", marginTop: 4, fontWeight: "600" }}>
              {t(
                "restaurant.setup.logo.subtitle",
                "Cette image sera visible par le client, le driver et dans le chat."
              )}
            </Text>
            <TouchableOpacity
              disabled={loading}
              onPress={pickRestaurantLogo}
              style={{
                alignSelf: "flex-start",
                marginTop: 10,
                paddingVertical: 9,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: "#0F172A",
                opacity: loading ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "white", fontWeight: "900" }}>
                {logoPreview
                  ? t("restaurant.setup.logo.change", "Changer l’image")
                  : t("restaurant.setup.logo.add", "Ajouter une image")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View
        style={{
          borderWidth: 1,
          borderColor: "#CBD5E1",
          borderRadius: 16,
          padding: 14,
          backgroundColor: "#F8FAFC",
        }}
      >
        <View
          style={{
            width: "100%",
            height: 120,
            borderRadius: 12,
            backgroundColor: "#E2E8F0",
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: "#CBD5E1",
          }}
        >
          {coverPreview ? (
            <Image
              source={{ uri: coverPreview }}
              style={{ width: "100%", height: 120 }}
              resizeMode="cover"
            />
          ) : (
            <Text style={{ color: "#64748B", fontWeight: "700" }}>
              {t("restaurant.setup.cover.placeholder", "Couverture")}
            </Text>
          )}
        </View>
        <Text style={{ color: "#0F172A", fontWeight: "900", fontSize: 15, marginTop: 12 }}>
          {t("restaurant.setup.cover.title", "Image de couverture")}
        </Text>
        <Text style={{ color: "#475569", marginTop: 4, fontWeight: "600" }}>
          {t(
            "restaurant.setup.cover.subtitle",
            "Bannière affichée aux clients sur la fiche restaurant."
          )}
        </Text>
        <TouchableOpacity
          disabled={loading}
          onPress={pickRestaurantCover}
          style={{
            alignSelf: "flex-start",
            marginTop: 10,
            paddingVertical: 9,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: "#0F172A",
            opacity: loading ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "white", fontWeight: "900" }}>
            {coverPreview
              ? t("restaurant.setup.cover.change", "Changer la couverture")
              : t("restaurant.setup.cover.add", "Ajouter une couverture")}
          </Text>
        </TouchableOpacity>
      </View>

      <Text>{t("restaurant.setup.fields.restaurantName", "Nom du restaurant")}</Text>
      <TextInput
        value={restaurantName}
        onChangeText={setRestaurantName}
        editable={!loading}
        style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
      />

      <Text>{t("restaurant.setup.fields.phone", "Téléphone")}</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        editable={!loading}
        keyboardType="phone-pad"
        style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
      />

      <Text>{t("restaurant.setup.fields.address", "Adresse")}</Text>
      <TextInput
        value={address}
        onChangeText={setAddress}
        editable={!loading}
        placeholder="123 Main St"
        style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
      />

      <Text>{t("restaurant.setup.fields.city", "Ville")}</Text>
      <TextInput
        value={city}
        onChangeText={setCity}
        editable={!loading}
        placeholder="New York"
        style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
      />

      <Text>{t("restaurant.setup.fields.postalCode", "Code postal")}</Text>
      <TextInput
        value={postalCode}
        onChangeText={setPostalCode}
        editable={!loading}
        keyboardType="numbers-and-punctuation"
        placeholder="10001"
        style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
      />

      <Text>{t("restaurant.setup.fields.cuisineType", "Type de cuisine")}</Text>
      <TextInput
        value={cuisineType}
        onChangeText={setCuisineType}
        editable={!loading}
        style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
      />

      <Text>{t("restaurant.setup.fields.description", "Description")}</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        editable={!loading}
        multiline
        style={{ borderWidth: 1, padding: 10, borderRadius: 8, minHeight: 80 }}
      />

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text>{t("restaurant.setup.options.delivery", "Livraison")}</Text>
        <Switch disabled={loading} value={offersDelivery} onValueChange={setOffersDelivery} />
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text>{t("restaurant.setup.options.pickup", "À emporter")}</Text>
        <Switch disabled={loading} value={offersPickup} onValueChange={setOffersPickup} />
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text>{t("restaurant.setup.options.dineIn", "Sur place")}</Text>
        <Switch disabled={loading} value={offersDineIn} onValueChange={setOffersDineIn} />
      </View>

      <Text style={{ fontSize: 18, fontWeight: "800", marginTop: 10 }}>
        Documents restaurant
      </Text>

      {docButton("license", "Ajouter licence / permis")}
      {docButton("tax", "Ajouter document fiscal")}
      {docButton("id", "Ajouter pièce d’identité")}

      <TouchableOpacity
        disabled={loading}
        onPress={onSave}
        style={{
          marginTop: 8,
          backgroundColor: "#2563EB",
          paddingVertical: 14,
          borderRadius: 12,
          alignItems: "center",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={{ color: "white", fontWeight: "900" }}>
            {t("restaurant.setup.actions.save", "Enregistrer mon profil restaurant")}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}