// apps/mobile/src/screens/DriverAuthScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  Image,
  ActionSheetIOS,
  StatusBar,
  KeyboardAvoidingView,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import * as Linking from "expo-linking";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "../lib/supabase";
import { validatePassword } from "../lib/authValidation";
import { clearSelectedRole } from "../lib/authRole";
import { getResetPasswordRedirectUrl } from "../lib/productionSite";
import LegalSignupLinks from "../components/LegalSignupLinks";
import { toUserFacingError } from "../lib/userFacingError";
import {
  AUTH_ACTION_TIMEOUT_MS,
  withTimeout,
} from "../lib/bootFailOpen";
import {
  MMD_BLUE,
  MMD_DRIVER_CTA,
  MMD_DRIVER_FIELD_TINT,
  MMD_DRIVER_LINK,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_STROKE,
  MMD_TEXT_SOFT_BLUE,
  MMD_WHITE,
} from "../theme/mmdUi";

type TransportMode = "bike" | "moto" | "car";
type DriverStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "incomplete"
  | "suspended"
  | "disabled";

const AVATARS_BUCKET = "avatars";

function getAvatarExtFromUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".webp")) return "webp";
  return "jpg";
}

function cleanReferralCode(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const code = String(raw ?? "")
    .trim()
    .replace(/^ref[:=]/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .toUpperCase();

  return code.length >= 4 ? code : null;
}

function extractReferralCode(url: string | null): string | null {
  if (!url) return null;

  try {
    const parsed = Linking.parse(url);
    const q = parsed.queryParams ?? {};

    // ✅ Supporte les liens:
    // mmddelivery://r/CODE (legacy mmd://r/CODE still supported via normalizeDeepLinkUrl)
    // https://mmdelivery.com/r/CODE
    // https://mmdelivery.com/signup?ref=CODE
    // https://mmdelivery.com/signup?code=CODE
    const fromRef = cleanReferralCode((q as any).ref);
    if (fromRef) return fromRef;

    const fromCode = cleanReferralCode((q as any).code);
    if (fromCode) return fromCode;

    const path = String(parsed.path ?? "").replace(/^\/+|\/+$/g, "");
    const parts = path.split("/").filter(Boolean);

    const rIndex = parts.findIndex((p) => p.toLowerCase() === "r");
    if (rIndex >= 0 && parts[rIndex + 1]) {
      const fromPath = cleanReferralCode(parts[rIndex + 1]);
      if (fromPath) return fromPath;
    }

    if (parts.length === 1) {
      const only = cleanReferralCode(parts[0]);
      if (only) return only;
    }

    return null;
  } catch {
    return null;
  }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={authStyles.card}>
      <Text style={authStyles.cardTitle}>{title}</Text>
      <View style={{ height: 10 }} />
      {children}
    </View>
  );
}

function Input({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize = "none",
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "email-address" | "phone-pad" | "number-pad";
}) {
  return (
    <View style={authStyles.fieldBlock}>
      <Text style={authStyles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(200,215,245,0.7)"
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        autoCorrect={false}
        style={authStyles.field}
      />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={[
        authStyles.primaryBtn,
        disabled && { opacity: 0.55 },
      ]}
    >
      <Text style={authStyles.primaryBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={authStyles.ghostBtn}
    >
      <Text style={authStyles.ghostBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <Text style={authStyles.link}>{label}</Text>
    </TouchableOpacity>
  );
}

function TransportPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[authStyles.pill, active && authStyles.pillActive]}
      activeOpacity={0.85}
    >
      <Text style={authStyles.pillText}>{label}</Text>
    </TouchableOpacity>
  );
}

function isValidYear(y: string) {
  const t = y.trim();
  if (!t) return true;
  const n = Number(t);
  if (!Number.isFinite(n)) return false;
  const yr = Math.round(n);
  return yr >= 1980 && yr <= 2035;
}

