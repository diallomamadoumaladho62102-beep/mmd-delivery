import React, { useCallback, useMemo, useState } from "react";
import { decode } from "base64-arraybuffer";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Platform,
  ActionSheetIOS,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "../lib/supabase";
import { startStripeOnboarding } from "../utils/stripe";
import { useTranslation } from "react-i18next";

const AVATARS_BUCKET = "avatars";
const DRIVER_DOCS_BUCKET = "driver-docs";

type TransportMode = "bike" | "moto" | "car";

type DriverDocumentType =
  | "profile_photo"
  | "id_card_front"
  | "id_card_back"
  | "license_front"
  | "license_back"
  | "insurance"
  | "registration";

type ProfileRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: string | null;
  avatar_url?: string | null;
  emergency_phone?: string | null;
  state?: string | null;
  zip_code?: string | null;
  personal_photo_url?: string | null;
};

type DriverProfileRow = {
  id?: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  emergency_phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  date_of_birth: string | null;
  transport_mode: string | null;
  vehicle_type: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  plate_number: string | null;
  license_number: string | null;
  license_expiry: string | null;
  is_online: boolean | null;
  total_deliveries: number | null;
  acceptance_rate: number | null;
  cancellation_rate: number | null;
  rating: number | null;
  rating_count: number | null;
  vehicle_verified: boolean | null;
  payout_enabled: boolean | null;
  documents_required: boolean | null;
  stripe_account_id: string | null;
  stripe_onboarded: boolean | null;
  stripe_onboarded_at?: string | null;
  driver_score: number | null;
  driver_tier: number | null;
  last_assigned_at?: string | null;
  status: string | null;
  missing_requirements: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type DriverDocumentRow = {
  id?: string;
  user_id: string;
  doc_type: DriverDocumentType | string;
  file_path: string;
  country?: string | null;
  state?: string | null;
  doc_number?: string | null;
  expires_at?: string | null;
  status?: string | null;
  review_notes?: string | null;
  created_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  driver_id?: string | null;
};

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type DriverRatingRow = {
  rating: number;
  created_at: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeZip(value: string): string {
  return value.trim();
}

function normalizeYearInput(value: string): number | "" {
  if (!value.trim()) return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : "";
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function fmtShortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function pct(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(Number(n))}%`;
}

function inferExt(name: string, mime: string) {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".png")) return "png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "jpg";
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return "bin";
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: "white",
        fontSize: 16,
        fontWeight: "900",
        marginTop: 18,
        marginBottom: 10,
      }}
    >
      {children}
    </Text>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: "#0B1220",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "#111827",
        padding: 14,
      }}
    >
      {children}
    </View>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: "#111827" }} />;
}

function Row({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      onPress={onPress}
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 12,
      }}
    >
      <Text style={{ color: "#CBD5E1", fontWeight: "800", flex: 1, paddingRight: 12 }}>
        {label}
      </Text>
      <Text
        style={{
          color: "white",
          fontWeight: "800",
          flexShrink: 1,
          textAlign: "right",
        }}
      >
        {value ?? "—"}
      </Text>
    </Wrapper>
  );
}

function StarsRow({
  rating,
  count,
  size = 14,
}: {
  rating: number | null | undefined;
  count: number;
  size?: number;
}) {
  if (!count) {
    return (
      <Text style={{ color: "#374151", fontSize: size, fontWeight: "900" }}>
        {"☆".repeat(5)}
      </Text>
    );
  }

  const v = clamp(rating ?? 0, 0, 5);
  const full = Math.floor(v);
  const half = v - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Text style={{ color: "#FBBF24", fontSize: size, fontWeight: "900" }}>
        {"★".repeat(full)}
      </Text>
      {half ? (
        <Text style={{ color: "#FBBF24", fontSize: size, fontWeight: "900" }}>½</Text>
      ) : null}
      <Text style={{ color: "#374151", fontSize: size, fontWeight: "900" }}>
        {"☆".repeat(empty)}
      </Text>
    </View>
  );
}

export function DriverProfileScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [driver, setDriver] = useState<DriverProfileRow | null>(null);
  const [driverDocuments, setDriverDocuments] = useState<DriverDocumentRow[]>([]);

  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [stripeOnboarded, setStripeOnboarded] = useState(false);

  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [avatarUpdatedAt, setAvatarUpdatedAt] = useState<number>(0);

  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [ratingHistory, setRatingHistory] = useState<DriverRatingRow[]>([]);

  const [statsDeliveries, setStatsDeliveries] = useState(0);
  const [statsAcceptanceRate, setStatsAcceptanceRate] = useState(0);
  const [statsCancellationRate, setStatsCancellationRate] = useState(0);

  const [editOpen, setEditOpen] = useState(false);

  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmergencyPhone, setEditEmergencyPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editState, setEditState] = useState("");
  const [editZipCode, setEditZipCode] = useState("");
  const [editDateOfBirth, setEditDateOfBirth] = useState("");
  const [editTransportMode, setEditTransportMode] = useState<TransportMode>("bike");
  const [editVehicleBrand, setEditVehicleBrand] = useState("");
  const [editVehicleModel, setEditVehicleModel] = useState("");
  const [editVehicleYear, setEditVehicleYear] = useState<number | "">("");
  const [editVehicleColor, setEditVehicleColor] = useState("");
  const [editPlateNumber, setEditPlateNumber] = useState("");
  const [editLicenseNumber, setEditLicenseNumber] = useState("");
  const [editLicenseExpiry, setEditLicenseExpiry] = useState("");

  const [authFallbackName, setAuthFallbackName] = useState(
    t("driver.profile.authFallbackName", { defaultValue: "Chauffeur" }),
  );

  const transportLabelI18n = useCallback(
    (mode: TransportMode) => {
      if (mode === "bike") {
        return t("driver.auth.transport.bike", { defaultValue: "🚲 Vélo" });
      }
      if (mode === "moto") {
        return t("driver.auth.transport.moto", { defaultValue: "🛵 Moto" });
      }
      return t("driver.auth.transport.car", { defaultValue: "🚗 Voiture" });
    },
    [t],
  );

  const driverDocumentLabel = useCallback(
    (docType: DriverDocumentType) => {
      switch (docType) {
        case "profile_photo":
          return t("driver.profile.docs.profilePhoto", { defaultValue: "Photo personnelle" });
        case "id_card_front":
          return t("driver.profile.docs.idFront", { defaultValue: "Pièce d’identité recto" });
        case "id_card_back":
          return t("driver.profile.docs.idBack", { defaultValue: "Pièce d’identité verso" });
        case "license_front":
          return t("driver.profile.docs.licenseFront", { defaultValue: "Permis recto" });
        case "license_back":
          return t("driver.profile.docs.licenseBack", { defaultValue: "Permis verso" });
        case "insurance":
          return t("driver.profile.docs.insurance", { defaultValue: "Assurance" });
        case "registration":
          return t("driver.profile.docs.registration", { defaultValue: "Registration" });
        default:
          return docType;
      }
    },
    [t],
  );

  const tierLabelI18n = useCallback(
    (tier: number | null | undefined) => {
      if (tier === 1) return t("common.driverTier.elite", { defaultValue: "🏆 Elite" });
      if (tier === 2) return t("common.driverTier.confirmed", { defaultValue: "⭐ Confirmé" });
      if (tier === 3) return t("common.driverTier.standard", { defaultValue: "🔄 Standard" });
      return t("common.driverTier.needsImprovement", { defaultValue: "⚠️ À améliorer" });
    },
    [t],
  );

  const transportMode: TransportMode = useMemo(() => {
    const mode = String(driver?.transport_mode ?? "").toLowerCase();
    if (mode === "bike" || mode === "moto" || mode === "car") return mode;
    return "bike";
  }, [driver?.transport_mode]);

  const isBike = transportMode === "bike";

  const headerName = useMemo(() => {
    return (
      driver?.full_name?.trim() ||
      profile?.full_name?.trim() ||
      authFallbackName?.trim() ||
      t("driver.profile.authFallbackName", { defaultValue: "Chauffeur" })
    );
  }, [driver?.full_name, profile?.full_name, authFallbackName, t]);

  const fallbackAvatarUri = useMemo(() => {
    const safe = encodeURIComponent(headerName || "Chauffeur");
    return `https://ui-avatars.com/api/?name=${safe}&background=111827&color=fff&size=128`;
  }, [headerName]);

  const avatarUri = useMemo(() => {
    if (avatarBroken) return fallbackAvatarUri;
    if (!avatarUrl) return fallbackAvatarUri;
    const sep = avatarUrl.includes("?") ? "&" : "?";
    const buster = avatarUpdatedAt || avatarPath || Date.now();
    return `${avatarUrl}${sep}v=${encodeURIComponent(String(buster))}`;
  }, [avatarBroken, avatarPath, avatarUpdatedAt, avatarUrl, fallbackAvatarUri]);

  const phoneToShow = useMemo(() => {
    return profile?.phone?.trim() || driver?.phone?.trim() || "—";
  }, [profile?.phone, driver?.phone]);

  const docTypeSet = useMemo(() => {
    return new Set(driverDocuments.map((doc) => String(doc.doc_type)));
  }, [driverDocuments]);

  const hasProfilePhoto = docTypeSet.has("profile_photo");
  const hasIdFront = docTypeSet.has("id_card_front");
  const hasIdBack = docTypeSet.has("id_card_back");
  const hasLicenseFront = docTypeSet.has("license_front");
  const hasLicenseBack = docTypeSet.has("license_back");
  const hasInsurance = docTypeSet.has("insurance");
  const hasRegistration = docTypeSet.has("registration");
  const hasLicense = hasLicenseFront && hasLicenseBack;

  const isBaseComplete = useMemo(() => {
    return (
      !!trimOrNull(driver?.full_name ?? profile?.full_name ?? "") &&
      !!trimOrNull(driver?.phone ?? profile?.phone ?? "") &&
      !!trimOrNull(driver?.emergency_phone ?? "") &&
      !!trimOrNull(driver?.address ?? "") &&
      !!trimOrNull(driver?.city ?? "") &&
      !!trimOrNull(driver?.state ?? "") &&
      !!trimOrNull(normalizeZip(driver?.zip_code ?? "")) &&
      !!trimOrNull(driver?.date_of_birth ?? "") &&
      hasProfilePhoto &&
      hasIdFront &&
      hasIdBack
    );
  }, [
    driver?.address,
    driver?.city,
    driver?.date_of_birth,
    driver?.emergency_phone,
    driver?.full_name,
    driver?.phone,
    driver?.state,
    driver?.zip_code,
    hasIdBack,
    hasIdFront,
    hasProfilePhoto,
    profile?.full_name,
    profile?.phone,
  ]);

  const isMotorComplete = useMemo(() => {
    if (isBike) return true;
    return (
      !!trimOrNull(driver?.license_number ?? "") &&
      !!trimOrNull(driver?.license_expiry ?? "") &&
      !!trimOrNull(driver?.vehicle_brand ?? "") &&
      !!trimOrNull(driver?.vehicle_model ?? "") &&
      !!driver?.vehicle_year &&
      !!trimOrNull(driver?.vehicle_color ?? "") &&
      !!trimOrNull(driver?.plate_number ?? "") &&
      hasLicense &&
      hasInsurance &&
      hasRegistration
    );
  }, [
    driver?.license_expiry,
    driver?.license_number,
    driver?.plate_number,
    driver?.vehicle_brand,
    driver?.vehicle_color,
    driver?.vehicle_model,
    driver?.vehicle_year,
    hasInsurance,
    hasLicense,
    hasRegistration,
    isBike,
  ]);

  const isProfileComplete = isBaseComplete && isMotorComplete;

  const verifiedLabel = useMemo(() => {
    if (isProfileComplete) {
      return t("driver.profile.verified.full", { defaultValue: "Dossier complet ✅" });
    }
    return t("driver.profile.verified.notVerified", { defaultValue: "Profil incomplet ❌" });
  }, [isProfileComplete, t]);

  const paymentLabel = useMemo(() => {
    return stripeOnboarded
      ? t("common.ready", { defaultValue: "✅ Configuré" })
      : t("common.notConfigured", { defaultValue: "❌ Non configuré" });
  }, [stripeOnboarded, t]);

  const vehicleLine = useMemo(() => {
    if (transportMode === "bike") return "—";
    const parts = [
      driver?.vehicle_year ? String(driver.vehicle_year) : null,
      driver?.vehicle_brand ?? null,
      driver?.vehicle_model ?? null,
    ].filter(Boolean);
    const base = parts.length ? parts.join(" ") : "—";
    const plate = driver?.plate_number ? ` • ${driver.plate_number}` : "";
    return `${base}${plate}`;
  }, [driver?.plate_number, driver?.vehicle_brand, driver?.vehicle_model, driver?.vehicle_year, transportMode]);

  const isTopDriver = useMemo(() => {
    return (avgRating ?? 0) >= 4.7 && statsDeliveries >= 20 && statsCancellationRate <= 10;
  }, [avgRating, statsCancellationRate, statsDeliveries]);

  const driverScore = useMemo(() => {
    if (typeof driver?.driver_score === "number" && Number.isFinite(driver.driver_score)) {
      return driver.driver_score;
    }
    const ratingPart = clamp(((avgRating ?? 0) / 5) * 100, 0, 100);
    const deliveryPart = clamp((statsDeliveries / 20) * 100, 0, 100);
    const cancelPart = clamp(100 - statsCancellationRate, 0, 100);
    return Math.round(ratingPart * 0.5 + deliveryPart * 0.3 + cancelPart * 0.2);
  }, [avgRating, driver?.driver_score, statsCancellationRate, statsDeliveries]);

  const driverTier = useMemo(() => {
    if (typeof driver?.driver_tier === "number" && Number.isFinite(driver.driver_tier)) {
      return driver.driver_tier;
    }
    if (driverScore >= 85) return 1;
    if (driverScore >= 65) return 2;
    if (driverScore >= 40) return 3;
    return 4;
  }, [driver?.driver_tier, driverScore]);

  const missingRequirements = useMemo(() => {
    const missing: string[] = [];

    if (!trimOrNull(driver?.full_name ?? profile?.full_name ?? "")) {
      missing.push(t("common.profile.name", { defaultValue: "Nom complet" }));
    }
    if (!trimOrNull(driver?.phone ?? profile?.phone ?? "")) {
      missing.push(t("common.profile.phone", { defaultValue: "Téléphone" }));
    }
    if (!trimOrNull(driver?.emergency_phone ?? "")) {
      missing.push(t("common.profile.emergencyPhone", { defaultValue: "Téléphone d’urgence" }));
    }
    if (!trimOrNull(driver?.address ?? "")) {
      missing.push(t("common.profile.address", { defaultValue: "Adresse" }));
    }
    if (!trimOrNull(driver?.city ?? "")) {
      missing.push(t("common.profile.city", { defaultValue: "Ville" }));
    }
    if (!trimOrNull(driver?.state ?? "")) {
      missing.push(t("common.profile.state", { defaultValue: "État" }));
    }
    if (!trimOrNull(normalizeZip(driver?.zip_code ?? ""))) {
      missing.push(t("common.profile.zip", { defaultValue: "ZIP code" }));
    }
    if (!trimOrNull(driver?.date_of_birth ?? "")) {
      missing.push(t("common.profile.dateOfBirth", { defaultValue: "Date de naissance" }));
    }
    if (!hasProfilePhoto) {
      missing.push(t("driver.profile.docs.profilePhoto", { defaultValue: "Photo personnelle" }));
    }
    if (!hasIdFront) {
      missing.push(t("driver.profile.docs.idFront", { defaultValue: "Pièce d’identité recto" }));
    }
    if (!hasIdBack) {
      missing.push(t("driver.profile.docs.idBack", { defaultValue: "Pièce d’identité verso" }));
    }

    if (!isBike) {
      if (!trimOrNull(driver?.license_number ?? "")) {
        missing.push(t("driver.profile.licenseNumber", { defaultValue: "Numéro du permis" }));
      }
      if (!trimOrNull(driver?.license_expiry ?? "")) {
        missing.push(
          t("driver.profile.licenseExpiry", { defaultValue: "Expiration du permis" }),
        );
      }
      if (!trimOrNull(driver?.vehicle_brand ?? "")) {
        missing.push(t("common.profile.brand", { defaultValue: "Marque" }));
      }
      if (!trimOrNull(driver?.vehicle_model ?? "")) {
        missing.push(t("common.profile.model", { defaultValue: "Modèle" }));
      }
      if (!driver?.vehicle_year) {
        missing.push(t("common.profile.year", { defaultValue: "Année" }));
      }
      if (!trimOrNull(driver?.vehicle_color ?? "")) {
        missing.push(t("common.profile.color", { defaultValue: "Couleur" }));
      }
      if (!trimOrNull(driver?.plate_number ?? "")) {
        missing.push(t("common.profile.plate", { defaultValue: "Plaque" }));
      }
      if (!hasLicenseFront) {
        missing.push(
          t("driver.profile.docs.licenseFront", { defaultValue: "Permis recto" }),
        );
      }
      if (!hasLicenseBack) {
        missing.push(t("driver.profile.docs.licenseBack", { defaultValue: "Permis verso" }));
      }
      if (!hasInsurance) {
        missing.push(t("driver.profile.docs.insurance", { defaultValue: "Assurance" }));
      }
      if (!hasRegistration) {
        missing.push(t("driver.profile.docs.registration", { defaultValue: "Registration" }));
      }
    }

    return missing;
  }, [
    driver?.address,
    driver?.city,
    driver?.date_of_birth,
    driver?.emergency_phone,
    driver?.full_name,
    driver?.license_expiry,
    driver?.license_number,
    driver?.phone,
    driver?.plate_number,
    driver?.state,
    driver?.vehicle_brand,
    driver?.vehicle_color,
    driver?.vehicle_model,
    driver?.vehicle_year,
    driver?.zip_code,
    hasIdBack,
    hasIdFront,
    hasInsurance,
    hasLicenseBack,
    hasLicenseFront,
    hasProfilePhoto,
    hasRegistration,
    isBike,
    profile?.full_name,
    profile?.phone,
    t,
  ]);

  const refreshAvatarUrl = useCallback(async (path: string | null) => {
    if (!path) {
      setAvatarUrl(null);
      setAvatarBroken(false);
      return;
    }

    try {
      setAvatarBroken(false);
      const pub = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
      setAvatarUrl(pub.data.publicUrl ?? null);
    } catch (error) {
      console.log("refreshAvatarUrl error", error);
      setAvatarUrl(null);
      setAvatarBroken(false);
    }
  }, []);

  const refreshStripeStatus = useCallback(async (uid: string) => {
    try {
      const { error: syncErr } = await supabase.functions.invoke("check_connect_status");
      if (syncErr) {
        console.log("check_connect_status error:", syncErr);
      }

      const { data, error } = await supabase
        .from("driver_profiles")
        .select("stripe_account_id, stripe_onboarded")
        .eq("user_id", uid)
        .maybeSingle();

      if (error) {
        console.log("refreshStripeStatus error", error);
        setStripeAccountId(null);
        setStripeOnboarded(false);
        return;
      }

      setStripeAccountId((data as DriverProfileRow | null)?.stripe_account_id ?? null);
      setStripeOnboarded(Boolean((data as DriverProfileRow | null)?.stripe_onboarded));
    } catch (error) {
      console.log("refreshStripeStatus catch", error);
      setStripeAccountId(null);
      setStripeOnboarded(false);
    }
  }, []);

  const loadDocs = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from("driver_documents")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });

    if (error) {
      console.log("loadDocs error", error);
      setDriverDocuments([]);
      return;
    }

    const latestByType = new Map<string, DriverDocumentRow>();
    for (const row of (data ?? []) as DriverDocumentRow[]) {
      const key = String(row.doc_type);
      if (!latestByType.has(key)) {
        latestByType.set(key, row);
      }
    }

    setDriverDocuments(Array.from(latestByType.values()));
  }, []);

  const loadRating = useCallback(async (uid: string) => {
    try {
      const { data: sum, error: sumErr } = await supabase
        .from("driver_rating_summary")
        .select("rating, rating_count")
        .eq("driver_id", uid)
        .maybeSingle();

      if (!sumErr && sum && Number((sum as any).rating_count) > 0) {
        const rating = Number((sum as any).rating);
        const count = Number((sum as any).rating_count);
        setAvgRating(Number.isFinite(rating) ? rating : null);
        setRatingCount(Number.isFinite(count) ? count : 0);
        return;
      }

      const { data, error } = await supabase
        .from("driver_ratings")
        .select("rating")
        .eq("ratee_driver_id", uid)
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        console.log("driver_ratings error", error);
        setAvgRating(null);
        setRatingCount(0);
        return;
      }

      const ratings = (data ?? [])
        .map((row: any) => Number(row.rating))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);

      if (!ratings.length) {
        setAvgRating(null);
        setRatingCount(0);
        return;
      }

      const sumRatings = ratings.reduce((acc, value) => acc + value, 0);
      setAvgRating(sumRatings / ratings.length);
      setRatingCount(ratings.length);
    } catch (error) {
      console.log("loadRating error", error);
      setAvgRating(null);
      setRatingCount(0);
    }
  }, []);

  const loadRatingHistory = useCallback(async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from("driver_ratings")
        .select("rating, created_at")
        .eq("ratee_driver_id", uid)
        .order("created_at", { ascending: true })
        .limit(100);

      if (error) {
        console.log("loadRatingHistory error", error);
        setRatingHistory([]);
        return;
      }

      const rows = (data ?? [])
        .map((row: any) => ({
          rating: Number(row.rating),
          created_at: String(row.created_at),
        }))
        .filter(
          (row) =>
            Number.isFinite(row.rating) &&
            row.rating >= 1 &&
            row.rating <= 5 &&
            !!row.created_at,
        );

      setRatingHistory(rows);
    } catch (error) {
      console.log("loadRatingHistory error", error);
      setRatingHistory([]);
    }
  }, []);

  const loadStatsFromOrders = useCallback(async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("status")
        .eq("driver_id", uid)
        .limit(2000);

      if (error) {
        console.log("loadStatsFromOrders error", error);
        setStatsDeliveries(0);
        setStatsAcceptanceRate(0);
        setStatsCancellationRate(0);
        return;
      }

      const statuses = (data ?? []).map((row: any) => String(row.status ?? "") as OrderStatus);
      const assigned = statuses.length;
      const delivered = statuses.filter((status) => status === "delivered").length;
      const canceled = statuses.filter((status) => status === "canceled").length;
      const acceptedApprox = Math.max(0, assigned - canceled);

      setStatsDeliveries(delivered);
      setStatsCancellationRate(assigned === 0 ? 0 : (canceled / assigned) * 100);
      setStatsAcceptanceRate(assigned === 0 ? 0 : (acceptedApprox / assigned) * 100);
    } catch (error) {
      console.log("loadStatsFromOrders error", error);
      setStatsDeliveries(0);
      setStatsAcceptanceRate(0);
      setStatsCancellationRate(0);
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        console.log("auth.getUser error", authErr);
      }

      const user = authData?.user;
      if (!user) {
        setProfile(null);
        setDriver(null);
        setDriverDocuments([]);
        setAuthFallbackName(t("driver.profile.authFallbackName", { defaultValue: "Chauffeur" }));
        setAvatarPath(null);
        setAvatarUrl(null);
        setAvatarBroken(false);
        setAvatarUpdatedAt(0);
        setStripeAccountId(null);
        setStripeOnboarded(false);
        setAvgRating(null);
        setRatingCount(0);
        setRatingHistory([]);
        setStatsDeliveries(0);
        setStatsAcceptanceRate(0);
        setStatsCancellationRate(0);
        return;
      }

      const uid = user.id;

      const fallback =
        (user.user_metadata as any)?.full_name ||
        (user.user_metadata as any)?.name ||
        user.email ||
        t("driver.profile.authFallbackName", { defaultValue: "Chauffeur" });
      setAuthFallbackName(String(fallback));

      const metaAvatarPath =
        ((user.user_metadata as any)?.avatar_path as string | undefined) ?? null;
      const metaUpdatedAt = Number((user.user_metadata as any)?.avatar_updated_at ?? 0) || 0;

      const { data: p, error: pErr } = await supabase
        .from("profiles")
        .select(
          "id, full_name, phone, role, avatar_url, emergency_phone, state, zip_code, personal_photo_url",
        )
        .eq("id", uid)
        .maybeSingle();

      if (pErr) {
        console.log("profiles error", pErr);
      }

      const profileRow = (p as ProfileRow | null) ?? {
        id: uid,
        full_name: null,
        phone: null,
        role: "livreur",
        avatar_url: null,
      };
      setProfile(profileRow);

      const dbAvatarPath =
        profileRow.avatar_url || profileRow.personal_photo_url || metaAvatarPath || null;

      setAvatarPath(dbAvatarPath);
      setAvatarUpdatedAt(metaUpdatedAt);
      await refreshAvatarUrl(dbAvatarPath);

      const { data: d, error: dErr } = await supabase
        .from("driver_profiles")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();

      if (dErr) {
        console.log("driver_profiles error", dErr);
      }

      if (!d) {
        const { data: created, error: cErr } = await supabase
          .from("driver_profiles")
          .upsert(
            {
              user_id: uid,
              transport_mode: "bike",
              vehicle_type: "bike",
              full_name: profileRow.full_name ?? null,
              phone: profileRow.phone ?? null,
              emergency_phone: profileRow.emergency_phone ?? null,
              state: profileRow.state ?? null,
              zip_code: profileRow.zip_code ?? null,
              documents_required: true,
              status: "pending",
            },
            { onConflict: "user_id" },
          )
          .select("*")
          .single();

        if (cErr) {
          console.log("upsert driver_profiles error", cErr);
          setDriver(null);
        } else {
          setDriver((created as DriverProfileRow) ?? null);
        }
      } else {
        setDriver((d as DriverProfileRow) ?? null);
      }

      await refreshStripeStatus(uid);
      await Promise.all([
        loadDocs(uid),
        loadRating(uid),
        loadRatingHistory(uid),
        loadStatsFromOrders(uid),
      ]);
    } finally {
      setLoading(false);
    }
  }, [
    loadDocs,
    loadRating,
    loadRatingHistory,
    loadStatsFromOrders,
    refreshAvatarUrl,
    refreshStripeStatus,
    t,
  ]);

  useFocusEffect(
    useCallback(() => {
      void loadAll();
    }, [loadAll]),
  );

  function openEdit() {
    const currentTransportMode =
      (driver?.transport_mode?.toLowerCase() as TransportMode | undefined) ?? "bike";

    setEditFullName(driver?.full_name ?? profile?.full_name ?? "");
    setEditPhone(driver?.phone ?? profile?.phone ?? "");
    setEditEmergencyPhone(driver?.emergency_phone ?? profile?.emergency_phone ?? "");
    setEditAddress(driver?.address ?? "");
    setEditCity(driver?.city ?? "");
    setEditState(driver?.state ?? profile?.state ?? "");
    setEditZipCode(driver?.zip_code ?? profile?.zip_code ?? "");
    setEditDateOfBirth(driver?.date_of_birth ?? "");
    setEditTransportMode(
      currentTransportMode === "bike" || currentTransportMode === "moto" || currentTransportMode === "car"
        ? currentTransportMode
        : "bike",
    );
    setEditVehicleBrand(currentTransportMode === "bike" ? "" : driver?.vehicle_brand ?? "");
    setEditVehicleModel(currentTransportMode === "bike" ? "" : driver?.vehicle_model ?? "");
    setEditVehicleYear(currentTransportMode === "bike" ? "" : driver?.vehicle_year ?? "");
    setEditVehicleColor(currentTransportMode === "bike" ? "" : driver?.vehicle_color ?? "");
    setEditPlateNumber(currentTransportMode === "bike" ? "" : driver?.plate_number ?? "");
    setEditLicenseNumber(currentTransportMode === "bike" ? "" : driver?.license_number ?? "");
    setEditLicenseExpiry(currentTransportMode === "bike" ? "" : driver?.license_expiry ?? "");
    setEditOpen(true);
  }

  async function saveEdit() {
    try {
      setSaving(true);

      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) {
        Alert.alert(
          t("client.auth.errorTitle", { defaultValue: "Erreur" }),
          t("driver.home.errors.mustBeLoggedIn", { defaultValue: "Tu dois être connecté." }),
        );
        return;
      }

      const safeYear =
        editVehicleYear === "" ? null : normalizeYearInput(String(editVehicleYear));

      if (safeYear === "") {
        Alert.alert(
          t("client.auth.errorTitle", { defaultValue: "Erreur" }),
          t("common.profile.invalidYear", { defaultValue: "Année de véhicule invalide." }),
        );
        return;
      }

      const requiresMotorDocs = editTransportMode === "car" || editTransportMode === "moto";

      const profilePayload = {
        id: uid,
        role: profile?.role ?? "livreur",
        full_name: trimOrNull(editFullName),
        phone: trimOrNull(editPhone),
        emergency_phone: trimOrNull(editEmergencyPhone),
        state: trimOrNull(editState),
        zip_code: trimOrNull(normalizeZip(editZipCode)),
      };

      const { error: pErr } = await supabase
        .from("profiles")
        .upsert(profilePayload, { onConflict: "id" });

      if (pErr) {
        console.log("profiles upsert error", pErr);
        Alert.alert(
          t("client.auth.errorTitle", { defaultValue: "Erreur" }),
          t("common.profile.saveProfilesFailed", {
            defaultValue: "Impossible de sauvegarder le compte (profiles).",
          }),
        );
        return;
      }

      const driverPayload: Partial<DriverProfileRow> = {
        full_name: trimOrNull(editFullName),
        phone: trimOrNull(editPhone),
        emergency_phone: trimOrNull(editEmergencyPhone),
        address: trimOrNull(editAddress),
        city: trimOrNull(editCity),
        state: trimOrNull(editState),
        zip_code: trimOrNull(normalizeZip(editZipCode)),
        date_of_birth: trimOrNull(editDateOfBirth),
        transport_mode: editTransportMode,
        vehicle_type: editTransportMode,
        vehicle_brand: requiresMotorDocs ? trimOrNull(editVehicleBrand) : null,
        vehicle_model: requiresMotorDocs ? trimOrNull(editVehicleModel) : null,
        vehicle_year: requiresMotorDocs ? (safeYear as number | null) : null,
        vehicle_color: requiresMotorDocs ? trimOrNull(editVehicleColor) : null,
        plate_number: requiresMotorDocs ? trimOrNull(editPlateNumber) : null,
        license_number: requiresMotorDocs ? trimOrNull(editLicenseNumber) : null,
        license_expiry: requiresMotorDocs ? trimOrNull(editLicenseExpiry) : null,
        documents_required: !isProfileComplete,
        updated_at: new Date().toISOString(),
      };

      const { error: dErr } = await supabase
        .from("driver_profiles")
        .update(driverPayload)
        .eq("user_id", uid);

      if (dErr) {
        console.log("driver_profiles update error", dErr);
        Alert.alert(
          t("client.auth.errorTitle", { defaultValue: "Erreur" }),
          t("common.profile.saveDriverProfilesFailed", {
            defaultValue: "Impossible de sauvegarder (driver_profiles).",
          }),
        );
        return;
      }

      setEditOpen(false);
      await loadAll();
      Alert.alert(
        t("common.ok", { defaultValue: "OK" }),
        t("common.profile.updated", { defaultValue: "Profil mis à jour ✅" }),
      );
    } finally {
      setSaving(false);
    }
  }

  async function pickFromCamera(): Promise<{ uri: string; mime: string; name: string } | null> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        t("common.permission.title", { defaultValue: "Permission" }),
        t("common.permission.camera", {
          defaultValue: "Autorise la caméra pour prendre une photo.",
        }),
      );
      return null;
    }

    const res = await ImagePicker.launchCameraAsync({
      quality: 0.85,
      allowsEditing: true,
    });

    if (res.canceled) return null;
    const asset = res.assets?.[0];
    if (!asset?.uri) return null;

    return { uri: asset.uri, mime: "image/jpeg", name: `camera_${Date.now()}.jpg` };
  }

  async function pickFromFiles(
    allowPdf = true,
  ): Promise<{ uri: string; mime: string; name: string } | null> {
    const res = await DocumentPicker.getDocumentAsync({
      type: allowPdf ? ["image/*", "application/pdf"] : ["image/*"],
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (res.canceled) return null;

    const file = res.assets?.[0];
    if (!file?.uri) return null;

    const lower = (file.name ?? "").toLowerCase();
    const mime =
      file.mimeType ||
      (lower.endsWith(".pdf")
        ? "application/pdf"
        : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
          ? "image/jpeg"
          : lower.endsWith(".png")
            ? "image/png"
            : "application/octet-stream");

    return { uri: file.uri, mime, name: file.name || `file_${Date.now()}` };
  }

  async function pickAvatarFromCamera(): Promise<{ uri: string; mime: string; name: string } | null> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        t("common.permission.title", { defaultValue: "Permission" }),
        t("common.permission.camera", {
          defaultValue: "Autorise la caméra pour prendre une photo.",
        }),
      );
      return null;
    }

    const res = await ImagePicker.launchCameraAsync({
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (res.canceled) return null;
    const asset = res.assets?.[0];
    if (!asset?.uri) return null;

    return { uri: asset.uri, mime: "image/jpeg", name: `avatar_camera_${Date.now()}.jpg` };
  }

  async function pickAvatarFromFiles(): Promise<{ uri: string; mime: string; name: string } | null> {
    return pickFromFiles(false);
  }

  function avatarStoragePath(uid: string) {
    return `drivers/${uid}/avatar.jpg`;
  }

  function buildDriverDocPath(uid: string, docType: DriverDocumentType, name: string, mime: string) {
    const ext = inferExt(name, mime);
    return `drivers/${uid}/${docType}_${Date.now()}.${ext}`;
  }

  async function uploadAvatar(source: "camera" | "files") {
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        console.log("uploadAvatar auth error", authErr);
      }

      const uid = authData?.user?.id;
      if (!uid) {
        Alert.alert(
          t("driver.security.sessionTitle", { defaultValue: "Session expirée" }),
          t("driver.security.sessionBody", { defaultValue: "Reconnecte-toi pour continuer." }),
        );
        return;
      }

      setSaving(true);

      const picked =
        source === "camera" ? await pickAvatarFromCamera() : await pickAvatarFromFiles();
      if (!picked) return;

      const storagePath = avatarStoragePath(uid);
      const base64 = await FileSystem.readAsStringAsync(picked.uri, {
        encoding: "base64" as any,
      });
      const bytes = decode(base64);

      const { error: upErr } = await supabase.storage.from(AVATARS_BUCKET).upload(storagePath, bytes, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "3600",
      });

      if (upErr) {
        Alert.alert(
          t("client.auth.errorTitle", { defaultValue: "Erreur" }),
          t("common.profile.avatarUploadFailed", {
            defaultValue: "Upload avatar impossible. Vérifie Storage policies (avatars).",
          }),
        );
        return;
      }

      const updatedAt = Date.now();

      await supabase.from("profiles").update({ avatar_url: storagePath }).eq("id", uid);
      await supabase.auth.updateUser({
        data: { avatar_path: storagePath, avatar_updated_at: updatedAt },
      });

      setAvatarPath(storagePath);
      setAvatarUpdatedAt(updatedAt);
      setAvatarBroken(false);
      await refreshAvatarUrl(storagePath);

      const { data: driverRow } = await supabase
  .from("driver_profiles")
  .select("id")
  .eq("user_id", uid)
  .single();

