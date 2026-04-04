// apps/mobile/src/screens/DriverAuthScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
  ActionSheetIOS,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import * as Linking from "expo-linking";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "../lib/supabase";

type TransportMode = "bike" | "moto" | "car";

function extractReferralCode(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = Linking.parse(url);
    const code = (parsed.queryParams?.code as string | undefined) ?? null;
    return code ? String(code).trim() : null;
  } catch {
    return null;
  }
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        backgroundColor: "#0B1220",
        borderColor: "#111827",
        borderWidth: 1,
        borderRadius: 18,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
        {title}
      </Text>
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
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#475569"
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        autoCorrect={false}
        style={{
          marginTop: 8,
          paddingHorizontal: 12,
          paddingVertical: Platform.OS === "ios" ? 12 : 10,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: "#111827",
          color: "white",
          backgroundColor: "#0B1220",
        }}
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
      style={{
        paddingVertical: 12,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: disabled ? "#111827" : "#2563EB",
      }}
    >
      <Text style={{ color: "white", fontWeight: "900" }}>{label}</Text>
    </TouchableOpacity>
  );
}

function GhostButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingVertical: 12,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0B1220",
        borderWidth: 1,
        borderColor: "#111827",
      }}
    >
      <Text style={{ color: "#CBD5E1", fontWeight: "900" }}>{label}</Text>
    </TouchableOpacity>
  );
}

function LinkButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <Text style={{ color: "#93C5FD", fontWeight: "900" }}>{label}</Text>
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
      style={{
        flex: 1,
        paddingVertical: 10,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? "#1D4ED8" : "#0B1220",
        borderWidth: 1,
        borderColor: active ? "rgba(147,197,253,0.6)" : "#111827",
      }}
      activeOpacity={0.85}
    >
      <Text style={{ color: "white", fontWeight: "900" }}>{label}</Text>
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

