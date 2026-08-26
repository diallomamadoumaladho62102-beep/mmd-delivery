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
  StatusBar,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useTranslation } from "react-i18next";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  MMD_BLUE,
  MMD_CARD_BORDER,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

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
        toUserFacingError(
          err,
          t("restaurant.setup.alerts.logoPickFailed", "Unable to pick the logo."),
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

    if (error) throw new Error(toUserFacingError(error));

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
        toUserFacingError(
          err,
          t(
            "restaurant.setup.alerts.coverPickFailed",
            "Unable to pick the cover image.",
          ),
        )
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
        toUserFacingError(error)
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
        toUserFacingError(
          err,
          t(
            "restaurant.setup.alerts.documentPickFailed",
            "Unable to pick the document.",
          ),
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
        [
          "admin",
          "super_admin",
          "founder",
          "ops",
          "operations_admin",
          "finance",
          "finance_admin",
          "support",
          "support_admin",
          "review",
          "review_admin",
        ].includes(existingRole);

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
        toUserFacingError(err),
      );
    } finally {
      setLoading(false);
    }
  };

  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const contentMax = width >= 768 ? 560 : undefined;
  const ctaBottom = Math.max(insets.bottom, 12) + 12;

  const docButton = (docType: DocType, label: string) => (
    <TouchableOpacity
      key={docType}
      disabled={loading}
      onPress={() => pickDocument(docType)}
      style={[styles.docCard, loading && styles.disabled]}
      activeOpacity={0.85}
    >
      <Text style={styles.docTitle}>{label}</Text>
      <Text style={styles.docMeta}>
        {docs[docType]?.name ||
          t("restaurant.setup.docs.none", "No file chosen")}
      </Text>
    </TouchableOpacity>
  );

  const iconField = (
    emoji: string,
    label: string,
    value: string,
    onChangeText: (v: string) => void,
    opts?: {
      placeholder?: string;
      keyboardType?: "default" | "phone-pad" | "numbers-and-punctuation";
      multiline?: boolean;
    },
  ) => (
    <View style={styles.fieldRow}>
      <View style={styles.iconBox}>
        <Text style={styles.iconEmoji}>{emoji}</Text>
      </View>
      <View style={[styles.inputShell, opts?.multiline && styles.inputShellTall]}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          editable={!loading}
          placeholder={opts?.placeholder}
          placeholderTextColor="rgba(255,255,255,0.4)"
          keyboardType={opts?.keyboardType}
          multiline={opts?.multiline}
          style={[styles.fieldInput, opts?.multiline && { minHeight: 36 }]}
        />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <View
        style={[
          styles.inner,
          contentMax ? { maxWidth: contentMax, alignSelf: "center", width: "100%" } : null,
        ]}
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
            {t("restaurant.setup.title", "Restaurant Profile")}
          </Text>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: 88 + ctaBottom },
          ]}
        >
          <View style={styles.card}>
            <View style={styles.mediaRow}>
              <View style={styles.iconBox}>
                <Text style={styles.iconEmoji}>📸</Text>
              </View>
              <View style={styles.mediaText}>
                <Text style={styles.mediaTitle}>
                  {t("restaurant.setup.logo.title", "Logo / Photo")}
                </Text>
                <Text style={styles.mediaSub}>
                  {t(
                    "restaurant.setup.logo.subtitle",
                    "Visible to customers, drivers, and in chat.",
                  )}
                </Text>
              </View>
              <TouchableOpacity
                disabled={loading}
                onPress={() => void pickRestaurantLogo()}
                style={[styles.logoThumb, loading && styles.disabled]}
                activeOpacity={0.85}
              >
                {logoPreview ? (
                  <Image
                    source={{ uri: logoPreview }}
                    style={styles.logoThumbImg}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.logoThumbInitials}>
                    {initials(restaurantName)}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.mediaRow}>
              <View style={styles.iconBox}>
                <Text style={styles.iconEmoji}>🖼️</Text>
              </View>
              <View style={styles.mediaText}>
                <Text style={styles.mediaTitle}>
                  {t("restaurant.setup.cover.title", "Cover Image")}
                </Text>
                <Text style={styles.mediaSub}>
                  {t(
                    "restaurant.setup.cover.subtitle",
                    "Banner shown to customers on the restaurant page.",
                  )}
                </Text>
              </View>
              <TouchableOpacity
                disabled={loading}
                onPress={() => void pickRestaurantCover()}
                style={[styles.addBtn, loading && styles.disabled]}
                activeOpacity={0.85}
              >
                {coverPreview ? (
                  <Image
                    source={{ uri: coverPreview }}
                    style={styles.coverThumb}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.addBtnText}>
                    {t("restaurant.setup.cover.addShort", "Add")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {iconField(
              "🍽️",
              t("restaurant.setup.fields.restaurantName", "Restaurant Name"),
              restaurantName,
              setRestaurantName,
            )}
            {iconField(
              "📞",
              t("restaurant.setup.fields.phone", "Phone"),
              phone,
              setPhone,
              { keyboardType: "phone-pad", placeholder: "+1 212 555 0100" },
            )}
            {iconField(
              "📍",
              t("restaurant.setup.fields.address", "Address"),
              address,
              setAddress,
              { placeholder: "123 Main St" },
            )}
            {iconField(
              "🏙️",
              t("restaurant.setup.fields.city", "City"),
              city,
              setCity,
              { placeholder: "New York" },
            )}
            {iconField(
              "📮",
              t("restaurant.setup.fields.postalCode", "Zip Code"),
              postalCode,
              setPostalCode,
              {
                keyboardType: "numbers-and-punctuation",
                placeholder: "10001",
              },
            )}
            {iconField(
              "🍳",
              t("restaurant.setup.fields.cuisineType", "Cuisine Type"),
              cuisineType,
              setCuisineType,
            )}
            {iconField(
              "📝",
              t("restaurant.setup.fields.description", "Description"),
              description,
              setDescription,
              { multiline: true },
            )}

            <View style={styles.offerings}>
              <Text style={styles.offeringsTitle}>
                {t("restaurant.setup.offerings", "Offerings")}
              </Text>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>
                  {t("restaurant.setup.options.delivery", "Delivery")}
                </Text>
                <Switch
                  disabled={loading}
                  value={offersDelivery}
                  onValueChange={setOffersDelivery}
                  trackColor={{ false: "rgba(255,255,255,0.2)", true: MMD_TAXI_GREEN }}
                  thumbColor={MMD_WHITE}
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>
                  {t("restaurant.setup.options.pickup", "Takeout")}
                </Text>
                <Switch
                  disabled={loading}
                  value={offersPickup}
                  onValueChange={setOffersPickup}
                  trackColor={{ false: "rgba(255,255,255,0.2)", true: MMD_TAXI_GREEN }}
                  thumbColor={MMD_WHITE}
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>
                  {t("restaurant.setup.options.dineIn", "Dine-in")}
                </Text>
                <Switch
                  disabled={loading}
                  value={offersDineIn}
                  onValueChange={setOffersDineIn}
                  trackColor={{ false: "rgba(255,255,255,0.2)", true: MMD_TAXI_GREEN }}
                  thumbColor={MMD_WHITE}
                />
              </View>
            </View>

            {docButton(
              "license",
              t("restaurant.setup.docs.license", "License / Permit"),
            )}
            {docButton(
              "tax",
              t("restaurant.setup.docs.tax", "Tax Document"),
            )}
            {docButton("id", t("restaurant.setup.docs.id", "ID Card"))}
          </View>
        </ScrollView>

        <TouchableOpacity
          disabled={loading}
          onPress={() => void onSave()}
          style={[
            styles.cta,
            { bottom: ctaBottom },
            loading && { opacity: 0.85 },
          ]}
          activeOpacity={0.9}
        >
          {loading ? (
            <ActivityIndicator color={MMD_WHITE} />
          ) : (
            <Text style={styles.ctaText}>
              {t(
                "restaurant.setup.actions.save",
                "Save Restaurant Profile",
              )}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  inner: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  header: { alignItems: "center", gap: 12, marginBottom: 16 },
  headerLogo: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: MMD_CARD_BORDER,
  },
  brandTitle: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 22,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    textAlign: "center",
  },
  screenTitle: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  scroll: { paddingBottom: 88, gap: 0 },
  card: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_CARD_BORDER,
    borderRadius: 16,
    padding: 16,
    gap: 16,
  },
  mediaRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  mediaText: { flex: 1, minWidth: 0, gap: 2 },
  mediaTitle: {
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  mediaSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_CARD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  iconEmoji: { fontSize: 18 },
  logoThumb: {
    width: 51,
    height: 32,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_CARD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  logoThumbImg: { width: "100%", height: "100%" },
  logoThumbInitials: {
    color: MMD_WHITE,
    fontSize: 11,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  addBtn: {
    minWidth: 51,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: MMD_GOLD_CLASSIC,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  addBtnText: {
    color: MMD_BLUE,
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  coverThumb: { width: 51, height: 32 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  inputShell: {
    flex: 1,
    minHeight: 50,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 3,
    justifyContent: "center",
  },
  inputShellTall: { minHeight: 72 },
  fieldLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  fieldInput: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    padding: 0,
    margin: 0,
  },
  offerings: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_CARD_BORDER,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  offeringsTitle: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchLabel: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  docCard: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_CARD_BORDER,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  docTitle: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  docMeta: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  cta: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    height: 56,
    borderRadius: 12,
    backgroundColor: MMD_TAXI_GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  disabled: { opacity: 0.6 },
});