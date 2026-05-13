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
  StyleSheet,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

const BG = "#020617";
const CARD = "rgba(15,23,42,0.78)";
const CARD_DEEP = "rgba(2,6,23,0.72)";
const BORDER = "rgba(148,163,184,0.14)";
const PURPLE = "#A78BFA";
const BLUE = "#60A5FA";
const GREEN = "#22C55E";
const TEXT = "#F8FAFC";
const MUTED = "#94A3B8";

const REFERRAL_WEB_BASE_URL = "https://mmddelivery.com";

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
    return "Reward earned";
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
      border: "rgba(34,197,94,0.3)",
      text: "#BBF7D0",
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
    bg: "rgba(167,139,250,0.12)",
    border: "rgba(167,139,250,0.28)",
    text: "#DDD6FE",
  };
}

function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "ghost" | "danger";
  disabled?: boolean;
}) {
  const isPrimary = kind === "primary";
  const isDanger = kind === "danger";

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        isPrimary && styles.buttonPrimary,
        kind === "ghost" && styles.buttonGhost,
        isDanger && styles.buttonDanger,
        disabled && styles.disabled,
      ]}
      activeOpacity={0.86}
    >
      <Text
        style={[
          styles.buttonText,
          isPrimary && styles.buttonTextPrimary,
          isDanger && styles.buttonTextDanger,
        ]}
      >
        {label}
      </Text>
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
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [program, setProgram] = useState<ReferralProgram | null>(null);

  const [myCode, setMyCode] = useState<string | null>(null);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [earnedCents, setEarnedCents] = useState(0);

  const [rewardsModalOpen, setRewardsModalOpen] = useState(false);
  const [invitesModalOpen, setInvitesModalOpen] = useState(false);

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
      { code, link: referralLink }
    );
  }, [myCode, referralLink, t]);

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
      0
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
        t("driver.referrals.codeLoading", "Your referral code is still loading.")
      );
      return;
    }

    try {
      await Share.share(
        { message: shareText, url: referralLink },
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
      }
    );
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
    return t(
      "driver.referrals.deliveryLine",
      "{{amount}} for every {{goal}} deliveries",
      {
        amount: centsToUsd(program.delivery_reward_cents),
        goal: program.delivery_goal,
      }
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

    const ridesDone = Number(invite.rides_done ?? 0);
    const deliveriesDone = Number(invite.deliveries_done ?? 0);

    return (
      <View style={styles.inviteCard}>
        <View style={styles.inviteTopRow}>
          <View style={styles.inviteInfo}>
            <Text style={styles.inviteName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.inviteMeta}>
              {t("driver.referrals.invites.invitedOn", "Invited")}: {formatDate(invite.created_at)}
            </Text>
            {invite.expires_at ? (
              <Text style={styles.inviteMeta}>
                {t("driver.referrals.invites.expires", "Expires")}: {formatDate(invite.expires_at)}
              </Text>
            ) : null}
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
            <Text style={styles.progressValue}>{ridesDone}</Text>
          </View>
          <View style={styles.progressBox}>
            <Text style={styles.progressLabel}>
              {t("driver.referrals.invites.deliveries", "Deliveries")}
            </Text>
            <Text style={styles.progressValue}>{deliveriesDone}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.roundButton}
          activeOpacity={0.85}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {t("driver.referrals.header.title", "Refer friends")}
          </Text>
          <Text style={styles.headerSub}>
            {t("driver.referrals.header.subtitle", "Invite drivers and earn")}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() =>
            Alert.alert(
              t("driver.referrals.header.infoTitle", "Info"),
              t(
                "driver.referrals.header.info",
                "Invite friends with your MMD link. When they sign up and complete the program goals, eligible rewards appear in your referral balance."
              )
            )
          }
          style={styles.roundButton}
          activeOpacity={0.85}
        >
          <Text style={styles.helpText}>?</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingFull}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.loadingText}>{t("common.loading", "Loading…")}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Card style={styles.heroCard}>
            <Text style={styles.heroLabel}>
              {t("driver.referrals.hero.label", "MMD referral program")}
            </Text>
            <Text style={styles.heroTitle}>{headline}</Text>
            <Text style={styles.heroSub}>
              {program
                ? t(
                    "driver.referrals.validForDaysAfterFriendSignup",
                    "Valid for {{days}} days after your friend signs up.",
                    { days: program.duration_days }
                  )
                : t("driver.referrals.programLoading", "Loading program…")}
            </Text>

            <View style={styles.rewardRows}>
              <View style={styles.rewardRow}>
                <Text style={styles.rewardTitle}>
                  {t("driver.referrals.ridesLabel", "🚗 Rides")}
                </Text>
                <Text style={styles.rewardValue}>{rideLine}</Text>
              </View>
              <View style={styles.rewardRow}>
                <Text style={styles.rewardTitle}>
                  {t("driver.referrals.deliveriesLabel", "🍔 Deliveries")}
                </Text>
                <Text style={styles.rewardValue}>{deliveryLine}</Text>
              </View>
            </View>

            <View style={styles.buttonGap} />
            <Button
              label={t("driver.referrals.showAllRewards", "All rewards")}
              kind="ghost"
              onPress={() => setRewardsModalOpen(true)}
            />
          </Card>

          <Text style={styles.sectionTitle}>
            {t("driver.referrals.status.title", "Status")}
          </Text>

          <Card>
            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>
                  {t("driver.referrals.status.invited", "Invited")}
                </Text>
                <Text style={styles.statValue}>{invitedCount}</Text>
              </View>

              <View style={styles.statBox}>
                <Text style={styles.statLabel}>
                  {t("driver.referrals.status.earned", "You earned")}
                </Text>
                <Text style={[styles.statValue, styles.earnedValue]}>
                  {centsToUsd(earnedCents)}
                </Text>
              </View>
            </View>

            <View style={styles.buttonGapSmall} />
            <Button
              label={t("driver.referrals.status.showInvites", "View invites")}
              kind="ghost"
              onPress={() => setInvitesModalOpen(true)}
            />

            <Text style={styles.statusNote}>
              {t(
                "driver.referrals.status.friendHasDaysToComplete",
                "Your friend has {{days}} days to complete their goals after accepting your invite.",
                { days: program?.duration_days ?? "—" }
              )}
            </Text>
          </Card>

          <Text style={styles.sectionTitle}>
            {t("driver.referrals.invite.title", "Invite")}
          </Text>

          <Card>
            <Text style={styles.codeLabel}>
              {t("driver.referrals.myCodeLabel", "Your code")}
            </Text>
            <Text style={styles.codeText}>{myCode ?? "—"}</Text>

            <Text style={styles.linkLabel}>
              {t("driver.referrals.linkLabel", "Referral link")}
            </Text>
            <Text style={styles.linkText} numberOfLines={1}>
              {referralLink}
            </Text>

            <View style={styles.buttonGap} />
            <Button
              label={t("driver.referrals.inviteNow", "Invite")}
              onPress={onShare}
              disabled={!myCode}
            />
          </Card>

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

                <Card>
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
                          }
                        )
                      : "—"}
                  </Text>

                  <Text style={[styles.modalStrong, styles.modalSectionGap]}>
                    {t("driver.referrals.ridesLabel", "🚗 Rides")}
                  </Text>
                  <Text style={styles.modalText}>{rideLine}</Text>

                  <Text style={[styles.modalStrong, styles.modalSectionGap]}>
                    {t("driver.referrals.deliveriesLabel", "🍔 Deliveries")}
                  </Text>
                  <Text style={styles.modalText}>{deliveryLine}</Text>

                  <Text style={styles.modalRules}>
                    {t(
                      "driver.referrals.modal.rules",
                      "Rules: one invite = one friend. Rewards are capped at the maximum. Rewards are applied after the referral program conditions are met."
                    )}
                  </Text>
                </Card>

                <View style={styles.buttonGapSmall} />
                <Button
                  label={t("driver.referrals.modal.inviteNow", "Invite now")}
                  onPress={() => {
                    setRewardsModalOpen(false);
                    void onShare();
                  }}
                  disabled={!myCode}
                />
              </View>
            </View>
          </Modal>

          <Modal
            visible={invitesModalOpen}
            animationType="slide"
            transparent
            onRequestClose={() => setInvitesModalOpen(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalSheetLarge}>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>
                      {t("driver.referrals.invites.title", "Invites")}
                    </Text>
                    <Text style={styles.modalSub}>
                      {invitedCount} {t("driver.referrals.invites.total", "total")}
                    </Text>
                  </View>

                  <TouchableOpacity onPress={() => setInvitesModalOpen(false)}>
                    <Text style={styles.modalClose}>
                      {t("shared.common.cancel", "Cancel")}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.buttonGapSmall} />
                <Button
                  label={t("shared.common.refresh", "Refresh")}
                  kind="ghost"
                  onPress={() => void loadAll()}
                  disabled={loadingInvites}
                />

                {loadingInvites ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.loadingText}>
                      {t("common.loading", "Loading…")}
                    </Text>
                  </View>
                ) : invites.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Text style={styles.emptyIcon}>◇</Text>
                    <Text style={styles.emptyText}>
                      {t("driver.referrals.invites.empty", "No invites yet.")}
                    </Text>
                  </View>
                ) : (
                  <ScrollView
                    style={styles.invitesList}
                    contentContainerStyle={styles.invitesListContent}
                    showsVerticalScrollIndicator={false}
                  >
                    <View style={styles.invitesStack}>
                      {invites.map((invite) => (
                        <InviteCard key={invite.id} invite={invite} />
                      ))}
                    </View>
                  </ScrollView>
                )}
              </View>
            </View>
          </Modal>

          <Text style={styles.footer}>
            {t("driver.referrals.footer", "MMD Referral • Driver")}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  headerRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CARD_DEEP,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: {
    color: "#BFDBFE",
    fontSize: 34,
    fontWeight: "700",
    marginTop: -2,
  },
  helpText: { color: PURPLE, fontWeight: "900", fontSize: 18 },
  headerCenter: { alignItems: "center", flex: 1, paddingHorizontal: 10 },
  headerTitle: { color: TEXT, fontSize: 17, fontWeight: "900" },
  headerSub: { color: MUTED, marginTop: 2, fontSize: 11, fontWeight: "800" },
  loadingFull: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingRow: { flexDirection: "row", alignItems: "center", marginTop: 14 },
  loadingText: { color: MUTED, marginLeft: 10, fontWeight: "800" },
  content: { padding: 16, paddingBottom: 28 },
  card: {
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
  },
  heroCard: {
    borderColor: "rgba(167,139,250,0.22)",
    shadowColor: "#8B5CF6",
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  heroLabel: { color: PURPLE, fontWeight: "900", fontSize: 12, marginBottom: 8 },
  heroTitle: { color: TEXT, fontSize: 24, fontWeight: "900" },
  heroSub: { color: MUTED, fontWeight: "800", marginTop: 8, lineHeight: 20 },
  rewardRows: { marginTop: 14, gap: 10 },
  rewardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderRadius: 16,
    backgroundColor: CARD_DEEP,
    borderWidth: 1,
    borderColor: BORDER,
  },
  rewardTitle: { color: TEXT, fontWeight: "900" },
  rewardValue: {
    color: "#CBD5E1",
    fontWeight: "900",
    flexShrink: 1,
    textAlign: "right",
  },
  button: {
    paddingVertical: 13,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  buttonPrimary: {
    backgroundColor: "rgba(139,92,246,0.95)",
    borderColor: "rgba(167,139,250,0.65)",
  },
  buttonGhost: { backgroundColor: CARD_DEEP, borderColor: BORDER },
  buttonDanger: {
    backgroundColor: "rgba(127,29,29,0.18)",
    borderColor: "rgba(248,113,113,0.3)",
  },
  buttonText: { color: TEXT, fontWeight: "900" },
  buttonTextPrimary: { color: "white" },
  buttonTextDanger: { color: "#FECACA" },
  disabled: { opacity: 0.55 },
  buttonGap: { height: 14 },
  buttonGapSmall: { height: 12 },
  sectionTitle: {
    color: TEXT,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 18,
    marginBottom: 10,
  },
  statsGrid: { flexDirection: "row", gap: 10 },
  statBox: {
    flex: 1,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_DEEP,
  },
  statLabel: { color: MUTED, fontWeight: "900", fontSize: 12 },
  statValue: { color: TEXT, fontSize: 24, fontWeight: "900", marginTop: 6 },
  earnedValue: { color: GREEN },
  statusNote: { color: MUTED, fontWeight: "800", lineHeight: 20, marginTop: 12 },
  codeLabel: { color: MUTED, fontWeight: "900" },
  codeText: {
    color: TEXT,
    fontSize: 24,
    fontWeight: "900",
    marginTop: 6,
    letterSpacing: 1,
  },
  linkLabel: { color: MUTED, fontWeight: "900", marginTop: 14 },
  linkText: { color: BLUE, fontWeight: "800", marginTop: 6 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: BG,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
  },
  modalSheetLarge: {
    maxHeight: "82%",
    backgroundColor: BG,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: { color: TEXT, fontSize: 20, fontWeight: "900" },
  modalSub: { color: MUTED, marginTop: 3, fontWeight: "800" },
  modalClose: { color: "#93C5FD", fontWeight: "900" },
  modalStrong: { color: TEXT, fontWeight: "900" },
  modalSectionGap: { marginTop: 12 },
  modalText: { color: "#CBD5E1", fontWeight: "800", marginTop: 8, lineHeight: 20 },
  modalRules: { color: MUTED, fontWeight: "800", marginTop: 12, lineHeight: 20 },
  inviteCard: {
    borderRadius: 20,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },
  inviteTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  inviteInfo: { flex: 1, paddingRight: 10 },
  inviteName: { color: TEXT, fontSize: 16, fontWeight: "900" },
  inviteMeta: { color: MUTED, marginTop: 5, fontSize: 12, fontWeight: "800" },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusText: { fontSize: 11, fontWeight: "900" },
  progressRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  progressBox: {
    flex: 1,
    padding: 10,
    borderRadius: 14,
    backgroundColor: CARD_DEEP,
    borderWidth: 1,
    borderColor: BORDER,
  },
  progressLabel: { color: MUTED, fontSize: 11, fontWeight: "900" },
  progressValue: { color: TEXT, fontSize: 18, fontWeight: "900", marginTop: 4 },
  emptyBox: {
    marginTop: 14,
    alignItems: "center",
    padding: 18,
    borderRadius: 20,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  emptyIcon: { color: PURPLE, fontSize: 24, fontWeight: "900", marginBottom: 6 },
  emptyText: { color: MUTED, fontWeight: "800", textAlign: "center" },
  invitesList: { marginTop: 12 },
  invitesListContent: { paddingBottom: 18 },
  invitesStack: { gap: 10 },
  footer: { color: "#6B7280", marginTop: 16, fontWeight: "700" },
});

export default DriverReferralsScreen;
