/**
 * Driver Referrals — UI aligned to Figma 296:50 / 296:61 / 296:109.
 * Logic/APIs preserved (program, code, invites, ledger, share).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  Share,
  Platform,
  StyleSheet,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import ScreenHeader from "../components/navigation/ScreenHeader";
import DriverBrandLoadingState from "../components/driver/DriverBrandLoadingState";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");
const REFERRAL_WEB_BASE_URL = "https://mmddelivery.com";
const SOFT_BORDER = "rgba(255,255,255,0.1)";
const MUTED = "rgba(255,255,255,0.8)";

function centsToUsd(cents: number) {
  return `$${(Number(cents || 0) / 100).toFixed(0)}`;
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString([], {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function normalizeStatus(value: unknown) {
  return String(value ?? "pending").trim().toLowerCase();
}

function inviteStatusLabel(status: unknown) {
  const s = normalizeStatus(status);
  if (s === "completed" || s === "paid" || s === "rewarded") {
    return "✅ Reward earned";
  }
  if (s === "active" || s === "accepted") return "Active";
  if (s === "expired") return "Expired";
  if (s === "pending") return "Pending";
  return s.toUpperCase();
}

function inviteStatusColors(status: unknown) {
  const s = normalizeStatus(status);
  if (s === "completed" || s === "paid" || s === "rewarded") {
    return {
      bg: "rgba(34,197,94,0.12)",
      border: "rgba(34,197,94,0.28)",
      text: MMD_TAXI_GREEN,
    };
  }
  if (s === "active" || s === "accepted") {
    return {
      bg: "rgba(96,165,250,0.12)",
      border: "rgba(96,165,250,0.36)",
      text: "#BFDBFE",
    };
  }
  if (s === "expired") {
    return {
      bg: "rgba(248,113,113,0.12)",
      border: "rgba(248,113,113,0.3)",
      text: "#FECACA",
    };
  }
  return {
    bg: "rgba(245,158,11,0.12)",
    border: "rgba(245,158,11,0.28)",
    text: "#FBBF24",
  };
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

type InviteRow = {
  id: string;
  referrer_id?: string | null;
  referred_user_id?: string | null;
  referred_email?: string | null;
  referred_phone?: string | null;
  referred_name?: string | null;
  status?: string | null;
  created_at?: string | null;
  accepted_at?: string | null;
  completed_at?: string | null;
  expires_at?: string | null;
  rides_done?: number | null;
  deliveries_done?: number | null;
};

export function DriverReferralsScreen() {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [program, setProgram] = useState<ReferralProgram | null>(null);
  const [myCode, setMyCode] = useState<string | null>(null);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [earnedCents, setEarnedCents] = useState(0);
  const [rewardsModalOpen, setRewardsModalOpen] = useState(false);

  const invitedCount = invites.length;

  const referralLink = useMemo(() => {
    const code = myCode?.trim();
    if (!code) return `${REFERRAL_WEB_BASE_URL}/r/`;
    return `${REFERRAL_WEB_BASE_URL}/r/${encodeURIComponent(code)}`;
  }, [myCode]);

  const shareText = useMemo(() => {
    const code = myCode ?? "—";
    return t(
      "driver.referrals.shareText",
      "Join MMD Delivery 🚗🍔\n\nMy code: {{code}}\nLink: {{link}}\n\nSign up and start driving!",
      { code, link: referralLink },
    );
  }, [myCode, referralLink, t]);

  const loadProgram = useCallback(async () => {
    const { data, error } = await supabase
      .from("referral_programs")
      .select(
        "id,duration_days,ride_goal,ride_reward_cents,delivery_goal,delivery_reward_cents,max_total_reward_cents",
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
    const { data: existing, error: e1 } = await supabase
      .from("referral_codes")
      .select("code")
      .eq("user_id", uid)
      .maybeSingle();

    if (!e1 && existing?.code) return String(existing.code);

    const raw = uid.replace(/-/g, "").slice(0, 8).toUpperCase();
    const code = `MMD${raw}`;

    const { error: e2 } = await supabase
      .from("referral_codes")
      .upsert({ user_id: uid, code });

    if (e2) {
      console.log("ensureMyCode upsert error", e2);
      return code;
    }
    return code;
  }, []);

  const loadInvites = useCallback(async (uid: string) => {
    try {
      setLoadingInvites(true);
      const { data, error } = await supabase
        .from("referral_invites")
        .select("*")
        .eq("referrer_id", uid)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        console.log("referral_invites list error", error);
        setInvites([]);
        return;
      }
      setInvites((data ?? []) as InviteRow[]);
    } finally {
      setLoadingInvites(false);
    }
  }, []);

  const loadStats = useCallback(async (uid: string) => {
    const { data: ledger, error: e2 } = await supabase
      .from("referral_ledger")
      .select("amount_cents")
      .eq("referrer_id", uid)
      .limit(5000);

    if (e2) console.log("ledger error", e2);
    const sum = (ledger ?? []).reduce(
      (acc: number, r: any) => acc + (Number(r.amount_cents) || 0),
      0,
    );
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
        setInvites([]);
        setEarnedCents(0);
        return;
      }

      const p = await loadProgram();
      setProgram(p);
      const code = await ensureMyCode(uid);
      setMyCode(code);
      await Promise.all([loadInvites(uid), loadStats(uid)]);
    } finally {
      setLoading(false);
    }
  }, [ensureMyCode, loadInvites, loadProgram, loadStats]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const onShare = useCallback(async () => {
    if (!myCode) {
      Alert.alert(
        t("common.loading", "Loading…"),
        t("driver.referrals.codeLoading", "Your referral code is still loading."),
      );
      return;
    }
    try {
      await Share.share(
        { message: shareText, url: referralLink },
        Platform.OS === "ios"
          ? { subject: t("driver.referrals.shareSubject", "Invite MMD Driver") }
          : undefined,
      );
    } catch (e) {
      console.log("share error", e);
      Alert.alert(
        t("common.errorTitle", "Error"),
        t("driver.referrals.shareError", "Unable to open sharing."),
      );
    }
  }, [myCode, referralLink, shareText, t]);

  const headline = useMemo(() => {
    if (!program) {
      return t("driver.referrals.headline.noProgram", "Invite your friends");
    }
    return t(
      "driver.referrals.headline.withProgram",
      "Up to {{amount}} in {{days}} days",
      {
        amount: centsToUsd(program.max_total_reward_cents),
        days: program.duration_days,
      },
    );
  }, [program, t]);

  const rideLine = useMemo(() => {
    if (!program) return "—";
    return t(
      "driver.referrals.rideLineCompact",
      "🚗 Rides - {{amount}} for every {{goal}} rides",
      {
        amount: centsToUsd(program.ride_reward_cents),
        goal: program.ride_goal,
      },
    );
  }, [program, t]);

  const deliveryLine = useMemo(() => {
    if (!program) return "—";
    return t(
      "driver.referrals.deliveryLineCompact",
      "📦 Deliveries - {{amount}} for every {{goal}} deliveries",
      {
        amount: centsToUsd(program.delivery_reward_cents),
        goal: program.delivery_goal,
      },
    );
  }, [program, t]);

  function InviteCard({ invite }: { invite: InviteRow }) {
    const colors = inviteStatusColors(invite.status);
    const name =
      invite.referred_name ||
      invite.referred_email ||
      invite.referred_phone ||
      (invite.referred_user_id
        ? `#${invite.referred_user_id.slice(0, 8)}`
        : t("driver.referrals.invites.unknown", "Invited driver"));

    return (
      <View style={styles.inviteCard}>
        <View style={styles.inviteTopRow}>
          <View style={styles.inviteInfo}>
            <Text style={styles.inviteName} numberOfLines={1}>
              👤 {name}
            </Text>
            <Text style={styles.inviteMeta}>
              {t("driver.referrals.invites.invitedOn", "Invited")}:{" "}
              {formatDate(invite.created_at)}
            </Text>
          </View>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: colors.bg, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.statusText, { color: colors.text }]}>
              {inviteStatusLabel(invite.status)}
            </Text>
          </View>
        </View>
        <View style={styles.progressRow}>
          <View style={styles.progressBox}>
            <Text style={styles.progressLabel}>
              {t("driver.referrals.invites.rides", "Rides")}
            </Text>
            <Text style={styles.progressValue}>
              {Number(invite.rides_done ?? 0)}
            </Text>
          </View>
          <View style={styles.progressBox}>
            <Text style={styles.progressLabel}>
              {t("driver.referrals.invites.deliveries", "Deliveries")}
            </Text>
            <Text style={styles.progressValue}>
              {Number(invite.deliveries_done ?? 0)}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.referrals.header.title", "Refer friends")}
        subtitle={t(
          "driver.referrals.header.subtitle",
          "Invite drivers and earn",
        )}
        fallbackRoute="DriverTabs"
        variant="mmd"
      />

      {loading ? (
        <DriverBrandLoadingState
          title={t("common.loading", "Loading…")}
          logoAtBottom={false}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.heroLabel}>
              {t("driver.referrals.hero.label", "🎁 MMD Referral Program")}
            </Text>
            <Text style={styles.heroTitle}>{headline}</Text>
            <Text style={styles.heroSub}>
              {program
                ? t(
                    "driver.referrals.validForDaysAfterFriendSignup",
                    "Valid for {{days}} days after your friend signs up.",
                    { days: program.duration_days },
                  )
                : t("driver.referrals.programLoading", "Loading program…")}
            </Text>
            <View style={styles.rewardRows}>
              <View style={styles.rewardRow}>
                <Text style={styles.rewardText}>{rideLine}</Text>
              </View>
              <View style={styles.rewardRow}>
                <Text style={styles.rewardText}>{deliveryLine}</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => setRewardsModalOpen(true)}
              style={styles.ghostBtn}
              activeOpacity={0.85}
            >
              <Text style={styles.ghostBtnText}>
                {t("driver.referrals.showAllRewards", "All rewards")}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <View style={styles.statsRow}>
              <View style={styles.statCol}>
                <View style={styles.statCircle}>
                  <Text style={styles.statValue}>{invitedCount}</Text>
                </View>
                <Text style={styles.statLabel}>
                  {t("driver.referrals.status.invited", "Invited")}
                </Text>
              </View>
              <View style={styles.statCol}>
                <View
                  style={[
                    styles.statCircle,
                    earnedCents > 0 && styles.statCircleEarned,
                  ]}
                >
                  <Text
                    style={[
                      styles.statValue,
                      earnedCents > 0 && styles.statValueEarned,
                    ]}
                  >
                    {centsToUsd(earnedCents)}
                  </Text>
                </View>
                <Text style={styles.statLabel}>
                  {t("driver.referrals.status.earnedShort", "Earned")}
                </Text>
              </View>
            </View>
            <Text style={styles.statusNote}>
              {t(
                "driver.referrals.status.friendHasDaysToComplete",
                "Your friend has {{days}} days to complete their goals after accepting your invite.",
                { days: program?.duration_days ?? "—" },
              )}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.codeLabel}>
              {t("driver.referrals.myCodeLabel", "Your code")}
            </Text>
            <Text style={styles.codeText}>{myCode ?? "—"}</Text>
            <Text style={styles.linkLabel}>
              {t("driver.referrals.linkLabel", "Referral link")}
            </Text>
            <Text style={styles.linkText} numberOfLines={2}>
              {referralLink}
            </Text>
            <TouchableOpacity
              onPress={onShare}
              disabled={!myCode}
              style={[styles.inviteBtn, !myCode && styles.disabled]}
              activeOpacity={0.86}
            >
              <Text style={styles.inviteBtnText}>
                {t("driver.referrals.inviteNow", "Invite")}
              </Text>
            </TouchableOpacity>
          </View>

          {invites.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyTitle}>
                {t("driver.referrals.invites.emptyTitle", "No invites yet")}
              </Text>
              <Text style={styles.emptyText}>
                {t(
                  "driver.referrals.invites.emptyHint",
                  "Share your code to invite drivers.",
                )}
              </Text>
            </View>
          ) : (
            <View style={styles.invitesSection}>
              <Text style={styles.sectionTitle}>
                {t("driver.referrals.invites.title", "Invites")}
              </Text>
              <View style={styles.invitesStack}>
                {invites.map((invite) => (
                  <InviteCard key={invite.id} invite={invite} />
                ))}
              </View>
              {loadingInvites ? (
                <Text style={styles.refreshHint}>
                  {t("common.loading", "Loading…")}
                </Text>
              ) : (
                <TouchableOpacity
                  onPress={() => void loadAll()}
                  style={styles.ghostBtn}
                  activeOpacity={0.85}
                >
                  <Text style={styles.ghostBtnText}>
                    {t("shared.common.refresh", "Refresh")}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.footer}>
            <Image
              source={MMD_LOGO}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="MMD Delivery"
            />
            <Text style={styles.logoLabel}>MMD Delivery</Text>
          </View>

          <Modal
            visible={rewardsModalOpen}
            animationType="slide"
            transparent
            onRequestClose={() => setRewardsModalOpen(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalSheet}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    {t("driver.referrals.modal.allRewardsTitle", "All rewards")}
                  </Text>
                  <TouchableOpacity onPress={() => setRewardsModalOpen(false)}>
                    <Text style={styles.modalClose}>
                      {t("shared.common.cancel", "Cancel")}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.card}>
                  <Text style={styles.modalStrong}>
                    {t("driver.referrals.modal.summaryTitle", "📌 Summary")}
                  </Text>
                  <Text style={styles.modalText}>
                    {program
                      ? t(
                          "driver.referrals.modal.summaryLine",
                          "Max: {{max}} • Duration: {{days}} days",
                          {
                            max: centsToUsd(program.max_total_reward_cents),
                            days: program.duration_days,
                          },
                        )
                      : "—"}
                  </Text>
                  <Text style={[styles.modalStrong, { marginTop: 12 }]}>
                    {rideLine}
                  </Text>
                  <Text style={[styles.modalStrong, { marginTop: 8 }]}>
                    {deliveryLine}
                  </Text>
                  <Text style={styles.modalRules}>
                    {t(
                      "driver.referrals.modal.rules",
                      "Rules: one invite = one friend. Rewards are capped at the maximum. Rewards are applied after the referral program conditions are met.",
                    )}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setRewardsModalOpen(false);
                    void onShare();
                  }}
                  disabled={!myCode}
                  style={[styles.inviteBtn, !myCode && styles.disabled]}
                  activeOpacity={0.86}
                >
                  <Text style={styles.inviteBtnText}>
                    {t("driver.referrals.modal.inviteNow", "Invite now")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  content: { padding: 16, paddingBottom: 28, gap: 16 },
  card: {
    backgroundColor: MMD_ACTION_NAVY,
    borderWidth: 1,
    borderColor: SOFT_BORDER,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  heroLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  heroTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 24,
  },
  heroSub: {
    color: MUTED,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
  },
  rewardRows: { gap: 10 },
  rewardRow: {
    backgroundColor: "rgba(0,51,204,0.72)",
    borderRadius: 10,
    padding: 12,
  },
  rewardText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  ghostBtn: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: SOFT_BORDER,
    paddingVertical: 8,
  },
  ghostBtnText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
  },
  statsRow: { flexDirection: "row", gap: 16 },
  statCol: { flex: 1, alignItems: "center", gap: 8 },
  statCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(0,51,204,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  statCircleEarned: { backgroundColor: MMD_TAXI_GREEN },
  statValue: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 20,
  },
  statValueEarned: { color: MMD_BLUE },
  statLabel: {
    color: MUTED,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  statusNote: {
    color: MUTED,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 12,
    textAlign: "center",
  },
  codeLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  codeText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 24,
    letterSpacing: 1,
  },
  linkLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  linkText: {
    color: "#60A5FA",
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
  },
  inviteBtn: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  inviteBtnText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
  },
  disabled: { opacity: 0.55 },
  emptyCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderWidth: 1,
    borderColor: SOFT_BORDER,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    gap: 12,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 20,
    textAlign: "center",
  },
  emptyText: {
    color: MUTED,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
    textAlign: "center",
  },
  invitesSection: { gap: 12 },
  sectionTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 20,
  },
  invitesStack: { gap: 12 },
  inviteCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  inviteTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  inviteInfo: { flex: 1, paddingRight: 10, gap: 2 },
  inviteName: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 16,
  },
  inviteMeta: {
    color: MUTED,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 12,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusText: { fontSize: 11, fontFamily: MMD_FONT.bold, fontWeight: "700" },
  progressRow: { flexDirection: "row", gap: 12 },
  progressBox: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(0,51,204,0.72)",
    gap: 4,
  },
  progressLabel: {
    color: MUTED,
    fontSize: 11,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  progressValue: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  refreshHint: {
    color: MUTED,
    fontFamily: MMD_FONT.semibold,
    textAlign: "center",
  },
  footer: { alignItems: "center", paddingTop: 20, gap: 6 },
  logo: { width: 44, height: 44, borderRadius: 10 },
  logoLabel: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: MMD_BLUE,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 16,
    gap: 12,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: {
    color: MMD_WHITE,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  modalClose: {
    color: "#93C5FD",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  modalStrong: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  modalText: {
    color: MUTED,
    fontFamily: MMD_FONT.semibold,
    marginTop: 8,
    lineHeight: 20,
  },
  modalRules: {
    color: MUTED,
    fontFamily: MMD_FONT.semibold,
    marginTop: 12,
    lineHeight: 20,
  },
});

export default DriverReferralsScreen;
