import React, { useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Switch,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { supabase } from "../../lib/supabase";
import { useTranslation } from "react-i18next";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

type Props = { navigation: any };
type DocType = "license" | "tax" | "id";

const BUCKET = "restaurant-docs";

function cleanText(v: string) {
  return (v || "").trim();
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

  const [offersDelivery, setOffersDelivery] = useState(true);
  const [offersPickup, setOffersPickup] = useState(true);
  const [offersDineIn, setOffersDineIn] = useState(false);

  const [docs, setDocs] = useState<
    Partial<Record<DocType, { uri: string; name: string; mimeType?: string }>>
  >({});

  const [loading, setLoading] = useState(false);

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
        err instanceof Error ? err.message : "Impossible de choisir le document."
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

    if (!name || !restaurantPhone || !restaurantAddress || !restaurantCity || !restaurantPostalCode || !restaurantCuisineType) {
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

      const payload = {
        user_id: user.id,
        email: user.email,
        restaurant_name: name,
        phone: restaurantPhone,
        address: restaurantAddress,
        city: restaurantCity,
        postal_code: restaurantPostalCode,
        cuisine_type: restaurantCuisineType,
        description: cleanText(description) || null,
        opening_hours: null,
        offers_delivery: offersDelivery,
        offers_pickup: offersPickup,
        offers_dine_in: offersDineIn,
        status: "pending" as const,
        updated_at: new Date().toISOString(),
      };

      const { error: profileError } = await supabase
        .from("restaurant_profiles")
        .upsert(payload, { onConflict: "user_id" });

      if (profileError) throw new Error(profileError.message);

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
        err instanceof Error ? err.message : "Erreur inconnue"
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
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "700" }}>
        {t("restaurant.setup.title", "Profil restaurant")}
      </Text>

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
        style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
      />

      <Text>{t("restaurant.setup.fields.city", "Ville")}</Text>
      <TextInput
        value={city}
        onChangeText={setCity}
        editable={!loading}
        style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
      />

      <Text>{t("restaurant.setup.fields.postalCode", "Code postal")}</Text>
      <TextInput
        value={postalCode}
        onChangeText={setPostalCode}
        editable={!loading}
        keyboardType="numbers-and-punctuation"
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