function initialsFromName(name: string) {
  const t = name.trim();
  if (!t) return "D";
  const parts = t.split(" ").filter(Boolean);
  const a = parts[0]?.[0] ?? "D";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (a + b).toUpperCase();
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

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = decodeBase64(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export function DriverAuthScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [referralCode, setReferralCode] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [transportMode, setTransportMode] = useState<TransportMode>("car");

  const [vehicleBrand, setVehicleBrand] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [plateNumber, setPlateNumber] = useState("");

  const [avatarLocalUri, setAvatarLocalUri] = useState<string | null>(null);

  const isBike = transportMode === "bike";
  const needsVehicle = transportMode === "car" || transportMode === "moto";

  const canSubmit = useMemo(() => {
    const e = email.trim();
    const p = password.trim();

    if (!e || !p) return false;
    if (p.length < 6) return false;

    if (mode === "signup") {
      if (!fullName.trim()) return false;
      if (!phone.trim()) return false;

      if (!isValidYear(vehicleYear)) return false;

      if (needsVehicle) {
        if (!vehicleBrand.trim()) return false;
        if (!vehicleModel.trim()) return false;
        if (!plateNumber.trim()) return false;
      }
    }

    return true;
  }, [
    email,
    password,
    mode,
    fullName,
    phone,
    vehicleBrand,
    vehicleModel,
    vehicleYear,
    plateNumber,
    needsVehicle,
  ]);

  useEffect(() => {
    const run = async () => {
      const initialUrl = await Linking.getInitialURL();
      const code = extractReferralCode(initialUrl);
      if (code) setReferralCode(code);
    };

    void run();

    const sub = Linking.addEventListener("url", (event) => {
      const code = extractReferralCode(event.url);
      if (code) setReferralCode(code);
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
      .select("user_id")
      .eq("user_id", uid)
      .maybeSingle();

    if (error) {
      console.log("driver_profiles check error", error);
      navigation.replace("DriverHome");
      return;
    }

    if ((prof as { user_id?: string } | null)?.user_id) {
      navigation.replace("DriverHome");
    } else {
      navigation.replace("DriverOnboarding");
    }
  }, [navigation]);

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
    try {
      setLoading(true);

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });

      if (error) {
        Alert.alert(t("driver.auth.alert.loginFailedTitle"), error.message);
        return;
      }

      await applyReferralIfAny();
      await routeAfterAuth();
    } finally {
      setLoading(false);
    }
  }, [email, password, routeAfterAuth, applyReferralIfAny, t]);

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
    async (uid: string) => {
      if (!avatarLocalUri) return;

      try {
        const path = `${uid}/avatar/${Date.now()}.jpg`;

        const base64 = await FileSystem.readAsStringAsync(avatarLocalUri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const bytes = base64ToUint8Array(base64);

        const { error: upErr } = await supabase.storage
          .from("driver-documents")
          .upload(path, bytes, {
            contentType: "image/jpeg",
            upsert: true,
          });

        if (upErr) {
          console.log("avatar upload error", upErr);
          return;
        }

        const { error: metaErr } = await supabase.auth.updateUser({
          data: { avatar_path: path },
        });

        if (metaErr) console.log("updateUser avatar_path error", metaErr);
      } catch (e) {
        console.log("uploadAvatarIfAny error", e);
      }
    },
    [avatarLocalUri]
  );

  const onSignup = useCallback(async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password: password.trim(),
        options: {
          data: {
            full_name: fullName.trim() || null,
          },
        },
      });

      if (error) {
        Alert.alert(t("driver.auth.alert.signupFailedTitle"), error.message);
        return;
      }

      const user = data?.user;
      if (!user) {
        Alert.alert(
          t("driver.auth.alert.verifyEmailTitle"),
          t("driver.auth.alert.verifyEmailBody")
        );
        setMode("login");
        return;
      }

      const uid = user.id;

      await applyReferralIfAny();
      await uploadAvatarIfAny(uid);

      const { error: pErr } = await supabase.from("profiles").upsert(
        {
          id: uid,
          role: "livreur",
          full_name: fullName.trim() || null,
          phone: phone.trim() || null,
        },
        { onConflict: "id" }
      );

      if (pErr) console.log("profiles upsert error", pErr);

      const yearNum = vehicleYear.trim() ? Number(vehicleYear.trim()) : null;
      const safeYear =
        yearNum && Number.isFinite(yearNum) ? Math.round(yearNum) : null;

      const payload = {
        user_id: uid,
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        transport_mode: transportMode,
        vehicle_brand: isBike ? null : vehicleBrand.trim() || null,
        vehicle_model: isBike ? null : vehicleModel.trim() || null,
        vehicle_year: isBike ? null : safeYear,
        vehicle_color: isBike ? null : vehicleColor.trim() || null,
        plate_number: isBike ? null : plateNumber.trim() || null,
      };

      const { error: dErr } = await supabase
        .from("driver_profiles")
        .upsert(payload, { onConflict: "user_id" });

      if (dErr) console.log("driver_profiles upsert error", dErr);

      navigation.replace("DriverOnboarding");
    } finally {
      setLoading(false);
    }
  }, [
    applyReferralIfAny,
    email,
    password,
    fullName,
    phone,
    transportMode,
    vehicleBrand,
    vehicleModel,
    vehicleYear,
    vehicleColor,
    plateNumber,
    isBike,
    uploadAvatarIfAny,
    navigation,
    t,
  ]);

  useEffect(() => {
    if (transportMode === "bike") {
      setVehicleBrand("");
      setVehicleModel("");
      setVehicleYear("");
      setVehicleColor("");
      setPlateNumber("");
    }
  }, [transportMode]);

  const avatarBadgeText = useMemo(
    () => initialsFromName(fullName || "Driver"),
    [fullName]
  );

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
            {t("common.back")}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>
          {mode === "signup"
            ? t("driver.auth.header.signup")
            : t("driver.auth.header.login")}
        </Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        <Card
          title={
            mode === "signup"
              ? t("driver.auth.card.signupTitle")
              : t("driver.auth.card.loginTitle")
          }
        >
          {mode === "signup" ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 6,
                marginBottom: 6,
              }}
            >
              <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                {t("driver.auth.switch.haveAccount")}
              </Text>
              <LinkButton
                label={t("driver.auth.switch.relogin")}
                onPress={() => setMode("login")}
              />
            </View>
          ) : (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 6,
                marginBottom: 6,
              }}
            >
              <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
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

          <Input
            label={t("driver.auth.fields.password")}
            value={password}
            onChangeText={setPassword}
            placeholder={t("driver.auth.fields.passwordPlaceholder")}
            secureTextEntry
            autoCapitalize="none"
          />

          {mode === "signup" ? (
            <>
              <View style={{ height: 6 }} />
              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                {t("driver.auth.avatar.optional")}
              </Text>
              <View style={{ height: 10 }} />

              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 32,
                    backgroundColor: "#111827",
                    borderWidth: 1,
                    borderColor: "#1F2937",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    marginRight: 12,
                  }}
                >
                  {avatarLocalUri ? (
                    <Image
                      source={{ uri: avatarLocalUri }}
                      style={{ width: 64, height: 64 }}
                    />
                  ) : (
                    <Text
                      style={{
                        color: "white",
                        fontWeight: "900",
                        fontSize: 18,
                      }}
                    >
                      {avatarBadgeText}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  onPress={openAvatarMenu}
                  activeOpacity={0.85}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#0B1220",
                    borderWidth: 1,
                    borderColor: "#111827",
                  }}
                >
                  <Text style={{ color: "#CBD5E1", fontWeight: "900" }}>
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

              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
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
                  <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
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
                    <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>
                      {t("driver.auth.vehicle.invalidYear")}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text
                  style={{
                    color: "#9CA3AF",
                    fontWeight: "800",
                    lineHeight: 18,
                  }}
                >
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

              <Text
                style={{
                  color: "#9CA3AF",
                  fontWeight: "800",
                  marginTop: 2,
                  lineHeight: 18,
                }}
              >
                {t("driver.auth.referral.autoFillHint")}
              </Text>

              <View style={{ height: 12 }} />
              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                {t("driver.auth.documents.title")}
              </Text>
              <View style={{ height: 6 }} />

              {isBike ? (
                <Text style={{ color: "#64748B", fontWeight: "800" }}>
                  {t("driver.auth.documents.bikeNone")}
                </Text>
              ) : (
                <Text
                  style={{
                    color: "#64748B",
                    fontWeight: "800",
                    lineHeight: 18,
                  }}
                >
                  {t("driver.auth.documents.carHint")}
                </Text>
              )}
            </>
          ) : null}

          <View style={{ height: 14 }} />

          {loading ? (
            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 10,
              }}
            >
              <ActivityIndicator />
              <Text style={{ color: "#9CA3AF", marginTop: 10 }}>
                {t("driver.auth.loading")}
              </Text>
            </View>
          ) : (
            <>
              <PrimaryButton
                label={
                  mode === "signup"
                    ? t("driver.auth.actions.createMyAccount")
                    : t("driver.auth.actions.login")
                }
                onPress={mode === "signup" ? () => void onSignup() : () => void onLogin()}
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
            </>
          )}
        </Card>

        <Text style={{ color: "#6B7280", marginTop: 10, fontWeight: "700" }}>
          {t("driver.auth.footer")}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export default DriverAuthScreen;