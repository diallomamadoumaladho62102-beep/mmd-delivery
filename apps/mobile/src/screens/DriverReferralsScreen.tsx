// apps/mobile/src/screens/DriverReferralsScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  Share,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

function centsToUsd(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: "#0B1220",
        borderColor: "#111827",
        borderWidth: 1,
        borderRadius: 18,
        padding: 14,
      }}
    >
      {children}
    </View>
  );
}

function Button({
  label,
  onPress,
  kind = "primary",
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "ghost";
}) {
  const bg = kind === "primary" ? "#2563EB" : "#0B1220";
  const border = kind === "primary" ? "#2563EB" : "#111827";
  const color = kind === "primary" ? "white" : "#CBD5E1";
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingVertical: 12,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      <Text style={{ color, fontWeight: "900" }}>{label}</Text>
    </TouchableOpacity>
  );
}

type ReferralProgram = {
  id: string;
  duration_days: number;
  ride_goal: number;
  ride_reward_cents: number;
  delivery_goal: number;
  delivery_reward_cents: number;
  max_total_reward_cents: number;
};

export function DriverReferralsScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [program, setProgram] = useState<ReferralProgram | null>(null);

  const [myCode, setMyCode] = useState<string | null>(null);
  const [invitedCount, setInvitedCount] = useState(0);
  const [earnedCents, setEarnedCents] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);

  const shareText = useMemo(() => {
    const code = myCode ?? "—";
    // 👉 ton lien/DeepLink (à ajuster plus tard)
    const link = `https://mmd.app/r/${code}`;
    return t(
      "driver.referrals.shareText",
      "Join MMD Driver 🚗🍔\n\nMy code: {{code}}\nLink: {{link}}\n\nSign up and start driving!",
      { code, link }
    );
  }, [myCode, t]);

  const loadProgram = useCallback(async () => {
    const { data, error } = await supabase
      .from("referral_programs")
      .select(
        "id,duration_days,ride_goal,ride_reward_cents,delivery_goal,delivery_reward_cents,max_total_reward_cents"
      )
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.log("loadProgram error", error);
      return null;
    }
    return data as ReferralProgram | null;
  }, []);

  const ensureMyCode = useCallback(async (uid: string) => {
    // 1) read existing
    const { data: existing, error: e1 } = await supabase
      .from("referral_codes")
      .select("code")
      .eq("user_id", uid)
      .maybeSingle();
    if (!e1 && existing?.code) return String(existing.code);

    // 2) create new code (simple + unique)
    const raw = uid.replace(/-/g, "").slice(0, 8).toUpperCase();
    const code = `MMD${raw}`;

    const { error: e2 } = await supabase.from("referral_codes").upsert({ user_id: uid, code });
    if (e2) {
      console.log("ensureMyCode upsert error", e2);
      // fallback (UI)
      return code;
    }
    return code;
  }, []);

  const loadStats = useCallback(async (uid: string) => {
    // invited count
    const { count: invited, error: e1 } = await supabase
      .from("referral_invites")
      .select("*", { count: "exact", head: true })
      .eq("referrer_id", uid);

    if (e1) console.log("invited count error", e1);

    // earned sum
    const { data: ledger, error: e2 } = await supabase
      .from("referral_ledger")
      .select("amount_cents")
      .eq("referrer_id", uid)
      .limit(5000);

    if (e2) console.log("ledger error", e2);

    const sum = (ledger ?? []).reduce(
      (acc: number, r: any) => acc + (Number(r.amount_cents) || 0),
      0
    );

    setInvitedCount(invited ?? 0);
    setEarnedCents(sum);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);

      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) {
        setProgram(null);
        setMyCode(null);
        setInvitedCount(0);
        setEarnedCents(0);
        return;
      }

      const p = await loadProgram();
      setProgram(p);

      const code = await ensureMyCode(uid);
      setMyCode(code);

      await loadStats(uid);
    } finally {
      setLoading(false);
    }
  }, [ensureMyCode, loadProgram, loadStats]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onShare = useCallback(async () => {
    try {
      await Share.share(
        { message: shareText },
        Platform.OS === "ios"
          ? { subject: t("driver.referrals.shareSubject", "Invite MMD Driver") }
          : undefined
      );
    } catch (e) {
      console.log("share error", e);
      Alert.alert(
        t("common.errorTitle", "Error"),
        t("driver.referrals.shareError", "Unable to open sharing.")
      );
    }
  }, [shareText, t]);

  const headline = useMemo(() => {
    if (!program) return t("driver.referrals.headline.noProgram", "Invite your friends");
    // ✅ chiffres & durée différents d'Uber (depuis DB)
    return t("driver.referrals.headline.withProgram", "Up to {{amount}} in {{days}} days", {
      amount: centsToUsd(program.max_total_reward_cents),
      days: program.duration_days,
    });
  }, [program, t]);

  const rideLine = useMemo(() => {
    if (!program) return "—";
    return t("driver.referrals.rideLine", "{{amount}} for every {{goal}} rides", {
      amount: centsToUsd(program.ride_reward_cents),
      goal: program.ride_goal,
    });
  }, [program, t]);

  const deliveryLine = useMemo(() => {
    if (!program) return "—";
    return t("driver.referrals.deliveryLine", "{{amount}} for every {{goal}} deliveries", {
      amount: centsToUsd(program.delivery_reward_cents),
      goal: program.delivery_goal,
    });
  }, [program, t]);

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
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
            {t("common.back", "← Back")}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>
          {t("driver.referrals.header.title", "Refer friends")}
        </Text>

        <TouchableOpacity
          onPress={() =>
            Alert.alert(
              "Info",
              t("driver.referrals.header.info", "You can invite friends and earn rewards.")
            )
          }
        >
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>?</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
          <Text style={{ color: "#9CA3AF", marginTop: 10 }}>
            {t("common.loading", "Loading…")}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Top offer */}
          <Card>
            <Text style={{ color: "white", fontSize: 20, fontWeight: "900" }}>{headline}</Text>

            <Text
              style={{
                color: "#9CA3AF",
                fontWeight: "800",
                marginTop: 8,
                lineHeight: 20,
              }}
            >
              {program
                ? t(
                    "driver.referrals.validForDaysAfterFriendSignup",
                    "Valid for {{days}} days after your friend signs up.",
                    { days: program.duration_days }
                  )
                : t("driver.referrals.programLoading", "Loading program…")}
            </Text>

            <View style={{ height: 12 }} />

            <View style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={{ color: "white", fontWeight: "900" }}>
                  {t("driver.referrals.ridesLabel", "🚗 Rides")}
                </Text>
                <Text style={{ color: "#CBD5E1", fontWeight: "900" }}>{rideLine}</Text>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={{ color: "white", fontWeight: "900" }}>
                  {t("driver.referrals.deliveriesLabel", "🍔 Deliveries")}
                </Text>
                <Text style={{ color: "#CBD5E1", fontWeight: "900" }}>{deliveryLine}</Text>
              </View>
            </View>

            <View style={{ height: 14 }} />

            <Button
              label={t("driver.referrals.showAllRewards", "All rewards")}
              kind="ghost"
              onPress={() => setModalOpen(true)}
            />
          </Card>

          <View style={{ height: 14 }} />

          {/* Status */}
          <Text style={{ color: "white", fontSize: 18, fontWeight: "900", marginBottom: 10 }}>
            {t("driver.referrals.status.title", "Status")}
          </Text>

          <Card>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#111827",
                }}
              >
                <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                  {t("driver.referrals.status.invited", "Invited")}
                </Text>
                <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 6 }}>
                  {invitedCount}
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#111827",
                }}
              >
                <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                  {t("driver.referrals.status.earned", "You earned")}
                </Text>
                <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 6 }}>
                  {centsToUsd(earnedCents)}
                </Text>
              </View>
            </View>

            <View style={{ height: 12 }} />

            <Button
              label={t("driver.referrals.status.showInvites", "View invites")}
              kind="ghost"
              onPress={() =>
                Alert.alert(
                  t("common.soon", "Coming soon ✅"),
                  t("driver.referrals.status.invitesSoon", "We will add the detailed list next.")
                )
              }
            />

            <View style={{ height: 12 }} />

            <Text style={{ color: "#9CA3AF", fontWeight: "800", lineHeight: 20 }}>
              {t(
                "driver.referrals.status.friendHasDaysToComplete",
                "Your friend has {{days}} days to complete their goals after accepting your invite.",
                { days: program?.duration_days ?? "—" }
              )}
            </Text>
          </Card>

          <View style={{ height: 16 }} />

          {/* Code + Invite */}
          <Card>
            <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
              {t("driver.referrals.myCodeLabel", "Your code")}
            </Text>
            <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 6 }}>
              {myCode ?? "—"}
            </Text>
            <View style={{ height: 14 }} />
            <Button label={t("driver.referrals.inviteNow", "Invite")} onPress={onShare} />
          </Card>

          {/* Modal "All rewards" */}
          <Modal visible={modalOpen} animationType="slide" transparent>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.55)",
                justifyContent: "flex-end",
              }}
            >
              <View
                style={{
                  backgroundColor: "#020617",
                  borderTopLeftRadius: 18,
                  borderTopRightRadius: 18,
                  borderWidth: 1,
                  borderColor: "#111827",
                  padding: 16,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
                    {t("driver.referrals.modal.allRewardsTitle", "All rewards")}
                  </Text>
                  <TouchableOpacity onPress={() => setModalOpen(false)}>
                    <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
                      {t("shared.common.cancel", "Cancel")}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ height: 12 }} />

                <Card>
                  <Text style={{ color: "white", fontWeight: "900" }}>
                    {t("driver.referrals.modal.summaryTitle", "📌 Summary")}
                  </Text>
                  <Text
                    style={{
                      color: "#9CA3AF",
                      fontWeight: "800",
                      marginTop: 8,
                      lineHeight: 20,
                    }}
                  >
                    {program
                      ? t("driver.referrals.modal.summaryLine", "Max: {{max}} • Duration: {{days}} days", {
                          max: centsToUsd(program.max_total_reward_cents),
                          days: program.duration_days,
                        })
                      : "—"}
                  </Text>

                  <View style={{ height: 12 }} />

                  <Text style={{ color: "white", fontWeight: "900" }}>
                    {t("driver.referrals.ridesLabel", "🚗 Rides")}
                  </Text>
                  <Text style={{ color: "#CBD5E1", fontWeight: "900", marginTop: 6 }}>
                    {rideLine}
                  </Text>

                  <View style={{ height: 12 }} />

                  <Text style={{ color: "white", fontWeight: "900" }}>
                    {t("driver.referrals.deliveriesLabel", "🍔 Deliveries")}
                  </Text>
                  <Text style={{ color: "#CBD5E1", fontWeight: "900", marginTop: 6 }}>
                    {deliveryLine}
                  </Text>

                  <View style={{ height: 12 }} />

                  <Text style={{ color: "#9CA3AF", fontWeight: "800", lineHeight: 20 }}>
                    {t(
                      "driver.referrals.modal.rules",
                      "Rules: one invite = one friend. Rewards are capped at the maximum."
                    )}
                  </Text>
                </Card>

                <View style={{ height: 12 }} />
                <Button
                  label={t("driver.referrals.modal.inviteNow", "Invite now")}
                  onPress={() => {
                    setModalOpen(false);
                    onShare();
                  }}
                />
              </View>
            </View>
          </Modal>

          <Text style={{ color: "#6B7280", marginTop: 16, fontWeight: "700" }}>
            {t("driver.referrals.footer", "MMD Referral • Driver")}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
