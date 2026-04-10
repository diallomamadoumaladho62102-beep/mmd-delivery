// ======================= PARTIE 1/5 =======================
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
import * as FileSystem from "expo-file-system/legacy"; // ✅ FIX SDK54: legacy API (readAsStringAsync)
import { supabase } from "../lib/supabase";
import { startStripeOnboarding } from "../utils/stripe";
import { useTranslation } from "react-i18next"; // ✅ i18n

/* ======================= TYPES ======================= */
type TransportMode = "bike" | "moto" | "car";
type DocType = "license" | "insurance" | "registration";

type ProfileRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: string | null;
};

type DriverProfileRow = {
  user_id: string;
  full_name: string | null;
  phone: string | null;

  transport_mode: string | null;

  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  plate_number: string | null;

  total_deliveries: number | null;
  acceptance_rate: number | null;
  cancellation_rate: number | null;

  stripe_account_id?: string | null;
  stripe_onboarded?: boolean | null;
};

type DriverDocRow = {
  id?: string;
  user_id: string;
  doc_type: string;
  file_path: string;
  created_at?: string;
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

type DriverRatingRpc = {
  avg_rating: number | null;
  rating_count: number | null;
};

/* ======================= HELPERS ======================= */
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function fmtShortDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
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

/* ======================= UI ATOMS ======================= */
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
      <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>{label}</Text>
      <Text style={{ color: "white", fontWeight: "800" }}>{value ?? "—"}</Text>
    </Wrapper>
  );
}

/* ======================= STARS ======================= */
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
        <Text style={{ color: "#FBBF24", fontSize: size, fontWeight: "900" }}>
          ½
        </Text>
      ) : null}
      <Text style={{ color: "#374151", fontSize: size, fontWeight: "900" }}>
        {"☆".repeat(empty)}
      </Text>
    </View>
  );
}