function isValidDateYYYYMMDD(value: string) {
  const t = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;

  const date = new Date(`${t}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;

  const [year, month, day] = t.split("-").map(Number);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function initialsFromName(name: string) {
  const t = name.trim();
  if (!t) return "D";
  const parts = t.split(" ").filter(Boolean);
  const a = parts[0]?.[0] ?? "D";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (a + b).toUpperCase();
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

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = decodeBase64(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function normalizeUsPhoneForTwilio(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  if (raw.startsWith("+")) {
    return raw.replace(/[^+\d]/g, "");
  }

  const digits = raw.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return raw;
}

function isValidTwilioPhone(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value.trim());
}

export function DriverAuthScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [referralCode, setReferralCode] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("New York");
  const [stateValue, setStateValue] = useState("NY");
  const [zipCode, setZipCode] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  const [transportMode, setTransportMode] = useState<TransportMode>("car");

  const [vehicleBrand, setVehicleBrand] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");

  const [avatarLocalUri, setAvatarLocalUri] = useState<string | null>(null);

  const isBike = transportMode === "bike";
  const needsVehicle = transportMode === "car" || transportMode === "moto";

  const canSubmit = useMemo(() => {
    const e = email.trim();
    const p = password.trim();

    if (!e || !p) return false;
    if (validatePassword(p)) return false;

    if (mode === "signup") {
      if (!fullName.trim()) return false;
      if (!phone.trim()) return false;
      if (!emergencyPhone.trim()) return false;
      if (!address.trim()) return false;
      if (!city.trim()) return false;
      if (!zipCode.trim()) return false;
      if (!dateOfBirth.trim()) return false;
      if (!isValidDateYYYYMMDD(dateOfBirth)) return false;

      if (!isValidYear(vehicleYear)) return false;

      if (needsVehicle) {
        if (!vehicleBrand.trim()) return false;
        if (!vehicleModel.trim()) return false;
        if (!plateNumber.trim()) return false;
        if (!licenseNumber.trim()) return false;
      }
    }

    return true;
  }, [
    email,
    password,
    mode,
    fullName,
    phone,
    emergencyPhone,
    address,
    city,
    zipCode,
    dateOfBirth,
    vehicleBrand,
    vehicleModel,
    vehicleYear,
    plateNumber,
    licenseNumber,
    needsVehicle,
  ]);

  useEffect(() => {
    const run = async () => {
      const initialUrl = await Linking.getInitialURL();
      const code = extractReferralCode(initialUrl);
      if (code) {
        setReferralCode(code);
        setMode("signup");
      }
    };

    void run();

    const sub = Linking.addEventListener("url", (event) => {
      const code = extractReferralCode(event.url);
      if (code) {
        setReferralCode(code);
        setMode("signup");
      }
    });

    return () => sub.remove();
  }, []);

  const applyReferralIfAny = useCallback(async () => {
    const code = referralCode.trim();
    if (code.length < 4) return;

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
  }, [referralCode]);

  const routeAfterAuth = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return;

    const { data: prof, error } = await supabase
      .from("driver_profiles")
      .select("user_id,status")
      .eq("user_id", uid)
      .maybeSingle();

    if (error) {
      console.log("driver_profiles check error", error);
      navigation.replace("DriverOnboarding");
      return;
    }

    const status = (prof as { user_id?: string; status?: DriverStatus } | null)
      ?.status;

    if (status === "approved") {
      navigation.replace("DriverTabs");
      return;
    }

    if (status === "pending" || status === "incomplete" || status === "rejected") {
      navigation.replace("DriverOnboarding");
      return;
    }

    if (status === "suspended" || status === "disabled") {
      Alert.alert(
        status === "disabled"
          ? t("driver.auth.alert.accountDisabledTitle", "Account disabled")
          : t("driver.auth.alert.accountSuspendedTitle", "Account suspended"),
        status === "disabled"
          ? t(
              "driver.auth.alert.accountDisabledBody",
              "Your driver account is disabled. Contact MMD Delivery support.",
            )
          : t(
              "driver.auth.alert.accountSuspendedBody",
              "Your driver account is suspended. Contact MMD Delivery support.",
            ),
      );
      await clearSelectedRole();
      await supabase.auth.signOut();
      return;
    }

    navigation.replace("DriverOnboarding");
  }, [navigation, t]);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;

        if (data?.session?.user) {
          await applyReferralIfAny();
          await routeAfterAuth();
        }
      } catch (e) {
        console.log("getSession error", e);
      }
    };

    void run();

    return () => {
      mounted = false;
    };
  }, [applyReferralIfAny, routeAfterAuth]);

  const onLogin = useCallback(async () => {
    if (loading) return;

    try {
      setLoading(true);

      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password: password.trim(),
        }),
        AUTH_ACTION_TIMEOUT_MS,
        "driver_signIn",
      );

      if (error) {
        Alert.alert(t("driver.auth.alert.loginFailedTitle"), toUserFacingError(error, t("driver.auth.alert.loginFailedTitle")));
        return;
      }

      const { data: userData } = await supabase.auth.getUser();

      if (!userData.user?.email_confirmed_at) {
        Alert.alert(
          t("driver.auth.alert.emailNotVerifiedTitle", "Email not verified"),
          t(
            "driver.auth.alert.emailNotVerifiedBody",
            "Confirm your email before logging in.",
          ),
        );
        await clearSelectedRole();
      await supabase.auth.signOut();
        return;
      }

      await applyReferralIfAny();
      await routeAfterAuth();
    } finally {
      setLoading(false);
    }
  }, [email, password, routeAfterAuth, applyReferralIfAny, t, loading]);

  const onForgotPassword = useCallback(async () => {
    if (loading) return;

    const cleanedEmail = email.trim().toLowerCase();

    if (!cleanedEmail) {
      Alert.alert(
        t("driver.auth.alert.emailRequiredTitle", "Email required"),
        t(
          "driver.auth.alert.emailRequiredBody",
          "Enter your email, then tap forgot password.",
        ),
      );
      return;
    }

    try {
      setLoading(true);

      const redirectTo = getResetPasswordRedirectUrl();
      console.log("RESET PASSWORD REDIRECT_TO =", redirectTo);

      const { error } = await supabase.auth.resetPasswordForEmail(cleanedEmail, {
        redirectTo,
      });

      if (error) {
        Alert.alert(
          t("driver.auth.alert.errorTitle", "Error"),
          toUserFacingError(
            error,
            t(
              "driver.auth.alert.genericRetry",
              "Something went wrong temporarily. Please try again.",
            ),
          ),
        );
        return;
      }

      Alert.alert(
        t("driver.auth.alert.resetEmailSentTitle", "Email sent"),
        t(
          "driver.auth.alert.resetEmailSentBody",
          "Check your inbox. Click the link you received to reset your password.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [email, loading, t]);

  const pickAvatarFromCamera = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();

      if (!perm.granted) {
        Alert.alert(
          t("driver.auth.alert.permissionTitle"),
          t("driver.auth.alert.cameraPermission")
        );
        return;
      }

      const res = await ImagePicker.launchCameraAsync({
        quality: 0.85,
        allowsEditing: true,
        aspect: [1, 1],
      });

      if (res.canceled) return;

      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      setAvatarLocalUri(asset.uri);
    } catch (e) {
      console.log("pickAvatarFromCamera error", e);
      Alert.alert(
        t("driver.auth.alert.errorTitle"),
        t("driver.auth.alert.takePhotoFailed")
      );
    }
  }, [t]);

  const pickAvatarFromFiles = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!perm.granted) {
        Alert.alert(
          t("driver.auth.alert.permissionTitle"),
          t("driver.auth.alert.galleryPermission")
        );
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsEditing: true,
        aspect: [1, 1],
      });

      if (res.canceled) return;

      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      setAvatarLocalUri(asset.uri);
    } catch (e) {
      console.log("pickAvatarFromFiles error", e);
      Alert.alert(
        t("driver.auth.alert.errorTitle"),
        t("driver.auth.alert.pickPhotoFailed")
      );
    }
  }, [t]);

  const openAvatarMenu = useCallback(() => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t("driver.auth.avatar.title"),
          options: [
            t("driver.auth.actions.cancel"),
            t("driver.auth.actions.camera"),
            t("driver.auth.actions.files"),
          ],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) void pickAvatarFromCamera();
          if (idx === 2) void pickAvatarFromFiles();
        }
      );
      return;
    }

    Alert.alert(
      t("driver.auth.avatar.title"),
      t("driver.auth.avatar.chooseOption"),
      [
        { text: t("driver.auth.actions.cancel"), style: "cancel" },
        {
          text: t("driver.auth.actions.camera"),
          onPress: () => {
            void pickAvatarFromCamera();
          },
        },
        {
          text: t("driver.auth.actions.files"),
          onPress: () => {
            void pickAvatarFromFiles();
          },
        },
      ]
    );
  }, [pickAvatarFromCamera, pickAvatarFromFiles, t]);

  const uploadAvatarIfAny = useCallback(
    async (uid: string): Promise<string | null> => {
      if (!avatarLocalUri) return null;

      try {
        const ext = getAvatarExtFromUri(avatarLocalUri);
        const storagePath = `drivers/${uid}/avatar.${ext}`;

        const base64 = await FileSystem.readAsStringAsync(avatarLocalUri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const bytes = base64ToUint8Array(base64);

        const contentType =
          ext === "png"
            ? "image/png"
            : ext === "webp"
              ? "image/webp"
              : "image/jpeg";

        const { error: upErr } = await supabase.storage
          .from(AVATARS_BUCKET)
          .upload(storagePath, bytes, {
            contentType,
            upsert: true,
          });

        if (upErr) {
          console.log("avatar upload error", upErr);
          return null;
        }

        return storagePath;
      } catch (e) {
        console.log("uploadAvatarIfAny error", e);
        return null;
      }
    },
    [avatarLocalUri]
  );

  const onSignup = useCallback(async () => {
    if (loading) return;

    try {
      setLoading(true);

      if (mode !== "signup") return;

      if (!canSubmit) {
        Alert.alert(
          t("driver.auth.alert.incompleteSignupTitle", "Incomplete information"),
          t(
            "driver.auth.alert.incompleteSignupBody",
            "Fill in all required fields before creating your account.",
          ),
        );
        return;
      }

      const cleanedEmail = email.trim().toLowerCase();
      const cleanedPassword = password.trim();
      const cleanedFullName = fullName.trim();
      const cleanedPhone = normalizeUsPhoneForTwilio(phone);
      const cleanedEmergencyPhone = normalizeUsPhoneForTwilio(emergencyPhone);
      const cleanedAddress = address.trim();
      const cleanedCity = city.trim();
      const cleanedState = stateValue.trim().toUpperCase() || null;
      const cleanedZipCode = zipCode.trim();
      const cleanedDateOfBirth = dateOfBirth.trim();

      if (!isValidTwilioPhone(cleanedPhone)) {
        Alert.alert(
          t("driver.auth.alert.invalidPhoneTitle", "Invalid phone"),
          t(
            "driver.auth.alert.invalidPhoneBody",
            "Enter a valid US phone number. Example: 9297408722 or +19297408722.",
          ),
        );
        return;
      }

      if (!isValidTwilioPhone(cleanedEmergencyPhone)) {
        Alert.alert(
          t("driver.auth.alert.invalidEmergencyPhoneTitle", "Invalid emergency phone"),
          t(
            "driver.auth.alert.invalidEmergencyPhoneBody",
            "Enter a valid emergency phone number. Example: 9297408722 or +19297408722.",
          ),
        );
        return;
      }

      const cleanedVehicleBrand = vehicleBrand.trim();
      const cleanedVehicleModel = vehicleModel.trim();
      const cleanedVehicleColor = vehicleColor.trim();
      const cleanedPlateNumber = plateNumber.trim().toUpperCase();
      const cleanedLicenseNumber = licenseNumber.trim().toUpperCase();

      const { data, error } = await supabase.auth.signUp({
        email: cleanedEmail,
        password: cleanedPassword,
        options: {
          data: {
            full_name: cleanedFullName,
            role: "driver",
            referral_code: referralCode.trim().toUpperCase() || null,
          },
        },
      });

      if (error) {
        Alert.alert(t("driver.auth.alert.signupFailedTitle"), toUserFacingError(error, t("driver.auth.alert.signupFailedTitle")));
        return;
      }

      const identities = (data?.user as any)?.identities;
      if (Array.isArray(identities) && identities.length === 0) {
        Alert.alert(
          t("driver.auth.alert.accountExistsTitle", "Account already exists"),
          t(
            "driver.auth.alert.accountExistsBody",
            "An account already exists with this email.",
          ),
        );
        setMode("login");
        return;
      }

      const user = data?.user;
      if (!user) {
        Alert.alert(
          t("driver.auth.alert.verifyEmailSignupTitle", "Verify your email"),
          t(
            "driver.auth.alert.verifyEmailSignupBody",
            "Confirm your email before logging in.",
          ),
        );
        setMode("login");
        return;
      }

      const uid = user.id;

      await applyReferralIfAny();
      const avatarPath = await uploadAvatarIfAny(uid);

      await supabase.from("profiles").upsert(
        {
          id: uid,
          role: "driver",
          full_name: cleanedFullName,
          phone: cleanedPhone,
          avatar_url: avatarPath,
        },
        { onConflict: "id" }
      );

      const yearNum = vehicleYear.trim() ? Number(vehicleYear.trim()) : null;

      const payload = {
        id: uid,
        user_id: uid,

        full_name: cleanedFullName,
        phone: cleanedPhone,
        emergency_phone: cleanedEmergencyPhone,
        address: cleanedAddress,
        city: cleanedCity,
        state: cleanedState,
        zip_code: cleanedZipCode,
        date_of_birth: cleanedDateOfBirth,

        transport_mode: transportMode,
        status: "pending",
        is_online: false,

        vehicle_type: transportMode,
        license_number: isBike ? null : cleanedLicenseNumber,
        // Fleet fields live on driver_vehicles — never write legacy columns at signup.
        vehicle_brand: null,
        vehicle_model: null,
        vehicle_year: null,
        vehicle_color: null,
        plate_number: null,
      };

      const { error: dErr } = await supabase
        .from("driver_profiles")
        .upsert(payload, { onConflict: "user_id" });

      if (dErr) {
        Alert.alert(
          t("driver.auth.alert.profileErrorTitle", "Profile error"),
          dErr.message,
        );
        return;
      }

      Alert.alert(
        t("driver.auth.alert.applicationSubmittedTitle", "Application submitted"),
        t(
          "driver.auth.alert.applicationSubmittedBody",
          "Your driver account is pending approval.",
        ),
      );

      navigation.replace("DriverOnboarding");
    } finally {
      setLoading(false);
    }
  }, [
    mode,
    canSubmit,
    email,
    password,
    fullName,
    phone,
    emergencyPhone,
    address,
    city,
    stateValue,
    zipCode,
    dateOfBirth,
    transportMode,
    vehicleBrand,
    vehicleModel,
    vehicleYear,
    vehicleColor,
    plateNumber,
    licenseNumber,
    isBike,
    referralCode,
    applyReferralIfAny,
    uploadAvatarIfAny,
    navigation,
    t,
    loading,
  ]);

  useEffect(() => {
    if (transportMode === "bike") {
      setVehicleBrand("");
      setVehicleModel("");
      setVehicleYear("");
      setVehicleColor("");
      setPlateNumber("");
      setLicenseNumber("");
    }
  }, [transportMode]);

  const avatarBadgeText = useMemo(
    () => initialsFromName(fullName || "Driver"),
    [fullName]
  );

  const { width } = useWindowDimensions();
  const contentMax = width >= 768 ? 560 : undefined;

  return (
    <SafeAreaView style={authStyles.root}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <View style={authStyles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        >
          <Text style={[authStyles.back, loading && { opacity: 0.5 }]}>
            ← {t("common.back")}
          </Text>
        </TouchableOpacity>

        <Text style={authStyles.headerTitle}>
          {mode === "signup"
            ? t("driver.auth.header.signup")
            : t("driver.auth.header.login")}
        </Text>

        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            authStyles.scroll,
            contentMax ? { maxWidth: contentMax, alignSelf: "center", width: "100%" } : null,
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ height: 18 }} />
          <Card
            title={
              mode === "signup"
                ? t("driver.auth.card.signupTitle")
                : t("driver.auth.card.loginTitle")
            }
          >
            {mode === "signup" ? (
              <View style={authStyles.switchRow}>
                <Text style={authStyles.switchLabel}>
                  {t("driver.auth.switch.haveAccount")}
                </Text>
                <LinkButton
                  label={t("driver.auth.switch.relogin")}
                  onPress={() => setMode("login")}
                />
              </View>
            ) : (
              <View style={[authStyles.switchRow, authStyles.switchRowTint]}>
                <Text style={authStyles.switchLabel}>
                  {t("driver.auth.switch.newDriver")}
                </Text>
                <LinkButton
                  label={t("driver.auth.switch.createAccount")}
                  onPress={() => setMode("signup")}
                />
              </View>
            )}

            <Input
              label={t("driver.auth.fields.email")}
              value={email}
              onChangeText={setEmail}
              placeholder={t("driver.auth.fields.emailPlaceholder")}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <View style={authStyles.fieldBlock}>
              <Text style={authStyles.label}>
                {t("driver.auth.fields.password")}
              </Text>
              <View style={authStyles.passwordRow}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t("driver.auth.fields.passwordPlaceholder")}
                  placeholderTextColor="rgba(200,215,245,0.7)"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[authStyles.field, { flex: 1, marginTop: 0 }]}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((value) => !value)}
                  style={{ paddingHorizontal: 4 }}
                >
                  <Text style={authStyles.showPwd}>
                    {showPassword ? "Hide" : "Show"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {mode === "login" ? (
              <View style={authStyles.forgotRow}>
                <LinkButton
                  label="Forgot password ?"
                  onPress={() => void onForgotPassword()}
                />
              </View>
            ) : null}

            {mode === "signup" ? (
              <>
                <View style={{ height: 6 }} />
                <Text style={authStyles.label}>
                  {t("driver.auth.avatar.optional")}
                </Text>
                <View style={{ height: 10 }} />

                <View style={authStyles.avatarRow}>
                  <View style={authStyles.avatarCircle}>
                    {avatarLocalUri ? (
                      <Image
                        source={{ uri: avatarLocalUri }}
                        style={{ width: 64, height: 64 }}
                      />
                    ) : (
                      <Text style={authStyles.avatarInitials}>
                        {avatarBadgeText}
                      </Text>
                    )}
                  </View>

                  <TouchableOpacity
                    onPress={openAvatarMenu}
                    activeOpacity={0.85}
                    style={authStyles.addPhotoBtn}
                  >
                    <Text style={authStyles.addPhotoText}>
                      {avatarLocalUri
                        ? t("driver.auth.avatar.change")
                        : t("driver.auth.avatar.add")}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ height: 14 }} />

                <Input
                  label={t("driver.auth.fields.fullName")}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder={t("driver.auth.fields.fullNamePlaceholder")}
                  autoCapitalize="words"
                />

                <Input
                  label={t("driver.auth.fields.phone")}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder={t("driver.auth.fields.phonePlaceholder")}
                  autoCapitalize="none"
                  keyboardType="phone-pad"
                />

                <Input
                  label="Emergency phone"
                  value={emergencyPhone}
                  onChangeText={setEmergencyPhone}
                  placeholder="Ex: 9297408722"
                  autoCapitalize="none"
                  keyboardType="phone-pad"
                />

                <Input
                  label="Address"
                  value={address}
                  onChangeText={setAddress}
                  placeholder="Ex: 1112 Flatbush Ave"
                  autoCapitalize="words"
                />

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="City"
                      value={city}
                      onChangeText={setCity}
                      placeholder="New York"
                      autoCapitalize="words"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="State"
                      value={stateValue}
                      onChangeText={setStateValue}
                      placeholder="NY"
                      autoCapitalize="characters"
                    />
                  </View>
                </View>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Zip code"
                      value={zipCode}
                      onChangeText={setZipCode}
                      placeholder="11226"
                      autoCapitalize="none"
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Date of birth"
                      value={dateOfBirth}
                      onChangeText={setDateOfBirth}
                      placeholder="YYYY-MM-DD"
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                {dateOfBirth.trim() && !isValidDateYYYYMMDD(dateOfBirth) ? (
                  <Text style={authStyles.errorText}>
                    Date format required: YYYY-MM-DD
                  </Text>
                ) : null}

                <Text style={authStyles.label}>
                  {t("driver.auth.transport.title")}
                </Text>
                <View style={{ height: 8 }} />

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TransportPill
                    label={t("driver.auth.transport.bike")}
                    active={transportMode === "bike"}
                    onPress={() => setTransportMode("bike")}
                  />
                  <TransportPill
                    label={t("driver.auth.transport.moto")}
                    active={transportMode === "moto"}
                    onPress={() => setTransportMode("moto")}
                  />
                  <TransportPill
                    label={t("driver.auth.transport.car")}
                    active={transportMode === "car"}
                    onPress={() => setTransportMode("car")}
                  />
                </View>

                <View style={{ height: 12 }} />

                {needsVehicle ? (
                  <>
                    <Text style={authStyles.sectionTitle}>
                      {t("driver.auth.vehicle.title")}
                    </Text>
                    <View style={{ height: 10 }} />

                    <Input
                      label={t("driver.auth.vehicle.brand")}
                      value={vehicleBrand}
                      onChangeText={setVehicleBrand}
                      placeholder={t("driver.auth.vehicle.brandPlaceholder")}
                      autoCapitalize="words"
                    />

                    <Input
                      label={t("driver.auth.vehicle.model")}
                      value={vehicleModel}
                      onChangeText={setVehicleModel}
                      placeholder={t("driver.auth.vehicle.modelPlaceholder")}
                      autoCapitalize="words"
                    />

                    <Input
                      label="License number"
                      value={licenseNumber}
                      onChangeText={setLicenseNumber}
                      placeholder="Driver license number"
                      autoCapitalize="characters"
                    />

                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Input
                          label={t("driver.auth.vehicle.yearOptional")}
                          value={vehicleYear}
                          onChangeText={setVehicleYear}
                          placeholder="2020"
                          autoCapitalize="none"
                          keyboardType="number-pad"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Input
                          label={t("driver.auth.vehicle.colorOptional")}
                          value={vehicleColor}
                          onChangeText={setVehicleColor}
                          placeholder="Black"
                          autoCapitalize="words"
                        />
                      </View>
                    </View>

                    <Input
                      label={t("driver.auth.vehicle.plate")}
                      value={plateNumber}
                      onChangeText={setPlateNumber}
                      placeholder="ABC123"
                      autoCapitalize="characters"
                    />

                    {!isValidYear(vehicleYear) ? (
                      <Text style={authStyles.errorText}>
                        {t("driver.auth.vehicle.invalidYear")}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={authStyles.hintMuted}>
                    {t("driver.auth.vehicle.bikeNoDocs")}
                  </Text>
                )}

                <View style={{ height: 10 }} />

                <Input
                  label={t("driver.auth.referral.title")}
                  value={referralCode}
                  onChangeText={setReferralCode}
                  placeholder={t("driver.auth.referral.placeholder")}
                  autoCapitalize="characters"
                />

                <Text style={authStyles.hintMuted}>
                  {t("driver.auth.referral.autoFillHint")}
                </Text>

                <View style={{ height: 12 }} />
                <Text style={authStyles.label}>
                  {t("driver.auth.documents.title")}
                </Text>
                <View style={{ height: 6 }} />

                {isBike ? (
                  <Text style={authStyles.hintSoft}>
                    {t("driver.auth.documents.bikeNone")}
                  </Text>
                ) : (
                  <Text style={authStyles.hintSoft}>
                    {t("driver.auth.documents.carHint")}
                  </Text>
                )}
              </>
            ) : null}

            <View style={{ height: 14 }} />

            {mode === "signup" ? (
              <LegalSignupLinks disabled={!canSubmit} />
            ) : null}

            <PrimaryButton
              label={
                mode === "signup"
                  ? t("driver.auth.actions.createMyAccount")
                  : t("driver.auth.actions.login")
              }
              onPress={
                mode === "signup" ? () => void onSignup() : () => void onLogin()
              }
              disabled={!canSubmit}
            />

            <View style={{ height: 12 }} />

            <GhostButton
              label={
                mode === "signup"
                  ? t("driver.auth.actions.haveAccountLogin")
                  : t("driver.auth.actions.createAccountSignup")
              }
              onPress={() =>
                setMode((m) => (m === "signup" ? "login" : "signup"))
              }
            />
          </Card>

          <Text style={authStyles.footer}>{t("driver.auth.footer")}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const authStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: MMD_BLUE,
  },
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: MMD_BLUE,
  },
  back: {
    color: MMD_DRIVER_LINK,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  headerTitle: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    paddingTop: 0,
  },
  card: {
    backgroundColor: MMD_BLUE,
    borderColor: MMD_STROKE,
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 14,
  },
  cardTitle: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    marginBottom: 8,
  },
  switchRowTint: {
    backgroundColor: MMD_DRIVER_FIELD_TINT,
  },
  switchLabel: {
    color: "rgba(255,255,255,0.9)",
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 13,
  },
  link: {
    color: MMD_DRIVER_LINK,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 13,
  },
  fieldBlock: {
    marginBottom: 12,
  },
  label: {
    color: "rgba(255,255,255,0.9)",
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 13,
    marginBottom: 8,
  },
  field: {
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 11 : 10,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    backgroundColor: "transparent",
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    borderRadius: 14,
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 4,
  },
  showPwd: {
    color: MMD_DRIVER_LINK,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
  forgotRow: {
    alignItems: "flex-end",
    marginBottom: 8,
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: MMD_DRIVER_FIELD_TINT,
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: MMD_BLUE,
    borderWidth: 1,
    borderColor: "#0037A0",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarInitials: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 20,
  },
  addPhotoBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: MMD_BLUE,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  addPhotoText: {
    color: MMD_TEXT_SOFT_BLUE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 16,
  },
  sectionTitle: {
    color: "#E5E7EB",
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 16,
  },
  pill: {
    flex: 1,
    minHeight: 38,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: MMD_BLUE,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  pillActive: {
    backgroundColor: "#1D4ED8",
  },
  pillText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
    textAlign: "center",
  },
  primaryBtn: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: MMD_DRIVER_CTA,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  primaryBtnText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
  },
  ghostBtn: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: MMD_DRIVER_FIELD_TINT,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  ghostBtnText: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
  },
  hintMuted: {
    color: "rgba(255,255,255,0.9)",
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
    lineHeight: 18,
    marginTop: 2,
  },
  hintSoft: {
    color: "rgba(200,215,245,0.7)",
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
    lineHeight: 18,
  },
  errorText: {
    color: "#FCA5A5",
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    marginBottom: 8,
  },
  footer: {
    color: "#FF3333",
    marginTop: 10,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 12,
  },
});

export default DriverAuthScreen;