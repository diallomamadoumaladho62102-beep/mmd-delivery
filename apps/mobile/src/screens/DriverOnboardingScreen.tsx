// apps/mobile/src/screens/DriverOnboardingScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";

type TransportMode = "bike" | "car" | "moto";

export function DriverOnboardingScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // profiles
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  // driver_profiles
  const [transportMode, setTransportMode] = useState<TransportMode>("bike");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [color, setColor] = useState("");
  const [plate, setPlate] = useState("");

  const [vehicleVerified, setVehicleVerified] = useState(false);

  // ✅ Paiement: vérité Stripe (stripe_onboarded) plutôt que payout_enabled
  const [payoutEnabled, setPayoutEnabled] = useState(false);

  const [isOnline, setIsOnline] = useState(false);

  const needsVehicle = transportMode === "car" || transportMode === "moto";
  const isBikeMode = transportMode === "bike";

  function normalizePhone(p: string) {
    return String(p ?? "").replace(/[^\d+]/g, "").trim();
  }

  function parseYear(y: string) {
    const n = Number(String(y).trim());
    if (!Number.isFinite(n)) return null;
    const yy = Math.round(n);
    if (yy < 1900 || yy > 2100) return null;
    return yy;
  }

  async function ensureDriverProfileRow(uid: string) {
    // ✅ insert "safe" (si déjà existant => ignore via upsert)
    const payload: any = {
      id: uid,
      user_id: uid,
      transport_mode: "bike",
      is_online: false,
      total_deliveries: 0,
      acceptance_rate: 0,
      cancellation_rate: 0,
      vehicle_verified: false,

      payout_enabled: false,

      full_name: null,
      phone: null,
      vehicle_type: null,
      license_number: null,
      city: null,
      address: null,
      date_of_birth: null,
      vehicle_brand: null,
      vehicle_model: null,
      vehicle_year: null,
      vehicle_color: null,
      plate_number: null,
      rating: null,
      rating_count: null,

      stripe_account_id: null,
      stripe_onboarded: false,
    };

    const { error } = await supabase
      .from("driver_profiles")
      .upsert(payload, { onConflict: "id" });

    if (error) console.log("ensureDriverProfileRow upsert error:", error);
  }

  async function fetchDriverProfile(uid: string) {
    const { data, error } = await supabase
      .from("driver_profiles")
      .select(
        [
          "id",
          "user_id",
          "transport_mode",
          "vehicle_brand",
          "vehicle_model",
          "vehicle_year",
          "vehicle_color",
          "plate_number",
          "vehicle_verified",
          "payout_enabled",
          "is_online",
          "stripe_account_id",
          "stripe_onboarded",
          "documents_required",
        ].join(",")
      )
      .or(`user_id.eq.${uid},id.eq.${uid}`)
      .maybeSingle();

    return { data: (data ?? null) as any, error };
  }

  const resolvePayoutOk = useCallback((d: any) => {
    const stripeOnboarded =
      typeof d?.stripe_onboarded === "boolean" ? !!d.stripe_onboarded : null;

    // Stripe = source of truth, fallback payout_enabled
    return stripeOnboarded !== null ? stripeOnboarded : !!d?.payout_enabled;
  }, []);

  const refreshStripeAndReload = useCallback(
    async (uid: string) => {
      try {
        const { error: fnErr } = await supabase.functions.invoke(
          "check_connect_status",
          { body: {} }
        );
        if (fnErr) console.log("check_connect_status error:", fnErr);

        const { data: dp, error: dpErr } = await fetchDriverProfile(uid);
        if (dpErr) {
          console.log("driver_profiles reload after stripe error:", dpErr);
          return null;
        }
        return dp;
      } catch (e) {
        console.log("refreshStripeAndReload error:", e);
        return null;
      }
    },
    []
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const { data: authRes } = await supabase.auth.getUser();
      const user = authRes?.user;

      if (!user) {
        Alert.alert(
          t("driver.revenue.history.auth.title", "Login"),
          t("driver.home.errors.mustBeLoggedIn", "You must be logged in.")
        );
        navigation.goBack();
        return;
      }

      const uid = user.id;

      // 1) profiles
      const { data: p, error: pErr } = await supabase
        .from("profiles")
        .select("id, full_name, phone, role")
        .eq("id", uid)
        .maybeSingle();

      if (pErr) console.log("profiles load error:", pErr);
      if (p) {
        setFullName(p.full_name ?? "");
        setPhone(p.phone ?? "");
      }

      // 2) driver_profiles
      let { data: d, error: dErr } = await fetchDriverProfile(uid);
      if (dErr) console.log("driver_profiles load error:", dErr);

      if (!d) {
        await ensureDriverProfileRow(uid);
        const retry = await fetchDriverProfile(uid);
        d = retry.data;
      }

      if (d) {
        const tm: TransportMode = (d.transport_mode as TransportMode) || "bike";
        setTransportMode(tm);

        setBrand(d.vehicle_brand ?? "");
        setModel(d.vehicle_model ?? "");
        setYear(d.vehicle_year ? String(d.vehicle_year) : "");
        setColor(d.vehicle_color ?? "");
        setPlate(d.plate_number ?? "");

        setVehicleVerified(!!d.vehicle_verified);
        setPayoutEnabled(resolvePayoutOk(d));
        setIsOnline(!!d.is_online);
      }
    } finally {
      setLoading(false);
    }
  }, [navigation, resolvePayoutOk, t]);

  useEffect(() => {
    load();
  }, [load]);

  // ✅ Recharge à chaque focus (après Stripe/documents)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      (async () => {
        try {
          const { data: authRes } = await supabase.auth.getUser();
          const uid = authRes?.user?.id;
          if (!uid) return;

          const refreshed = await refreshStripeAndReload(uid);
          if (cancelled) return;

          if (refreshed) {
            setPayoutEnabled(resolvePayoutOk(refreshed));
            setVehicleVerified(!!refreshed?.vehicle_verified);
            setIsOnline(!!refreshed?.is_online);
          }
        } catch (e) {
          console.log("useFocusEffect refresh stripe error:", e);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [refreshStripeAndReload, resolvePayoutOk])
  );

  const checklist = useMemo(() => {
    const items: { key: string; label: string; done: boolean; hint?: string }[] = [];

    items.push({
      key: "name",
      label: t("common.profile.name", "Name"),
      done: !!fullName.trim(),
      hint: t("common.profile.placeholderName", "e.g. Mamadou"),
    });

    items.push({
      key: "phone",
      label: t("common.profile.phone", "Phone"),
      done: !!normalizePhone(phone),
      hint: t("client.auth.phoneRequired", "Phone is required"),
    });

    items.push({
      key: "transport",
      label: t("common.profile.transport", "Transport"),
      done: !!transportMode,
      hint: t("driver.auth.transport.title", "Choose Bike/Moto/Car"),
    });

    if (needsVehicle) {
      items.push({
        key: "vehicle",
        label: t("common.profile.vehicleSection", "Vehicle"),
        done: !!brand.trim() && !!model.trim() && !!parseYear(year) && !!plate.trim(),
        hint: t("common.profile.vehicleSection", "Brand, model, year, plate"),
      });
    }

    items.push({
      key: "docs",
      label: t("common.profile.documentsSection", "Documents"),
      done: isBikeMode ? true : vehicleVerified,
      hint: isBikeMode
        ? t("common.profile.bikeNoDocs", "Bike: no documents required ✅")
        : t("common.soon", "Coming soon ✅"),
    });

    items.push({
      key: "payout",
      label: t("common.profile.payment", "Payout"),
      done: payoutEnabled,
      hint: t(
        "common.profile.configureStripeHint",
        "Set up Stripe to enable earnings. (tap “Payout”)"
      ),
    });

    const doneCount = items.filter((x) => x.done).length;
    const percent = Math.round((doneCount / items.length) * 100);

    return { items, doneCount, total: items.length, percent };
  }, [
    brand,
    fullName,
    isBikeMode,
    model,
    needsVehicle,
    phone,
    plate,
    payoutEnabled,
    t,
    transportMode,
    vehicleVerified,
    year,
  ]);

  const firstMissing = useMemo(
    () => checklist.items.find((x) => !x.done)?.key ?? null,
    [checklist]
  );

  function goToFirstMissing() {
    if (!firstMissing) return;

    if (firstMissing === "docs") {
      Alert.alert(
        t("common.profile.documentsSection", "Documents"),
        isBikeMode
          ? t("common.profile.bikeNoDocs", "Bike: no documents required ✅")
          : t("common.soon", "Coming soon ✅")
      );
      return;
    }

    if (firstMissing === "payout") {
      Alert.alert(
        t("common.profile.payment", "Payout"),
        t(
          "common.profile.configureStripeHint",
          "Set up Stripe to enable earnings. (tap “Payout”)"
        )
      );
      return;
    }

    Alert.alert(
      t("common.ready", "Ready"),
      t("common.toAdd", "To add")
    );
  }

  function setMode(next: TransportMode) {
    setTransportMode(next);
    if (next === "bike") {
      setBrand("");
      setModel("");
      setYear("");
      setColor("");
      setPlate("");
    }
  }

  function buildMissingLines() {
    const missing = checklist.items.filter((x) => !x.done);
    if (!missing.length) return [t("common.ready", "Ready")];

    const lines = missing.map((m) => `• ${m.label}${m.hint ? ` — ${m.hint}` : ""}`);
    return Array.from(new Set(lines));
  }

  async function saveAll() {
    try {
      setSaving(true);

      const { data: authRes } = await supabase.auth.getUser();
      const user = authRes?.user;
      if (!user) return;
      const uid = user.id;

      const { error: pErr } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim() || null,
          phone: normalizePhone(phone) || null,
          role: "driver",
        })
        .eq("id", uid);

      if (pErr) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          t("common.profile.saveProfilesFailed", "Unable to save account (profiles).")
        );
        return;
      }

      const payload: any = {
        transport_mode: transportMode,
        full_name: fullName.trim() || null,
        phone: normalizePhone(phone) || null,
      };

      if (needsVehicle) {
        payload.vehicle_brand = brand.trim() || null;
        payload.vehicle_model = model.trim() || null;
        payload.vehicle_year = parseYear(year);
        payload.vehicle_color = color.trim() || null;
        payload.plate_number = plate.trim() || null;
      } else {
        payload.vehicle_brand = null;
        payload.vehicle_model = null;
        payload.vehicle_year = null;
        payload.vehicle_color = null;
        payload.plate_number = null;
      }

      const { error: dErr } = await supabase
        .from("driver_profiles")
        .update(payload)
        .or(`user_id.eq.${uid},id.eq.${uid}`);

      if (dErr) {
        console.log("driver_profiles update error:", dErr);
        Alert.alert(
          t("common.errorTitle", "Error"),
          t("common.profile.saveDriverProfilesFailed", "Unable to save (driver_profiles).")
        );
        return;
      }

      Alert.alert(t("common.ok", "OK"), t("common.profile.updated", "Profile updated ✅"));
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleOnline(next: boolean) {
    // ✅ Traductions + logique inchangée
    const allowed = isBikeMode
      ? checklist.percent >= 80
      : checklist.percent === 100 && vehicleVerified && payoutEnabled;

    if (next && !allowed) {
      Alert.alert(t("common.toAdd", "To add"), buildMissingLines().join("\n"));
      return;
    }

    try {
      setSaving(true);

      const { data: authRes } = await supabase.auth.getUser();
      const user = authRes?.user;
      if (!user) return;
      const uid = user.id;

      const { error } = await supabase
        .from("driver_profiles")
        .update({ is_online: next })
        .or(`user_id.eq.${uid},id.eq.${uid}`);

      if (error) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          t("driver.home.errors.toggleOnline", "Unable to change status.")
        );
        return;
      }

      const refreshed = await fetchDriverProfile(uid);
      if (refreshed.data) {
        setIsOnline(!!refreshed.data.is_online);
        setVehicleVerified(!!(refreshed.data as any).vehicle_verified);
        setPayoutEnabled(resolvePayoutOk(refreshed.data));
      } else {
        setIsOnline(next);
      }

      Alert.alert(
        t("common.ok", "OK"),
        next
          ? t("driver.map.statusOnlineTitle", "You are ONLINE — you can receive trips.")
          : t("driver.map.statusOfflineTitle", "You are offline.")
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
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator />
        <Text style={{ color: "#9CA3AF", marginTop: 10 }}>
          {t("common.loading", "Loading…")}
        </Text>
      </SafeAreaView>
    );
  }

  const transportLabel = (m: TransportMode) =>
    m === "bike"
      ? t("driver.auth.transport.bike", "Bike")
      : m === "moto"
      ? t("driver.auth.transport.moto", "Motorbike")
      : t("driver.auth.transport.car", "Car");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <View
        style={{
          padding: 16,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
            {t("common.back", "← Back")}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>
          {t("driver.account.title", "Driver account")}
        </Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* CARD: CHECKLIST / PROGRESSION */}
        <View
          style={{
            backgroundColor: "#0B1220",
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: "#111827",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "white", fontWeight: "900", fontSize: 18, flex: 1, paddingRight: 10 }}>
              {t("driver.account.subtitle", "Vehicle, documents, payout, guided status.")}
            </Text>

            <View
              style={{
                backgroundColor: "#071022",
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderWidth: 1,
                borderColor: "#111827",
              }}
            >
              <Text style={{ color: "#93C5FD", fontWeight: "900" }}>{checklist.percent}%</Text>
            </View>
          </View>

          <Text style={{ color: "#9CA3AF", marginTop: 8, fontWeight: "700" }}>
            {t("driver.accountScreen.subtitle", "Vehicle, documents, payout, status (guided).")}
          </Text>

          <View style={{ marginTop: 12, gap: 10 }}>
            {checklist.items.map((it) => (
              <View
                key={it.key}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: it.done ? "#D1FAE5" : "#FCA5A5", fontWeight: "900" }}>
                  {it.done ? "✅" : "❌"} {it.label}
                </Text>

                {!it.done && it.hint ? (
                  <Text style={{ color: "#9CA3AF", fontWeight: "700", flex: 1, textAlign: "right" }}>
                    {it.hint}
                  </Text>
                ) : (
                  <Text style={{ color: "#9CA3AF", fontWeight: "700" }}> </Text>
                )}
              </View>
            ))}
          </View>

          <TouchableOpacity
            onPress={goToFirstMissing}
            style={{ marginTop: 14, borderRadius: 12, padding: 12, backgroundColor: "#2563EB" }}
          >
            <Text style={{ color: "white", textAlign: "center", fontWeight: "900" }}>
              {t("driver.account.finalizeNow", "Finish now")}
            </Text>
          </TouchableOpacity>
        </View>

        {/* TRANSPORT */}
        <Text style={{ color: "white", fontWeight: "900", fontSize: 16, marginTop: 16 }}>
          {t("driver.auth.transport.title", "Transport")}
        </Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          {(["bike", "moto", "car"] as TransportMode[]).map((m) => {
            const active = transportMode === m;
            return (
              <TouchableOpacity
                key={m}
                onPress={() => setMode(m)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: active ? "#2563EB" : "#1F2937",
                  backgroundColor: active ? "#0A1730" : "#071022",
                }}
              >
                <Text style={{ color: "white", textAlign: "center", fontWeight: "900" }}>
                  {transportLabel(m)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* COMPTE */}
        <Text style={{ color: "white", fontWeight: "900", fontSize: 16, marginTop: 16 }}>
          {t("common.profile.accountSection", "Account")}
        </Text>

        <Text style={{ color: "#CBD5E1", marginTop: 10, fontWeight: "800" }}>
          {t("common.profile.name", "Name")}
        </Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          placeholder={t("common.profile.placeholderName", "e.g. Mamadou")}
          placeholderTextColor="#64748B"
          style={{
            color: "white",
            backgroundColor: "#071022",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#111827",
            padding: 12,
            marginTop: 6,
          }}
        />

        <Text style={{ color: "#CBD5E1", marginTop: 10, fontWeight: "800" }}>
          {t("common.profile.phone", "Phone")}
        </Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder={t("common.profile.placeholderPhone", "e.g. +1 555 123 4567")}
          placeholderTextColor="#64748B"
          style={{
            color: "white",
            backgroundColor: "#071022",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#111827",
            padding: 12,
            marginTop: 6,
          }}
        />

        {/* VEHICULE */}
        {needsVehicle ? (
          <>
            <Text style={{ color: "white", fontWeight: "900", fontSize: 16, marginTop: 18 }}>
              {t("common.profile.vehicleSection", "Vehicle")}
            </Text>

            <Text style={{ color: "#CBD5E1", marginTop: 10, fontWeight: "800" }}>
              {t("common.profile.brand", "Brand")}
            </Text>
            <TextInput
              value={brand}
              onChangeText={setBrand}
              placeholder={t("common.profile.placeholderBrand", "e.g. Honda")}
              placeholderTextColor="#64748B"
              style={{
                color: "white",
                backgroundColor: "#071022",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#111827",
                padding: 12,
                marginTop: 6,
              }}
            />

            <Text style={{ color: "#CBD5E1", marginTop: 10, fontWeight: "800" }}>
              {t("common.profile.model", "Model")}
            </Text>
            <TextInput
              value={model}
              onChangeText={setModel}
              placeholder={t("common.profile.placeholderModel", "e.g. Accord")}
              placeholderTextColor="#64748B"
              style={{
                color: "white",
                backgroundColor: "#071022",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#111827",
                padding: 12,
                marginTop: 6,
              }}
            />

            <Text style={{ color: "#CBD5E1", marginTop: 10, fontWeight: "800" }}>
              {t("common.profile.year", "Year")}
            </Text>
            <TextInput
              value={year}
              onChangeText={setYear}
              keyboardType="number-pad"
              placeholder={t("common.profile.placeholderYear", "2020")}
              placeholderTextColor="#64748B"
              style={{
                color: "white",
                backgroundColor: "#071022",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#111827",
                padding: 12,
                marginTop: 6,
              }}
            />

            <Text style={{ color: "#CBD5E1", marginTop: 10, fontWeight: "800" }}>
              {t("driver.auth.vehicle.colorOptional", "Color (optional)")}
            </Text>
            <TextInput
              value={color}
              onChangeText={setColor}
              placeholder={t("common.profile.placeholderColor", "e.g. Black")}
              placeholderTextColor="#64748B"
              style={{
                color: "white",
                backgroundColor: "#071022",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#111827",
                padding: 12,
                marginTop: 6,
              }}
            />

            <Text style={{ color: "#CBD5E1", marginTop: 10, fontWeight: "800" }}>
              {t("common.profile.plate", "Plate")}
            </Text>
            <TextInput
              value={plate}
              onChangeText={setPlate}
              placeholder={t("common.profile.placeholderPlate", "ABC-1234")}
              placeholderTextColor="#64748B"
              style={{
                color: "white",
                backgroundColor: "#071022",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#111827",
                padding: 12,
                marginTop: 6,
              }}
            />
          </>
        ) : (
          <View
            style={{
              marginTop: 14,
              backgroundColor: "#0B1220",
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "#111827",
              padding: 12,
            }}
          >
            <Text style={{ color: "#CBD5E1", fontWeight: "900" }}>
              {t("driver.accountScreen.bikeSelectedTitle", "Bike selected ✅")}
            </Text>
            <Text style={{ color: "#9CA3AF", marginTop: 6, fontWeight: "700" }}>
              {t(
                "driver.accountScreen.bikeSelectedBody",
                "No license, plate, insurance or registration required."
              )}
            </Text>
          </View>
        )}

        {/* STATUT */}
        <View
          style={{
            marginTop: 16,
            backgroundColor: "#0B1220",
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: "#111827",
          }}
        >
          <Text style={{ color: "white", fontWeight: "900", fontSize: 16 }}>
            {t("common.profile.status", "Status")}
          </Text>

          <Text style={{ color: "#9CA3AF", marginTop: 10, fontWeight: "800" }}>
            {t("common.profile.documentsSection", "Documents")}:{" "}
            {isBikeMode
              ? t("common.profile.bikeNoDocs", "Bike: no documents required ✅")
              : vehicleVerified
              ? t("common.profile.verified.complete", "All documents ✅")
              : t("common.profile.docs.uploading", "…")}
          </Text>

          <Text style={{ color: "#9CA3AF", marginTop: 6, fontWeight: "800" }}>
            {t("common.profile.payment", "Payout")}:{" "}
            {payoutEnabled
              ? t("common.ready", "Ready")
              : t("common.notConfigured", "Not configured")}
          </Text>

          <Text style={{ color: "#9CA3AF", marginTop: 6, fontWeight: "800" }}>
            {t("driver.map.statusTitle", "Driver status")}:{" "}
            {isOnline ? t("driver.map.online", "ONLINE") : t("driver.map.offline", "OFFLINE")}
          </Text>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <TouchableOpacity
              onPress={() => toggleOnline(!isOnline)}
              disabled={saving}
              style={{
                flex: 1,
                borderRadius: 12,
                padding: 12,
                backgroundColor: isOnline ? "#DC2626" : "#16A34A",
                opacity: saving ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "white", textAlign: "center", fontWeight: "900" }}>
                {isOnline ? t("driver.map.goOffline", "Go offline") : t("driver.home.online", "ONLINE")}
              </Text>
            </TouchableOpacity>
          </View>

          {__DEV__ ? (
            <Text style={{ color: "#64748B", marginTop: 10, fontWeight: "700" }}>
              Debug: vehicle_verified={String(vehicleVerified)} • payout_enabled={String(payoutEnabled)} •
              is_online={String(isOnline)}
            </Text>
          ) : null}
        </View>

        <View style={{ height: 18 }} />

        <TouchableOpacity
          onPress={saveAll}
          disabled={saving}
          style={{
            borderRadius: 12,
            padding: 12,
            backgroundColor: "#2563EB",
            opacity: saving ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "white", textAlign: "center", fontWeight: "900" }}>
            {saving ? t("shared.common.loadingEllipsis", "…") : t("shared.common.save", "Save")}
          </Text>
        </TouchableOpacity>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