// ======================= PARTIE 2/5 =======================
/* ======================= SCREEN ======================= */
export function DriverProfileScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  // ✅ BUCKETS (PRO)
  const AVATARS_BUCKET = "avatars"; // public
  const DRIVER_DOCS_BUCKET = "driver-docs"; // private

  /* ======================= STATES ======================= */
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [driver, setDriver] = useState<DriverProfileRow | null>(null);

  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [stripeOnboarded, setStripeOnboarded] = useState(false);

  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);

  // ✅ PRO: utilise metadata avatar_updated_at pour casser cache iOS
  const [avatarUpdatedAt, setAvatarUpdatedAt] = useState<number>(0);

  const [hasLicense, setHasLicense] = useState(false);
  const [hasInsurance, setHasInsurance] = useState(false);
  const [hasRegistration, setHasRegistration] = useState(false);

  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [ratingHistory, setRatingHistory] = useState<DriverRatingRow[]>([]);

  const [statsDeliveries, setStatsDeliveries] = useState(0);
  const [statsAcceptanceRate, setStatsAcceptanceRate] = useState(0);
  const [statsCancellationRate, setStatsCancellationRate] = useState(0);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editPlate, setEditPlate] = useState("");
  const [editBrand, setEditBrand] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editYear, setEditYear] = useState("");
  const [editColor, setEditColor] = useState("");

  const [authFallbackName, setAuthFallbackName] = useState(t("driver.profile.authFallbackName", { defaultValue: "Chauffeur" }));

  /* ======================= i18n helpers ======================= */
  const tierLabelI18n = useCallback(
    (tier: number | null | undefined) => {
      if (tier === 1) return t("common.driverTier.elite", { defaultValue: "🏆 Elite" });
      if (tier === 2) return t("common.driverTier.confirmed", { defaultValue: "⭐ Confirmé" });
      if (tier === 3) return t("common.driverTier.standard", { defaultValue: "🔄 Standard" });
      return t("common.driverTier.needsImprovement", { defaultValue: "⚠️ À améliorer" });
    },
    [t]
  );

  const transportLabelI18n = useCallback(
    (m: TransportMode) => {
      if (m === "bike") return t("driver.auth.transport.bike", { defaultValue: "🚲 Vélo" });
      if (m === "moto") return t("driver.auth.transport.moto", { defaultValue: "🛵 Moto" });
      return t("driver.auth.transport.car", { defaultValue: "🚗 Voiture" });
    },
    [t]
  );

  const docLabelI18n = useCallback(
    (dt: DocType) => {
      if (dt === "license") return t("driver.profile.docs.license", { defaultValue: "Permis" });
      if (dt === "insurance") return t("driver.profile.docs.insurance", { defaultValue: "Assurance" });
      return t("driver.profile.docs.registration", { defaultValue: "Registration" });
    },
    [t]
  );

  /* ======================= MEMOS ======================= */
  const transportMode: TransportMode = useMemo(() => {
    const m = (driver?.transport_mode ?? "").toLowerCase();
    if (m === "bike" || m === "moto" || m === "car") return m;
    return "car";
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
    const safe = encodeURIComponent(headerName || t("driver.profile.authFallbackName", { defaultValue: "Chauffeur" }));
    return `https://ui-avatars.com/api/?name=${safe}&background=111827&color=fff&size=128`;
  }, [headerName, t]);

  const avatarUri = useMemo(() => {
    if (avatarBroken) return fallbackAvatarUri;
    if (!avatarUrl) return fallbackAvatarUri;
    const sep = avatarUrl.includes("?") ? "&" : "?";
    const buster = avatarUpdatedAt || avatarPath || Date.now();
    return `${avatarUrl}${sep}v=${encodeURIComponent(String(buster))}`;
  }, [avatarUrl, avatarBroken, avatarPath, fallbackAvatarUri, avatarUpdatedAt]);

  const vehicleLine = useMemo(() => {
    if (isBike) return "—";
    const parts = [
      driver?.vehicle_year ? String(driver.vehicle_year) : null,
      driver?.vehicle_brand ?? null,
      driver?.vehicle_model ?? null,
    ].filter(Boolean);
    const base = parts.length ? parts.join(" ") : "—";
    const plate = driver?.plate_number ? ` • ${driver.plate_number}` : "";
    return `${base}${plate}`;
  }, [driver, isBike]);

  const phoneToShow = useMemo(() => {
    return profile?.phone?.trim() || driver?.phone?.trim() || "—";
  }, [profile?.phone, driver?.phone]);

  const verifiedLabel = useMemo(() => {
    if (isBike) return t("common.profile.bikeNoDocs", { defaultValue: "Vélo ✅" });
    if (hasLicense && hasInsurance && hasRegistration)
      return t("driver.profile.verified.full", { defaultValue: "Dossier complet ✅" });
    return t("driver.profile.verified.notVerified", { defaultValue: "Non vérifié" });
  }, [isBike, hasLicense, hasInsurance, hasRegistration, t]);

  const paymentLabel = useMemo(() => {
    return stripeOnboarded
      ? t("common.ready", { defaultValue: "✅ Configuré" })
      : t("common.notConfigured", { defaultValue: "❌ Non configuré" });
  }, [stripeOnboarded, t]);

  const isTopDriver = useMemo(() => {
    return (avgRating ?? 0) >= 4.7 && statsDeliveries >= 20 && statsCancellationRate <= 10;
  }, [avgRating, statsDeliveries, statsCancellationRate]);

  const driverScore = useMemo(() => {
    const ratingPart = clamp(((avgRating ?? 0) / 5) * 100, 0, 100);
    const deliveryPart = clamp((statsDeliveries / 20) * 100, 0, 100);
    const cancelPart = clamp(100 - statsCancellationRate, 0, 100);
    return Math.round(ratingPart * 0.5 + deliveryPart * 0.3 + cancelPart * 0.2);
  }, [avgRating, statsDeliveries, statsCancellationRate]);

  const driverTier = useMemo(() => {
    if (driverScore >= 85) return 1;
    if (driverScore >= 65) return 2;
    if (driverScore >= 40) return 3;
    return 4;
  }, [driverScore]);

  const docLicense = hasLicense ? t("common.ok", { defaultValue: "OK" }) + " ✅" : t("driver.profile.docs.missing", { defaultValue: "Manquant" });
  const docInsurance = hasInsurance ? t("common.ok", { defaultValue: "OK" }) + " ✅" : t("driver.profile.docs.missing", { defaultValue: "Manquant" });
  const docRegistration = hasRegistration ? t("common.ok", { defaultValue: "OK" }) + " ✅" : t("driver.profile.docs.missing", { defaultValue: "Manquant" });

  // ======================= PARTIE 3/5 =======================
  /* ======================= LOADERS ======================= */
  const loadDocs = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from("driver_documents")
      .select("doc_type")
      .eq("user_id", uid);

    if (error) {
      console.log("loadDocs error", error);
      setHasLicense(false);
      setHasInsurance(false);
      setHasRegistration(false);
      return;
    }

    const types = new Set((data ?? []).map((d: any) => String(d.doc_type)));
    setHasLicense(types.has("license"));
    setHasInsurance(types.has("insurance"));
    setHasRegistration(types.has("registration"));
  }, []);

  const loadRating = useCallback(async (uid: string) => {
    try {
      const { data: sum, error: sumErr } = await supabase
        .from("driver_rating_summary")
        .select("rating, rating_count")
        .eq("driver_id", uid)
        .maybeSingle();

      if (!sumErr && sum && Number((sum as any).rating_count) > 0) {
        const r = Number((sum as any).rating);
        const c = Number((sum as any).rating_count);
        setAvgRating(Number.isFinite(r) ? r : null);
        setRatingCount(Number.isFinite(c) ? c : 0);
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
        .map((r: any) => Number(r.rating))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);

      if (!ratings.length) {
        setAvgRating(null);
        setRatingCount(0);
        return;
      }

      const sumRatings = ratings.reduce((a, b) => a + b, 0);
      setAvgRating(sumRatings / ratings.length);
      setRatingCount(ratings.length);
    } catch (e) {
      console.log("loadRating error", e);
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
        .map((r: any) => ({
          rating: Number(r.rating),
          created_at: String(r.created_at),
        }))
        .filter(
          (r: any) =>
            Number.isFinite(r.rating) &&
            r.rating >= 1 &&
            r.rating <= 5 &&
            !!r.created_at
        );

      setRatingHistory(rows);
    } catch (e) {
      console.log("loadRatingHistory error", e);
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

      const statuses = (data ?? []).map((r: any) => String(r.status ?? "") as OrderStatus);
      const assigned = statuses.length;
      const delivered = statuses.filter((s) => s === "delivered").length;
      const canceled = statuses.filter((s) => s === "canceled").length;

      const acceptedApprox = Math.max(0, assigned - canceled);

      setStatsDeliveries(delivered);
      setStatsCancellationRate(assigned === 0 ? 0 : (canceled / assigned) * 100);
      setStatsAcceptanceRate(assigned === 0 ? 0 : (acceptedApprox / assigned) * 100);
    } catch (e) {
      console.log("loadStatsFromOrders error", e);
      setStatsDeliveries(0);
      setStatsAcceptanceRate(0);
      setStatsCancellationRate(0);
    }
  }, []);

  // ✅ AVATAR (PRO): public URL stable (avatars)
  const refreshAvatarUrl = useCallback(
    async (path: string | null) => {
      if (!path) {
        setAvatarUrl(null);
        setAvatarBroken(false);
        return;
      }

      try {
        setAvatarBroken(false);
        const pub = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
        const url = pub.data.publicUrl ?? null;

        console.log("AVATAR_REFRESH_PATH =", path);
        console.log("AVATAR_PUBLIC_URL =", url);

        setAvatarUrl(url);
      } catch (e) {
        console.log("refreshAvatarUrl error", e);
        setAvatarUrl(null);
        setAvatarBroken(false);
      }
    },
    [AVATARS_BUCKET]
  );

  const refreshStripeStatus = useCallback(async (uid: string) => {
    try {
      const { error: syncErr } = await supabase.functions.invoke("check_connect_status");
      if (syncErr) console.log("check_connect_status error:", syncErr);

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

      setStripeAccountId((data as any)?.stripe_account_id ?? null);
      setStripeOnboarded(Boolean((data as any)?.stripe_onboarded));
    } catch (e) {
      console.log("refreshStripeStatus catch", e);
      setStripeAccountId(null);
      setStripeOnboarded(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) console.log("auth.getUser error", authErr);

      const user = authData?.user;
      if (!user) {
        setProfile(null);
        setDriver(null);

        setAuthFallbackName(t("driver.profile.authFallbackName", { defaultValue: "Chauffeur" }));
        setAvatarPath(null);
        setAvatarUrl(null);
        setAvatarBroken(false);
        setAvatarUpdatedAt(0);

        setStripeAccountId(null);
        setStripeOnboarded(false);

        setHasLicense(false);
        setHasInsurance(false);
        setHasRegistration(false);

        setAvgRating(null);
        setRatingCount(0);
        setRatingHistory([]);

        setStatsDeliveries(0);
        setStatsAcceptanceRate(0);
        setStatsCancellationRate(0);

        console.log("LOADALL: no user session");
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

      console.log("LOADALL: uid =", uid);
      console.log("META avatar_path =", metaAvatarPath);
      console.log("META avatar_updated_at =", metaUpdatedAt);

      const { data: p, error: pErr } = await supabase
        .from("profiles")
        .select("id, full_name, phone, role, avatar_url")
        .eq("id", uid)
        .maybeSingle();

      if (pErr) console.log("profiles error", pErr);

      const dbAvatarPath = ((p as any)?.avatar_url as string | null) ?? null;

      const finalAvatarPath = dbAvatarPath || metaAvatarPath || null;

      setAvatarPath(finalAvatarPath);
      setAvatarUpdatedAt(metaUpdatedAt);
      await refreshAvatarUrl(finalAvatarPath);

      setProfile(
        (p as any) ?? {
          id: uid,
          full_name: null,
          phone: null,
          role: "livreur",
        }
      );

      const { data: d, error: dErr } = await supabase
        .from("driver_profiles")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();

      if (dErr) console.log("driver_profiles error", dErr);

      if (!d) {
        const { data: created, error: cErr } = await supabase
          .from("driver_profiles")
          .upsert(
            {
              user_id: uid,
              transport_mode: "car",
              full_name: (p as any)?.full_name ?? null,
              phone: (p as any)?.phone ?? null,
            },
            { onConflict: "user_id" }
          )
          .select("*")
          .single();

        if (cErr) console.log("upsert driver_profiles error", cErr);
        setDriver((created as any) ?? null);
      } else {
        setDriver(d as any);
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
      loadAll();
    }, [loadAll])
  );

  // ======================= PARTIE 4/5 =======================
  /* ======================= EDIT ======================= */
  function openEdit() {
    setEditName(driver?.full_name ?? profile?.full_name ?? "");
    setEditPhone(profile?.phone ?? driver?.phone ?? "");
    setEditPlate(isBike ? "" : driver?.plate_number ?? "");
    setEditBrand(isBike ? "" : driver?.vehicle_brand ?? "");
    setEditModel(isBike ? "" : driver?.vehicle_model ?? "");
    setEditYear(isBike ? "" : driver?.vehicle_year ? String(driver.vehicle_year) : "");
    setEditColor(isBike ? "" : driver?.vehicle_color ?? "");
    setEditOpen(true);
  }

  async function saveEdit() {
    try {
      setSaving(true);

      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) {
        Alert.alert(t("client.auth.errorTitle", { defaultValue: "Erreur" }), t("driver.home.errors.mustBeLoggedIn", { defaultValue: "Tu dois être connecté." }));
        return;
      }

      const yearNum = editYear.trim().length > 0 ? Number(editYear.trim()) : null;
      const safeYear = yearNum && Number.isFinite(yearNum) ? Math.round(yearNum) : null;

      const { error: pErr } = await supabase.from("profiles").upsert(
        {
          id: uid,
          role: profile?.role ?? "livreur",
          full_name: editName.trim() || null,
          phone: editPhone.trim() || null,
        },
        { onConflict: "id" }
      );

      if (pErr) {
        console.log("profiles upsert error", pErr);
        Alert.alert(t("client.auth.errorTitle", { defaultValue: "Erreur" }), t("common.profile.saveProfilesFailed", { defaultValue: "Impossible de sauvegarder le compte (profiles)." }));
        return;
      }

      const payload: Partial<DriverProfileRow> = isBike
        ? {
            full_name: editName.trim() || null,
            phone: editPhone.trim() || null,
            transport_mode: "bike",
            vehicle_brand: null,
            vehicle_model: null,
            vehicle_year: null,
            vehicle_color: null,
            plate_number: null,
          }
        : {
            full_name: editName.trim() || null,
            phone: editPhone.trim() || null,
            vehicle_brand: editBrand.trim() || null,
            vehicle_model: editModel.trim() || null,
            vehicle_year: safeYear,
            vehicle_color: editColor.trim() || null,
            plate_number: editPlate.trim() || null,
          };

      const { error: dErr } = await supabase
        .from("driver_profiles")
        .update(payload as any)
        .eq("user_id", uid);

      if (dErr) {
        console.log("driver_profiles update error", dErr);
        Alert.alert(t("client.auth.errorTitle", { defaultValue: "Erreur" }), t("common.profile.saveDriverProfilesFailed", { defaultValue: "Impossible de sauvegarder (driver_profiles)." }));
        return;
      }

      setEditOpen(false);
      await loadAll();
      Alert.alert(t("common.ok", { defaultValue: "OK" }), t("common.profile.updated", { defaultValue: "Profil mis à jour ✅" }));
    } finally {
      setSaving(false);
    }
  }

  /* ======================= PICKERS (DOCS) ======================= */
  async function pickFromCamera(): Promise<{ uri: string; mime: string; name: string } | null> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t("common.permission.title", { defaultValue: "Permission" }), t("common.permission.camera", { defaultValue: "Autorise la caméra pour prendre une photo." }));
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

  async function pickFromFiles(): Promise<{ uri: string; mime: string; name: string } | null> {
    const res = await DocumentPicker.getDocumentAsync({
      type: ["image/*", "application/pdf"],
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

  /* ======================= PICKERS (AVATAR) ======================= */
  async function pickAvatarFromCamera(): Promise<{ uri: string; mime: string; name: string } | null> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t("common.permission.title", { defaultValue: "Permission" }), t("common.permission.camera", { defaultValue: "Autorise la caméra pour prendre une photo." }));
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
    const res = await DocumentPicker.getDocumentAsync({
      type: ["image/*"],
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (res.canceled) return null;

    const file = res.assets?.[0];
    if (!file?.uri) return null;

    const lower = (file.name ?? "").toLowerCase();
    const mime =
      file.mimeType ||
      (lower.endsWith(".jpg") || lower.endsWith(".jpeg")
        ? "image/jpeg"
        : lower.endsWith(".png")
        ? "image/png"
        : "application/octet-stream");

    return { uri: file.uri, mime, name: file.name || `avatar_${Date.now()}` };
  }

  /* ======================= STORAGE HELPERS ======================= */
  function avatarStoragePath(uid: string) {
    return `drivers/${uid}/avatar.jpg`;
  }

  function normalizeAvatarPath(uid: string, p: string | null) {
    if (!p) return null;
    const s = String(p).trim();
    if (!s) return null;

    if (s.startsWith("drivers/")) return s;
    if (s.startsWith("clients/")) return s;

    if (s.startsWith(`${uid}/`)) return `drivers/${uid}/avatar.jpg`;

    return s;
  }

  // ======================= PARTIE 5/5 =======================
  async function uploadAvatar(source: "camera" | "files") {
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) console.log("uploadAvatar auth error", authErr);

      const uid = authData?.user?.id;
      if (!uid) {
        Alert.alert(t("driver.security.sessionTitle", { defaultValue: "Session expirée" }), t("driver.security.sessionBody", { defaultValue: "Reconnecte-toi pour continuer." }));
        return;
      }

      setSaving(true);

      const picked = source === "camera" ? await pickAvatarFromCamera() : await pickAvatarFromFiles();
      if (!picked) return;

      const storagePath = avatarStoragePath(uid);
      const contentType = "image/jpeg";

      const base64 = await FileSystem.readAsStringAsync(picked.uri, {
        encoding: "base64" as any,
      });

      const bytes = decode(base64);

      const { error: upErr } = await supabase.storage
        .from(AVATARS_BUCKET)
        .upload(storagePath, bytes, {
          contentType,
          upsert: true,
          cacheControl: "3600",
        });

      if (upErr) {
        Alert.alert(t("client.auth.errorTitle", { defaultValue: "Erreur" }), t("common.profile.avatarUploadFailed", { defaultValue: "Upload avatar impossible. Vérifie Storage policies (avatars)." }));
        return;
      }

      const updatedAt = Date.now();

      await supabase
        .from("profiles")
        .update({ avatar_url: storagePath })
        .eq("id", uid);

      await supabase.auth.updateUser({
        data: { avatar_path: storagePath, avatar_updated_at: updatedAt },
      });

      setAvatarPath(storagePath);
      setAvatarUpdatedAt(updatedAt);
      setAvatarBroken(false);
      await refreshAvatarUrl(storagePath);

      Alert.alert(t("common.ok", { defaultValue: "OK" }) + " ✅", t("common.profile.avatarUpdated", { defaultValue: "Photo de profil mise à jour." }));
    } catch (e: any) {
      console.log("uploadAvatar catch", e);
      Alert.alert(t("client.auth.errorTitle", { defaultValue: "Erreur" }), e?.message ?? t("common.profile.avatarUnknownError", { defaultValue: "Upload avatar: erreur inconnue." }));
    } finally {
      setSaving(false);
    }
  }

  function openAvatarMenu() {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t("common.profile.avatarTitle", { defaultValue: "Photo de profil" }),
          options: [t("shared.common.cancel", { defaultValue: "Annuler" }), t("driver.auth.actions.camera", { defaultValue: "Caméra" }), t("driver.auth.actions.files", { defaultValue: "Fichiers" })],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) uploadAvatar("camera");
          if (idx === 2) uploadAvatar("files");
        }
      );
      return;
    }

    Alert.alert(
      t("common.profile.avatarTitle", { defaultValue: "Photo de profil" }),
      t("driver.profile.chooseOption", { defaultValue: "Choisis une option :" }),
      [
        { text: t("shared.common.cancel", { defaultValue: "Annuler" }), style: "cancel" },
        { text: t("driver.auth.actions.camera", { defaultValue: "Caméra" }), onPress: () => uploadAvatar("camera") },
        { text: t("driver.auth.actions.files", { defaultValue: "Fichiers" }), onPress: () => uploadAvatar("files") },
      ]
    );
  }

  async function uploadDoc(docType: DocType, source: "camera" | "files") {
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) console.log("uploadDoc auth error", authErr);

      const uid = authData?.user?.id;
      if (!uid) {
        Alert.alert(t("driver.security.sessionTitle", { defaultValue: "Session expirée" }), t("driver.security.sessionBody", { defaultValue: "Reconnecte-toi pour continuer." }));
        return;
      }

      if (isBike) {
        Alert.alert(t("driver.auth.transport.bike", { defaultValue: "Vélo" }), t("common.profile.bikeNoDocs", { defaultValue: "En mode vélo, aucun document n’est requis ✅" }));
        return;
      }

      setSaving(true);

      const picked = source === "camera" ? await pickFromCamera() : await pickFromFiles();
      if (!picked) return;

      const ext = inferExt(picked.name, picked.mime);
      const path = `${uid}/${docType}/${Date.now()}.${ext}`;

      const base64 = await FileSystem.readAsStringAsync(picked.uri, {
        encoding: "base64" as any,
      });
      const bytes = decode(base64);

      const { error: upErr } = await supabase.storage
        .from(DRIVER_DOCS_BUCKET)
        .upload(path, bytes, {
          contentType: picked.mime,
          upsert: true,
          cacheControl: "3600",
        });

      if (upErr) {
        Alert.alert(t("client.auth.errorTitle", { defaultValue: "Erreur" }), t("common.profile.docUploadFailed", { defaultValue: "Upload impossible. Vérifie Storage policies (driver-docs)." }));
        return;
      }

      const { error: insErr } = await supabase.from("driver_documents").insert({
        user_id: uid,
        doc_type: docType,
        file_path: path,
      } satisfies DriverDocRow);

      if (insErr) {
        Alert.alert(t("client.auth.errorTitle", { defaultValue: "Erreur" }), t("common.profile.docDbFailed", { defaultValue: "Fichier uploadé mais DB non mise à jour (driver_documents)." }));
        return;
      }

      Alert.alert(t("common.ok", { defaultValue: "OK" }) + " ✅", t("common.profile.docSent", { doc: docLabelI18n(docType), defaultValue: "{{doc}} envoyé." }));
      await loadAll();
    } catch (e: any) {
      console.log("uploadDoc catch", e);
      Alert.alert(t("client.auth.errorTitle", { defaultValue: "Erreur" }), e?.message ?? t("common.profile.docUnknownError", { defaultValue: "Upload doc: erreur inconnue." }));
    } finally {
      setSaving(false);
    }
  }

  function openDocMenu(docType: DocType) {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t("common.profile.uploadDocTitle", { doc: docLabelI18n(docType), defaultValue: "Uploader {{doc}}" }),
          options: [t("shared.common.cancel", { defaultValue: "Annuler" }), t("driver.auth.actions.camera", { defaultValue: "Caméra" }), t("driver.auth.actions.files", { defaultValue: "Fichiers" })],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) uploadDoc(docType, "camera");
          if (idx === 2) uploadDoc(docType, "files");
        }
      );
      return;
    }

    Alert.alert(
      t("common.profile.uploadDocTitle", { doc: docLabelI18n(docType), defaultValue: "Uploader {{doc}}" }),
      t("driver.profile.chooseOption", { defaultValue: "Choisis une option :" }),
      [
        { text: t("shared.common.cancel", { defaultValue: "Annuler" }), style: "cancel" },
        { text: t("driver.auth.actions.camera", { defaultValue: "Caméra" }), onPress: () => uploadDoc(docType, "camera") },
        { text: t("driver.auth.actions.files", { defaultValue: "Fichiers" }), onPress: () => uploadDoc(docType, "files") },
      ]
    );
  }

  const onPressStripe = useCallback(async () => {
    try {
      await startStripeOnboarding("driver");
    } catch (e: any) {
      Alert.alert("Stripe", e?.message ?? t("driver.payments.unavailable", { defaultValue: "Impossible d’ouvrir Stripe pour le moment." }));
    }
  }, [t]);

  /* ======================= JSX ======================= */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      {/* Header */}
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
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>{t("common.back", { defaultValue: "← Retour" })}</Text>
        </TouchableOpacity>

        <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>
          {t("common.profile.title", { defaultValue: "Profil" })}
        </Text>

        <TouchableOpacity onPress={openEdit}>
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
            {t("common.profile.editProfileTitle", { defaultValue: "Modifier le profil" }).includes("Modifier")
              ? t("driver.profile.editShort", { defaultValue: "Modifier" })
              : t("driver.profile.editShort", { defaultValue: "Edit" })}
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
          {/* Profile Card */}
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
                    onError={(e) => {
                      console.log("AVATAR_IMAGE_ERROR =", e?.nativeEvent ?? null);
                      console.log("AVATAR_URI_USED =", avatarUri);
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

                  <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                    {"  "}•{"  "}
                  </Text>
                  <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                    {verifiedLabel}
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
                      {t("common.profile.driverScore", { defaultValue: "Driver Score" })}: {driverScore}/100
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
                  {isBike ? t("common.profile.bikeNoVehicleLine", { defaultValue: "Vélo : pas de permis / plaque / assurance / registration" }) : vehicleLine}
                </Text>
              </View>
            </View>

            <View style={{ height: 12 }} />

            <View style={{ flexDirection: "row" }}>
              <View style={{ flex: 1, backgroundColor: "#0A1730", borderRadius: 14, padding: 12, marginRight: 10 }}>
                <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                  {t("common.profile.deliveries", { defaultValue: "Livraisons" })}
                </Text>
                <Text style={{ color: "white", fontSize: 18, fontWeight: "900", marginTop: 6 }}>
                  {statsDeliveries}
                </Text>
              </View>

              <View style={{ flex: 1, backgroundColor: "#0A1730", borderRadius: 14, padding: 12, marginRight: 10 }}>
                <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                  {t("common.profile.acceptance", { defaultValue: "Acceptation" })}
                </Text>
                <Text style={{ color: "white", fontSize: 18, fontWeight: "900", marginTop: 6 }}>
                  {pct(statsAcceptanceRate)}
                </Text>
              </View>

              <View style={{ flex: 1, backgroundColor: "#0A1730", borderRadius: 14, padding: 12 }}>
                <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                  {t("common.profile.cancellation", { defaultValue: "Annulation" })}
                </Text>
                <Text style={{ color: "white", fontSize: 18, fontWeight: "900", marginTop: 6 }}>
                  {pct(statsCancellationRate)}
                </Text>
              </View>
            </View>

            <Text style={{ color: "#64748B", marginTop: 10, fontWeight: "700" }}>
              {t("common.profile.tipChangePhoto", { defaultValue: "Astuce : touche la photo pour la changer (caméra / fichiers)." })}
            </Text>
          </Card>

          <SectionTitle>{t("common.profile.accountSection", { defaultValue: "Compte" })}</SectionTitle>
          <Card>
            <Row label={t("common.profile.name", { defaultValue: "Nom" })} value={headerName} />
            <Divider />
            <Row label={t("common.profile.phone", { defaultValue: "Téléphone" })} value={phoneToShow} />
            <Divider />
            <Row label={t("common.profile.transport", { defaultValue: "Transport" })} value={transportLabelI18n(transportMode)} />
            <Divider />
            <Row
              label={t("common.profile.payment", { defaultValue: "Paiement" })}
              value={paymentLabel}
              onPress={!stripeOnboarded ? onPressStripe : undefined}
            />
            {!stripeOnboarded ? (
              <Text style={{ color: "#94A3B8", marginTop: 8, fontWeight: "700" }}>
                {t("common.profile.configureStripeHint", { defaultValue: "Configure Stripe pour activer les gains. (touche “Paiement”)" })}
              </Text>
            ) : null}
            <Divider />
            <Row label={t("common.profile.status", { defaultValue: "Statut" })} value={verifiedLabel} />
          </Card>

          <SectionTitle>{t("common.profile.documentsSection", { defaultValue: "Documents" })}</SectionTitle>
          <Card>
            {isBike ? (
              <Row label={t("common.profile.info", { defaultValue: "Info" })} value={t("common.profile.bikeNoDocsRow", { defaultValue: "Vélo : aucun document requis" })} />
            ) : (
              <>
                <Row
                  label={docLabelI18n("license")}
                  value={saving ? t("shared.common.loadingEllipsis", { defaultValue: "…" }) : docLicense}
                  onPress={() => openDocMenu("license")}
                />
                <Divider />
                <Row
                  label={docLabelI18n("insurance")}
                  value={saving ? t("shared.common.loadingEllipsis", { defaultValue: "…" }) : docInsurance}
                  onPress={() => openDocMenu("insurance")}
                />
                <Divider />
                <Row
                  label={docLabelI18n("registration")}
                  value={saving ? t("shared.common.loadingEllipsis", { defaultValue: "…" }) : docRegistration}
                  onPress={() => openDocMenu("registration")}
                />
              </>
            )}
          </Card>

          <SectionTitle>{t("common.profile.ratingHistorySection", { defaultValue: "Historique des notes" })}</SectionTitle>
          <Card>
            {ratingHistory.length === 0 ? (
              <Text style={{ color: "#94A3B8", fontWeight: "700" }}>
                {t("common.profile.noReviewsYet", { defaultValue: "Aucun avis pour l’instant." })}
              </Text>
            ) : (
              <View>
                {ratingHistory
                  .slice()
                  .reverse()
                  .map((r, idx) => (
                    <View
                      key={`${r.created_at}-${idx}`}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        paddingVertical: 10,
                      }}
                    >
                      <Text style={{ color: "#CBD5E1", fontWeight: "800" }}>
                        {fmtShortDate(r.created_at)}
                      </Text>
                      <Text style={{ color: "#FBBF24", fontWeight: "900" }}>
                        {Number.isFinite(r.rating) ? `${r.rating.toFixed(1)} ★` : "—"}
                      </Text>
                    </View>
                  ))}
              </View>
            )}
          </Card>
        </ScrollView>
      )}

      {/* Edit modal */}
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
              value={editName}
              onChangeText={setEditName}
              placeholder={t("common.profile.placeholderName", { defaultValue: "Ex: Mamadou" })}
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
              placeholder={t("common.profile.placeholderPhone", { defaultValue: "Ex: 9297408722" })}
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

            {!isBike ? (
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
                  value={editBrand}
                  onChangeText={setEditBrand}
                  placeholder={t("common.profile.placeholderBrand", { defaultValue: "Ex: Honda" })}
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
                  value={editModel}
                  onChangeText={setEditModel}
                  placeholder={t("common.profile.placeholderModel", { defaultValue: "Ex: Accord" })}
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
                  value={editColor}
                  onChangeText={setEditColor}
                  placeholder={t("common.profile.placeholderColor", { defaultValue: "Ex: Noir" })}
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
                      value={editYear}
                      onChangeText={setEditYear}
                      placeholder={t("common.profile.placeholderYear", { defaultValue: "2020" })}
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
                      value={editPlate}
                      onChangeText={setEditPlate}
                      placeholder={t("common.profile.placeholderPlate", { defaultValue: "ABC-1234" })}
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
              </>
            ) : (
              <>
                <View style={{ height: 12 }} />
                <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                  {t("common.profile.bikeNoVehicleHint", { defaultValue: "Vélo : pas besoin de permis/plaque/assurance/registration ✅" })}
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
                onPress={saveEdit}
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
        </View>
      </Modal>
    </SafeAreaView>
  );
}