const driverId = driverRow?.id ?? uid;

const { error: docErr } = await supabase.from("driver_documents").upsert(
        {
          user_id: uid,
          driver_id: driverId,
          doc_type: "profile_photo",
          file_path: storagePath,
          status: "pending",
          reviewed_at: null,
          reviewed_by: null,
          review_notes: null,
        },
        { onConflict: "user_id,doc_type" },
      );

      if (docErr) {
        console.log("profile_photo upsert error", docErr);
      }

      await loadAll();

      Alert.alert(
        `${t("common.ok", { defaultValue: "OK" })} ✅`,
        t("common.profile.avatarUpdated", { defaultValue: "Photo de profil mise à jour." }),
      );
    } catch (error: any) {
      console.log("uploadAvatar catch", error);
      Alert.alert(
        t("client.auth.errorTitle", { defaultValue: "Erreur" }),
        error?.message ??
          t("common.profile.avatarUnknownError", {
            defaultValue: "Upload avatar: erreur inconnue.",
          }),
      );
    } finally {
      setSaving(false);
    }
  }

  function openAvatarMenu() {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t("common.profile.avatarTitle", { defaultValue: "Photo de profil" }),
          options: [
            t("shared.common.cancel", { defaultValue: "Annuler" }),
            t("driver.auth.actions.camera", { defaultValue: "Caméra" }),
            t("driver.auth.actions.files", { defaultValue: "Fichiers" }),
          ],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) void uploadAvatar("camera");
          if (idx === 2) void uploadAvatar("files");
        },
      );
      return;
    }

    Alert.alert(
      t("common.profile.avatarTitle", { defaultValue: "Photo de profil" }),
      t("driver.profile.chooseOption", { defaultValue: "Choisis une option :" }),
      [
        { text: t("shared.common.cancel", { defaultValue: "Annuler" }), style: "cancel" },
        {
          text: t("driver.auth.actions.camera", { defaultValue: "Caméra" }),
          onPress: () => void uploadAvatar("camera"),
        },
        {
          text: t("driver.auth.actions.files", { defaultValue: "Fichiers" }),
          onPress: () => void uploadAvatar("files"),
        },
      ],
    );
  }

  async function uploadDriverDocument(
    docType: DriverDocumentType,
    source: "camera" | "files",
  ) {
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        console.log("uploadDoc auth error", authErr);
      }

      const uid = authData?.user?.id;
      if (!uid) {
        Alert.alert(
          t("driver.security.sessionTitle", { defaultValue: "Session expirée" }),
          t("driver.security.sessionBody", { defaultValue: "Reconnecte-toi pour continuer." }),
        );
        return;
      }

      if (
        isBike &&
        (docType === "license_front" ||
          docType === "license_back" ||
          docType === "insurance" ||
          docType === "registration")
      ) {
        Alert.alert(
          t("driver.auth.transport.bike", { defaultValue: "Vélo" }),
          t("common.profile.bikeNoDocs", {
            defaultValue: "En mode vélo, aucun document véhicule n’est requis ✅",
          }),
        );
        return;
      }

      setSaving(true);

      const picked =
        source === "camera" ? await pickFromCamera() : await pickFromFiles(true);
      if (!picked) return;

      const filePath = buildDriverDocPath(uid, docType, picked.name, picked.mime);

      const base64 = await FileSystem.readAsStringAsync(picked.uri, {
        encoding: "base64" as any,
      });
      const bytes = decode(base64);

      const { error: upErr } = await supabase.storage.from(DRIVER_DOCS_BUCKET).upload(filePath, bytes, {
        contentType: picked.mime,
        upsert: true,
        cacheControl: "3600",
      });

      if (upErr) {
        Alert.alert(
          t("client.auth.errorTitle", { defaultValue: "Erreur" }),
          t("common.profile.docUploadFailed", {
            defaultValue: "Upload impossible. Vérifie Storage policies (driver-docs).",
          }),
        );
        return;
      }

      const extra: Partial<DriverDocumentRow> = {};

      if (docType === "license_front" || docType === "license_back") {
        extra.state = trimOrNull(driver?.state ?? null ? String(driver?.state) : "") ?? null;
        extra.doc_number = trimOrNull(driver?.license_number ?? "");
        extra.expires_at = trimOrNull(driver?.license_expiry ?? "");
        extra.country = "US";
      }

      const { data: driverRow } = await supabase
  .from("driver_profiles")
  .select("id")
  .eq("user_id", uid)
  .single();

const driverId = driverRow?.id ?? uid;

const { error: insErr } = await supabase.from("driver_documents").upsert(
        {
          user_id: uid,
          driver_id: driverId,
          doc_type: docType,
          file_path: filePath,
          country: extra.country ?? null,
          state: extra.state ?? null,
          doc_number: extra.doc_number ?? null,
          expires_at: extra.expires_at ?? null,
          status: "pending",
          reviewed_at: null,
          reviewed_by: null,
          review_notes: null,
        },
        { onConflict: "user_id,doc_type" },
      );

      if (insErr) {
        Alert.alert(
          t("client.auth.errorTitle", { defaultValue: "Erreur" }),
          t("common.profile.docDbFailed", {
            defaultValue: "Fichier uploadé mais DB non mise à jour (driver_documents).",
          }),
        );
        return;
      }

      await loadAll();

      Alert.alert(
        `${t("common.ok", { defaultValue: "OK" })} ✅`,
        t("common.profile.docSent", {
          doc: driverDocumentLabel(docType),
          defaultValue: "{{doc}} envoyé.",
        }),
      );
    } catch (error: any) {
      console.log("uploadDriverDocument catch", error);
      Alert.alert(
        t("client.auth.errorTitle", { defaultValue: "Erreur" }),
        error?.message ??
          t("common.profile.docUnknownError", {
            defaultValue: "Upload doc: erreur inconnue.",
          }),
      );
    } finally {
      setSaving(false);
    }
  }

  function openDocMenu(docType: DriverDocumentType) {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t("common.profile.uploadDocTitle", {
            doc: driverDocumentLabel(docType),
            defaultValue: "Uploader {{doc}}",
          }),
          options: [
            t("shared.common.cancel", { defaultValue: "Annuler" }),
            t("driver.auth.actions.camera", { defaultValue: "Caméra" }),
            t("driver.auth.actions.files", { defaultValue: "Fichiers" }),
          ],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) void uploadDriverDocument(docType, "camera");
          if (idx === 2) void uploadDriverDocument(docType, "files");
        },
      );
      return;
    }

    Alert.alert(
      t("common.profile.uploadDocTitle", {
        doc: driverDocumentLabel(docType),
        defaultValue: "Uploader {{doc}}",
      }),
      t("driver.profile.chooseOption", { defaultValue: "Choisis une option :" }),
      [
        { text: t("shared.common.cancel", { defaultValue: "Annuler" }), style: "cancel" },
        {
          text: t("driver.auth.actions.camera", { defaultValue: "Caméra" }),
          onPress: () => void uploadDriverDocument(docType, "camera"),
        },
        {
          text: t("driver.auth.actions.files", { defaultValue: "Fichiers" }),
          onPress: () => void uploadDriverDocument(docType, "files"),
        },
      ],
    );
  }

  const onPressStripe = useCallback(async () => {
    try {
      await startStripeOnboarding("driver");
    } catch (error: any) {
      Alert.alert(
        "Stripe",
        error?.message ??
          t("driver.payments.unavailable", {
            defaultValue: "Impossible d’ouvrir Stripe pour le moment.",
          }),
      );
    }
  }, [t]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
            {t("common.back", { defaultValue: "← Retour" })}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>
          {t("common.profile.title", { defaultValue: "Profil" })}
        </Text>

        <TouchableOpacity onPress={openEdit}>
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
            {t("driver.profile.editShort", { defaultValue: "Modifier" })}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
          <Text style={{ color: "#9CA3AF", marginTop: 10 }}>
            {t("shared.common.loading", { defaultValue: "Chargement…" })}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
        >
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <TouchableOpacity
                onPress={openAvatarMenu}
                activeOpacity={0.85}
                style={{ marginRight: 14 }}
              >
                <View style={{ width: 64, height: 64 }}>
                  <Image
                    key={avatarUri}
                    source={{ uri: avatarUri }}
                    style={{ width: 64, height: 64, borderRadius: 32 }}
                    onError={() => {
                      setAvatarBroken(true);
                    }}
                  />
                  {saving ? (
                    <View
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "rgba(0,0,0,0.25)",
                        borderRadius: 32,
                      }}
                    >
                      <ActivityIndicator />
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>

              <View style={{ flex: 1 }}>
                <Text style={{ color: "white", fontSize: 20, fontWeight: "900" }}>
                  {headerName}
                </Text>

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginTop: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <StarsRow rating={avgRating} count={ratingCount} size={15} />
                  <Text
                    style={{
                      color: "#9CA3AF",
                      fontWeight: "800",
                      marginLeft: 8,
                    }}
                  >
                    {ratingCount === 0
                      ? t("driver.profile.newDriver", { defaultValue: "Nouveau" })
                      : avgRating?.toFixed(2)}
                    {ratingCount > 0 ? ` (${ratingCount})` : ""}
                  </Text>

                  <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>{"  "}•{"  "}</Text>
                  <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>{verifiedLabel}</Text>

                  <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>{"  "}•{"  "}</Text>
                  <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                    {transportLabelI18n(transportMode)}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", marginTop: 8, flexWrap: "wrap" }}>
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: isTopDriver ? "#064E3B" : "#0A1730",
                      borderWidth: 1,
                      borderColor: isTopDriver ? "#10B981" : "#1F2937",
                      marginRight: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>
                      {isTopDriver
                        ? t("common.profile.topDriver", { defaultValue: "🏆 Top Driver" })
                        : t("common.profile.inProgress", { defaultValue: "ℹ️ En progression" })}
                    </Text>
                  </View>

                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: "#0A1730",
                      borderWidth: 1,
                      borderColor: "#1F2937",
                      marginRight: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>
                      {t("common.profile.driverScore", { defaultValue: "Driver Score" })}:{" "}
                      {driverScore}/100
                    </Text>
                  </View>

                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: "#0A1730",
                      borderWidth: 1,
                      borderColor: "#1F2937",
                      marginRight: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>
                      {tierLabelI18n(driverTier)}
                    </Text>
                  </View>
                </View>

                <Text style={{ color: "#CBD5E1", marginTop: 6, fontWeight: "700" }}>
                  {isBike
                    ? t("common.profile.bikeNoVehicleLine", {
                        defaultValue:
                          "Vélo : pas de permis / plaque / assurance / registration",
                      })
                    : vehicleLine}
                </Text>
              </View>
            </View>

            <View style={{ height: 12 }} />

            <View style={{ flexDirection: "row" }}>
              <View
                style={{
                  flex: 1,
                  backgroundColor: "#0A1730",
                  borderRadius: 14,
                  padding: 12,
                  marginRight: 10,
                }}
              >
                <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                  {t("common.profile.deliveries", { defaultValue: "Livraisons" })}
                </Text>
                <Text style={{ color: "white", fontSize: 18, fontWeight: "900", marginTop: 6 }}>
                  {statsDeliveries}
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  backgroundColor: "#0A1730",
                  borderRadius: 14,
                  padding: 12,
                  marginRight: 10,
                }}
              >
                <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                  {t("common.profile.acceptance", { defaultValue: "Acceptation" })}
                </Text>
                <Text style={{ color: "white", fontSize: 18, fontWeight: "900", marginTop: 6 }}>
                  {pct(statsAcceptanceRate)}
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  backgroundColor: "#0A1730",
                  borderRadius: 14,
                  padding: 12,
                }}
              >
                <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                  {t("common.profile.cancellation", { defaultValue: "Annulation" })}
                </Text>
                <Text style={{ color: "white", fontSize: 18, fontWeight: "900", marginTop: 6 }}>
                  {pct(statsCancellationRate)}
                </Text>
              </View>
            </View>

            <Text style={{ color: "#64748B", marginTop: 10, fontWeight: "700" }}>
              {t("common.profile.tipChangePhoto", {
                defaultValue: "Astuce : touche la photo pour la changer (caméra / fichiers).",
              })}
            </Text>
          </Card>

          <SectionTitle>
            {t("common.profile.accountSection", { defaultValue: "Compte" })}
          </SectionTitle>
          <Card>
            <Row label={t("common.profile.name", { defaultValue: "Nom" })} value={headerName} />
            <Divider />
            <Row label={t("common.profile.phone", { defaultValue: "Téléphone" })} value={phoneToShow} />
            <Divider />
            <Row
              label={t("common.profile.emergencyPhone", { defaultValue: "Téléphone d’urgence" })}
              value={driver?.emergency_phone ?? "—"}
            />
            <Divider />
            <Row
              label={t("common.profile.address", { defaultValue: "Adresse" })}
              value={driver?.address ?? "—"}
            />
            <Divider />
            <Row label={t("common.profile.city", { defaultValue: "Ville" })} value={driver?.city ?? "—"} />
            <Divider />
            <Row label={t("common.profile.state", { defaultValue: "État" })} value={driver?.state ?? "—"} />
            <Divider />
            <Row
              label={t("common.profile.zip", { defaultValue: "ZIP code" })}
              value={driver?.zip_code ?? "—"}
            />
            <Divider />
            <Row
              label={t("common.profile.dateOfBirth", { defaultValue: "Date de naissance" })}
              value={formatDateLabel(driver?.date_of_birth)}
            />
            <Divider />
            <Row
              label={t("common.profile.transport", { defaultValue: "Transport" })}
              value={transportLabelI18n(transportMode)}
            />
            <Divider />
            <Row
              label={t("common.profile.payment", { defaultValue: "Paiement" })}
              value={paymentLabel}
              onPress={!stripeOnboarded ? onPressStripe : undefined}
            />
            {!stripeOnboarded ? (
              <Text style={{ color: "#94A3B8", marginTop: 8, fontWeight: "700" }}>
                {t("common.profile.configureStripeHint", {
                  defaultValue: "Configure Stripe pour activer les gains. (touche “Paiement”)",
                })}
              </Text>
            ) : null}
            <Divider />
            <Row
              label={t("common.profile.status", { defaultValue: "Statut" })}
              value={verifiedLabel}
            />
          </Card>

          {!isBike ? (
            <>
              <SectionTitle>
                {t("common.profile.vehicleSection", { defaultValue: "Véhicule" })}
              </SectionTitle>
              <Card>
                <Row
                  label={t("common.profile.brand", { defaultValue: "Marque" })}
                  value={driver?.vehicle_brand ?? "—"}
                />
                <Divider />
                <Row
                  label={t("common.profile.model", { defaultValue: "Modèle" })}
                  value={driver?.vehicle_model ?? "—"}
                />
                <Divider />
                <Row
                  label={t("common.profile.year", { defaultValue: "Année" })}
                  value={driver?.vehicle_year ? String(driver.vehicle_year) : "—"}
                />
                <Divider />
                <Row
                  label={t("common.profile.color", { defaultValue: "Couleur" })}
                  value={driver?.vehicle_color ?? "—"}
                />
                <Divider />
                <Row
                  label={t("common.profile.plate", { defaultValue: "Plaque" })}
                  value={driver?.plate_number ?? "—"}
                />
                <Divider />
                <Row
                  label={t("driver.profile.licenseNumber", { defaultValue: "Numéro du permis" })}
                  value={driver?.license_number ?? "—"}
                />
                <Divider />
                <Row
                  label={t("driver.profile.licenseExpiry", {
                    defaultValue: "Expiration du permis",
                  })}
                  value={formatDateLabel(driver?.license_expiry)}
                />
              </Card>
            </>
          ) : null}

          <SectionTitle>
            {t("common.profile.documentsSection", { defaultValue: "Documents" })}
          </SectionTitle>
          <Card>
            <Row
              label={driverDocumentLabel("profile_photo")}
              value={hasProfilePhoto ? "OK ✅" : "Manquant"}
              onPress={openAvatarMenu}
            />
            <Divider />
            <Row
              label={driverDocumentLabel("id_card_front")}
              value={hasIdFront ? "OK ✅" : "Manquant"}
              onPress={() => openDocMenu("id_card_front")}
            />
            <Divider />
            <Row
              label={driverDocumentLabel("id_card_back")}
              value={hasIdBack ? "OK ✅" : "Manquant"}
              onPress={() => openDocMenu("id_card_back")}
            />
            {!isBike ? (
              <>
                <Divider />
                <Row
                  label={driverDocumentLabel("license_front")}
                  value={hasLicenseFront ? "OK ✅" : "Manquant"}
                  onPress={() => openDocMenu("license_front")}
                />
                <Divider />
                <Row
                  label={driverDocumentLabel("license_back")}
                  value={hasLicenseBack ? "OK ✅" : "Manquant"}
                  onPress={() => openDocMenu("license_back")}
                />
                <Divider />
                <Row
                  label={driverDocumentLabel("insurance")}
                  value={hasInsurance ? "OK ✅" : "Manquant"}
                  onPress={() => openDocMenu("insurance")}
                />
                <Divider />
                <Row
                  label={driverDocumentLabel("registration")}
                  value={hasRegistration ? "OK ✅" : "Manquant"}
                  onPress={() => openDocMenu("registration")}
                />
              </>
            ) : null}
          </Card>

          <SectionTitle>
            {t("driver.profile.missingRequirements", { defaultValue: "Éléments manquants" })}
          </SectionTitle>
          <Card>
            {missingRequirements.length === 0 ? (
              <Text style={{ color: "#10B981", fontWeight: "800" }}>
                {t("driver.profile.verified.full", { defaultValue: "Dossier complet ✅" })}
              </Text>
            ) : (
              missingRequirements.map((item, index) => (
                <Text
                  key={`${item}-${index}`}
                  style={{ color: "#FCA5A5", fontWeight: "700", marginBottom: 6 }}
                >
                  • {item}
                </Text>
              ))
            )}
          </Card>

          <SectionTitle>
            {t("common.profile.ratingHistorySection", {
              defaultValue: "Historique des notes",
            })}
          </SectionTitle>
          <Card>
            {ratingHistory.length === 0 ? (
              <Text style={{ color: "#94A3B8", fontWeight: "700" }}>
                {t("common.profile.noReviewsYet", {
                  defaultValue: "Aucun avis pour l’instant.",
                })}
              </Text>
            ) : (
              <View>
                {ratingHistory
                  .slice()
                  .reverse()
                  .map((row, idx) => (
                    <View
                      key={`${row.created_at}-${idx}`}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        paddingVertical: 10,
                      }}
                    >
                      <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                        {fmtShortDate(row.created_at)}
                      </Text>
                      <Text style={{ color: "#FBBF24", fontWeight: "900" }}>
                        {Number.isFinite(row.rating) ? `${row.rating.toFixed(1)} ★` : "—"}
                      </Text>
                    </View>
                  ))}
              </View>
            )}
          </Card>

          <Text style={{ color: "#6B7280", marginTop: 16, fontWeight: "700" }}>
            {Platform.OS === "ios" ? "iOS" : "Android"} • DriverProfileScreen
          </Text>
        </ScrollView>
      )}

      <Modal
        visible={editOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setEditOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.65)",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <ScrollView
            style={{ maxHeight: "92%" }}
            contentContainerStyle={{ justifyContent: "center", flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            <View
              style={{
                backgroundColor: "#0B1220",
                borderRadius: 18,
                borderWidth: 1,
                borderColor: "#111827",
                padding: 14,
              }}
            >
              <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
                {t("common.profile.editProfileTitle", { defaultValue: "Modifier le profil" })}
              </Text>

              <View style={{ height: 12 }} />

              <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                {t("common.profile.name", { defaultValue: "Nom" })}
              </Text>
              <TextInput
                value={editFullName}
                onChangeText={setEditFullName}
                placeholder={t("common.profile.placeholderName", {
                  defaultValue: "Ex: Mamadou",
                })}
                placeholderTextColor="#64748B"
                style={{
                  color: "white",
                  backgroundColor: "#071022",
                  borderColor: "#111827",
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginTop: 6,
                }}
              />

              <View style={{ height: 10 }} />

              <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                {t("common.profile.phone", { defaultValue: "Téléphone" })}
              </Text>
              <TextInput
                value={editPhone}
                onChangeText={setEditPhone}
                placeholder={t("common.profile.placeholderPhone", {
                  defaultValue: "Ex: 9297408722",
                })}
                placeholderTextColor="#64748B"
                keyboardType="phone-pad"
                style={{
                  color: "white",
                  backgroundColor: "#071022",
                  borderColor: "#111827",
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginTop: 6,
                }}
              />

              <View style={{ height: 10 }} />

              <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                {t("common.profile.emergencyPhone", {
                  defaultValue: "Téléphone d’urgence",
                })}
              </Text>
              <TextInput
                value={editEmergencyPhone}
                onChangeText={setEditEmergencyPhone}
                placeholder={t("common.profile.placeholderEmergencyPhone", {
                  defaultValue: "Ex: 9170000000",
                })}
                placeholderTextColor="#64748B"
                keyboardType="phone-pad"
                style={{
                  color: "white",
                  backgroundColor: "#071022",
                  borderColor: "#111827",
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginTop: 6,
                }}
              />

              <View style={{ height: 10 }} />

              <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                {t("common.profile.address", { defaultValue: "Adresse" })}
              </Text>
              <TextInput
                value={editAddress}
                onChangeText={setEditAddress}
                placeholder={t("common.profile.placeholderAddress", {
                  defaultValue: "Adresse",
                })}
                placeholderTextColor="#64748B"
                style={{
                  color: "white",
                  backgroundColor: "#071022",
                  borderColor: "#111827",
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginTop: 6,
                }}
              />

              <View style={{ height: 10 }} />

              <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                {t("common.profile.city", { defaultValue: "Ville" })}
              </Text>
              <TextInput
                value={editCity}
                onChangeText={setEditCity}
                placeholder={t("common.profile.placeholderCity", {
                  defaultValue: "Ville",
                })}
                placeholderTextColor="#64748B"
                style={{
                  color: "white",
                  backgroundColor: "#071022",
                  borderColor: "#111827",
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginTop: 6,
                }}
              />

              <View style={{ height: 10 }} />

              <View style={{ flexDirection: "row" }}>
                <View style={{ flex: 1, marginRight: 10 }}>
                  <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                    {t("common.profile.state", { defaultValue: "État" })}
                  </Text>
                  <TextInput
                    value={editState}
                    onChangeText={setEditState}
                    placeholder={t("common.profile.placeholderState", {
                      defaultValue: "NJ",
                    })}
                    placeholderTextColor="#64748B"
                    style={{
                      color: "white",
                      backgroundColor: "#071022",
                      borderColor: "#111827",
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      marginTop: 6,
                    }}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                    {t("common.profile.zip", { defaultValue: "ZIP code" })}
                  </Text>
                  <TextInput
                    value={editZipCode}
                    onChangeText={setEditZipCode}
                    placeholder={t("common.profile.placeholderZip", {
                      defaultValue: "07030",
                    })}
                    placeholderTextColor="#64748B"
                    keyboardType="number-pad"
                    style={{
                      color: "white",
                      backgroundColor: "#071022",
                      borderColor: "#111827",
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      marginTop: 6,
                    }}
                  />
                </View>
              </View>

              <View style={{ height: 10 }} />

              <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                {t("common.profile.dateOfBirth", {
                  defaultValue: "Date de naissance (YYYY-MM-DD)",
                })}
              </Text>
              <TextInput
                value={editDateOfBirth}
                onChangeText={setEditDateOfBirth}
                placeholder="1990-01-31"
                placeholderTextColor="#64748B"
                style={{
                  color: "white",
                  backgroundColor: "#071022",
                  borderColor: "#111827",
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginTop: 6,
                }}
              />

              <View style={{ height: 12 }} />

              <Text style={{ color: "#CBD5E1", fontWeight: "900" }}>
                {t("common.profile.transport", { defaultValue: "Transport" })}
              </Text>

              <View style={{ flexDirection: "row", marginTop: 8, flexWrap: "wrap" }}>
                {(["bike", "moto", "car"] as TransportMode[]).map((mode) => {
                  const selected = editTransportMode === mode;
                  return (
                    <TouchableOpacity
                      key={mode}
                      onPress={() => setEditTransportMode(mode)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: selected ? "#2563EB" : "#1F2937",
                        backgroundColor: selected ? "#1D4ED8" : "#071022",
                        marginRight: 8,
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: "white", fontWeight: "900" }}>
                        {transportLabelI18n(mode)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {editTransportMode !== "bike" ? (
                <>
                  <View style={{ height: 12 }} />
                  <Text style={{ color: "#CBD5E1", fontWeight: "900" }}>
                    {t("common.profile.vehicleSection", { defaultValue: "Véhicule" })}
                  </Text>

                  <View style={{ height: 8 }} />

                  <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                    {t("common.profile.brand", { defaultValue: "Marque" })}
                  </Text>
                  <TextInput
                    value={editVehicleBrand}
                    onChangeText={setEditVehicleBrand}
                    placeholder={t("common.profile.placeholderBrand", {
                      defaultValue: "Ex: Honda",
                    })}
                    placeholderTextColor="#64748B"
                    style={{
                      color: "white",
                      backgroundColor: "#071022",
                      borderColor: "#111827",
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      marginTop: 6,
                    }}
                  />

                  <View style={{ height: 10 }} />

                  <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                    {t("common.profile.model", { defaultValue: "Modèle" })}
                  </Text>
                  <TextInput
                    value={editVehicleModel}
                    onChangeText={setEditVehicleModel}
                    placeholder={t("common.profile.placeholderModel", {
                      defaultValue: "Ex: Accord",
                    })}
                    placeholderTextColor="#64748B"
                    style={{
                      color: "white",
                      backgroundColor: "#071022",
                      borderColor: "#111827",
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      marginTop: 6,
                    }}
                  />

                  <View style={{ height: 10 }} />

                  <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                    {t("common.profile.color", { defaultValue: "Couleur" })}
                  </Text>
                  <TextInput
                    value={editVehicleColor}
                    onChangeText={setEditVehicleColor}
                    placeholder={t("common.profile.placeholderColor", {
                      defaultValue: "Ex: Noir",
                    })}
                    placeholderTextColor="#64748B"
                    style={{
                      color: "white",
                      backgroundColor: "#071022",
                      borderColor: "#111827",
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      marginTop: 6,
                    }}
                  />

                  <View style={{ height: 10 }} />

                  <View style={{ flexDirection: "row" }}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                        {t("common.profile.year", { defaultValue: "Année" })}
                      </Text>
                      <TextInput
                        value={editVehicleYear === "" ? "" : String(editVehicleYear)}
                        onChangeText={(value) => setEditVehicleYear(normalizeYearInput(value))}
                        placeholder={t("common.profile.placeholderYear", {
                          defaultValue: "2020",
                        })}
                        placeholderTextColor="#64748B"
                        keyboardType="number-pad"
                        style={{
                          color: "white",
                          backgroundColor: "#071022",
                          borderColor: "#111827",
                          borderWidth: 1,
                          borderRadius: 12,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          marginTop: 6,
                        }}
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                        {t("common.profile.plate", { defaultValue: "Plaque" })}
                      </Text>
                      <TextInput
                        value={editPlateNumber}
                        onChangeText={setEditPlateNumber}
                        placeholder={t("common.profile.placeholderPlate", {
                          defaultValue: "ABC-1234",
                        })}
                        placeholderTextColor="#64748B"
                        style={{
                          color: "white",
                          backgroundColor: "#071022",
                          borderColor: "#111827",
                          borderWidth: 1,
                          borderRadius: 12,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          marginTop: 6,
                        }}
                      />
                    </View>
                  </View>

                  <View style={{ height: 10 }} />

                  <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                    {t("driver.profile.licenseNumber", { defaultValue: "Numéro du permis" })}
                  </Text>
                  <TextInput
                    value={editLicenseNumber}
                    onChangeText={setEditLicenseNumber}
                    placeholder={t("driver.profile.placeholderLicenseNumber", {
                      defaultValue: "Numéro du permis",
                    })}
                    placeholderTextColor="#64748B"
                    style={{
                      color: "white",
                      backgroundColor: "#071022",
                      borderColor: "#111827",
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      marginTop: 6,
                    }}
                  />

                  <View style={{ height: 10 }} />

                  <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                    {t("driver.profile.licenseExpiry", {
                      defaultValue: "Expiration du permis (YYYY-MM-DD)",
                    })}
                  </Text>
                  <TextInput
                    value={editLicenseExpiry}
                    onChangeText={setEditLicenseExpiry}
                    placeholder="2030-12-31"
                    placeholderTextColor="#64748B"
                    style={{
                      color: "white",
                      backgroundColor: "#071022",
                      borderColor: "#111827",
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      marginTop: 6,
                    }}
                  />
                </>
              ) : (
                <>
                  <View style={{ height: 12 }} />
                  <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                    {t("common.profile.bikeNoVehicleHint", {
                      defaultValue:
                        "Vélo : pas besoin de permis / plaque / assurance / registration ✅",
                    })}
                  </Text>
                </>
              )}

              <View style={{ height: 14 }} />

              <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
                <TouchableOpacity
                  onPress={() => setEditOpen(false)}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "#1F2937",
                    marginRight: 10,
                  }}
                  disabled={saving}
                >
                  <Text style={{ color: "#CBD5E1", fontWeight: "900" }}>
                    {t("shared.common.cancel", { defaultValue: "Annuler" })}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => void saveEdit()}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    borderRadius: 12,
                    backgroundColor: "#2563EB",
                    opacity: saving ? 0.7 : 1,
                  }}
                  disabled={saving}
                >
                  <Text style={{ color: "white", fontWeight: "900" }}>
                    {saving
                      ? t("driver.profile.saving", { defaultValue: "Sauvegarde…" })
                      : t("shared.common.save", { defaultValue: "Enregistrer" })}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}