import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Share,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { textAlignStart } from "../i18n/rtl";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { toUserFacingError } from "../lib/userFacingError";
import {
  applyReferralCode,
  convertLoyaltyPoints,
  fetchLoyaltyHistory,
  fetchLoyaltyReferral,
  fetchLoyaltySummary,
  type LoyaltyCreditEntry,
  type LoyaltyPointsEntry,
  type LoyaltySummary,
} from "../lib/loyaltyApi";
import {
  MMD_BLUE,
  MMD_CARD_ON_BLUE_STRONG,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_GREEN,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_TEXT_SOFT_BLUE,
  MMD_WHITE,
} from "../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "LoyaltyHub">;

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

const COLORS = {
  bg: MMD_BLUE,
  surface: MMD_CARD_ON_BLUE_STRONG,
  border: MMD_STROKE,
  accent: "#A78BFA",
  gold: MMD_GOLD_CLASSIC,
  textStrong: MMD_TEXT,
  textMuted: MMD_TEXT_MUTED_BLUE,
  textSoft: MMD_TEXT_SOFT_BLUE,
  green: MMD_GREEN,
  progressTrack: "#0037A0",
};

function formatCredit(cents: number, currency: string): string {
  return `${(Math.max(0, cents) / 100).toFixed(2)} ${currency}`;
}

export default function LoyaltyScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute();
  const { t } = useTranslation();
  const params = (route.params ?? {}) as { role?: "client" | "driver" };
  const role: "client" | "driver" = params.role === "driver" ? "driver" : "client";
  const fallbackRoute = role === "driver" ? "DriverTabs" : "ClientHome";

  const [summary, setSummary] = useState<LoyaltySummary | null>(null);
  const [points, setPoints] = useState<LoyaltyPointsEntry[]>([]);
  const [credit, setCredit] = useState<LoyaltyCreditEntry[]>([]);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referralCounts, setReferralCounts] = useState({ total: 0, rewarded: 0, pending: 0 });
  const [codeInput, setCodeInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [lastConvertOk, setLastConvertOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [summaryRes, historyRes, referralRes] = await Promise.all([
        fetchLoyaltySummary(role),
        fetchLoyaltyHistory(role),
        fetchLoyaltyReferral(role),
      ]);
      setSummary(summaryRes);
      setPoints(historyRes.points);
      setCredit(historyRes.credit);
      setReferralCode(referralRes.code);
      setReferralLink(referralRes.link);
      setReferralCounts(referralRes.counts);
    } catch (e: unknown) {
      const msg = toUserFacingError(
        e,
        t("loyalty.loadFailed", "Chargement impossible."),
      );
      setLoadError(msg);
      Alert.alert(t("loyalty.title", "Fidélité MMD"), msg);
    } finally {
      setLoading(false);
    }
  }, [t, role]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const canConvert =
    !!summary &&
    summary.settings.enabled &&
    summary.points_balance >= summary.settings.conversion_points;

  const doConvert = useCallback(async () => {
    if (!summary || !canConvert || converting) return;
    setConverting(true);
    try {
      const { summary: next } = await convertLoyaltyPoints(1, role);
      setSummary(next);
      setLastConvertOk(true);
      await load();
      Alert.alert(
        t("loyalty.title", "Fidélité MMD"),
        t("loyalty.convertSuccess", "Conversion réussie. Votre Crédit MMD a été ajouté."),
      );
    } catch (e: unknown) {
      Alert.alert(
        t("loyalty.title", "Fidélité MMD"),
        toUserFacingError(e, t("loyalty.convertFailed", "Conversion impossible.")),
      );
    } finally {
      setConverting(false);
    }
  }, [summary, canConvert, converting, load, t, role]);

  const handleConvert = useCallback(() => {
    if (!summary || !canConvert || converting) return;
    // Confirmation before an irreversible points -> credit conversion.
    Alert.alert(
      t("loyalty.confirmTitle", "Convertir mes points"),
      t(
        "loyalty.confirmMessage",
        "Convertir {{points}} points en {{amount}} de Crédit MMD ? Cette action est définitive.",
        {
          points: summary.settings.conversion_points,
          amount: formatCredit(summary.settings.conversion_credit_cents, summary.currency),
        },
      ),
      [
        { text: t("common.cancel", "Annuler"), style: "cancel" },
        { text: t("loyalty.confirm", "Confirmer"), onPress: () => void doConvert() },
      ],
    );
  }, [summary, canConvert, converting, doConvert, t]);

  const handleShare = useCallback(async () => {
    if (!referralLink) return;
    try {
      await Share.share({
        message: t(
          "loyalty.shareMessage",
          "Rejoignez MMD Delivery et gagnez des récompenses : {{link}}",
          { link: referralLink },
        ),
      });
    } catch {
      // user cancelled — ignore
    }
  }, [referralLink, t]);

  const handleApplyCode = useCallback(async () => {
    const code = codeInput.trim();
    if (!code) return;
    try {
      await applyReferralCode(code);
      setCodeInput("");
      Alert.alert(
        t("loyalty.title", "Fidélité MMD"),
        t("loyalty.codeApplied", "Code de parrainage enregistré."),
      );
      await load();
    } catch (e: unknown) {
      Alert.alert(
        t("loyalty.title", "Fidélité MMD"),
        toUserFacingError(e, t("loyalty.codeFailed", "Code invalide.")),
      );
    }
  }, [codeInput, load, t]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("loyalty.title", "MMD Loyalty")}
        fallbackRoute={fallbackRoute}
        variant="dark"
      />
      {loading ? (
        <View style={styles.stateWrap} testID="loyalty-loading">
          <ActivityIndicator color={MMD_GOLD_CLASSIC} />
          <Text style={styles.stateMuted}>{t("shared.common.loading", "Loading…")}</Text>
          <View style={styles.stateSpacer} />
          <Image
            source={MMD_LOGO}
            style={styles.footerLogo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.footerBrand}>MMD Delivery</Text>
        </View>
      ) : loadError || !summary ? (
        <View style={styles.stateWrap} testID="loyalty-error">
          <Text style={styles.errorTitle}>
            {t("loyalty.errorTitle", "Couldn’t load loyalty")}
          </Text>
          <Text style={styles.errorBody}>
            {loadError ??
              t("loyalty.errorBody", "Check your connection and try again.")}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryBtnText}>{t("common.retry", "Retry")}</Text>
          </TouchableOpacity>
          <View style={styles.stateSpacer} />
          <Image
            source={MMD_LOGO}
            style={styles.footerLogo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.footerBrand}>MMD Delivery</Text>
        </View>
      ) : (
      <ScrollView contentContainerStyle={styles.scroll}>
          <>
            <View style={styles.card} testID="loyalty-points-hero">
              <Text style={styles.muted}>{t("loyalty.balance", "Your points")}</Text>
              <Text style={styles.bigValue}>{summary.points_balance}</Text>
              <Text style={styles.valueLine}>
                {t("loyalty.pointsValue", "{{points}} points = {{amount}}", {
                  points: summary.settings.conversion_points,
                  amount: formatCredit(
                    summary.settings.conversion_credit_cents,
                    summary.currency,
                  ),
                })}
              </Text>
              <Text style={styles.soft}>
                {t("loyalty.creditBalance", "Credit available: {{amount}}", {
                  amount: formatCredit(
                    summary.available_credit_cents,
                    summary.currency,
                  ),
                })}
              </Text>
              <Text style={styles.soft}>
                {t("loyalty.tierLine", "{{tier}} member • {{lifetime}} lifetime pts", {
                  tier: summary.tier_label,
                  lifetime: summary.lifetime_points,
                })}
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.max(
                        0,
                        Math.min(100, Number(summary.tier_progress_pct ?? 0)),
                      )}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.soft}>
                {summary.next_tier
                  ? t(
                      "loyalty.tierProgress",
                      "{{remaining}} pts to {{next}}",
                      {
                        remaining: summary.points_to_next_tier ?? 0,
                        next: summary.next_tier.label,
                      },
                    )
                  : t("loyalty.tierMax", "Top tier reached")}
              </Text>
            </View>

            {role === "client" ? (
              <>
                <TouchableOpacity
                  style={[styles.card, styles.mmdPlusCard]}
                  onPress={() => navigation.navigate("MmdPlus")}
                  testID="loyalty-mmd-plus-entry"
                >
                  <Text style={styles.mmdPlusTitle}>MMD+</Text>
                  <Text style={styles.soft}>
                    {t(
                      "loyalty.mmdPlusCta",
                      "Subscription — Food, Delivery, Taxi & Marketplace perks",
                    )}
                  </Text>
                  <Text style={styles.linkCta}>
                    {t("loyalty.mmdPlusOpen", "Join / Manage subscription →")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.card}
                  onPress={() => navigation.navigate("Promotions")}
                >
                  <Text style={styles.muted}>Promotions</Text>
                  <Text style={styles.soft}>
                    {t(
                      "loyalty.promotionsCta",
                      "Promo codes, coupons and automatic offers",
                    )}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}

            <View style={styles.card} testID="loyalty-rewards">
              <Text style={styles.sectionInCard}>
                {t("loyalty.rewardsTitle", "Available rewards")}
              </Text>
              <View style={styles.rewardRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rewardTitle}>
                    {t("loyalty.rewardCredit", "MMD Credit")}
                  </Text>
                  <Text style={styles.soft}>
                    {t(
                      "loyalty.rewardCreditDesc",
                      "Convert {{points}} points into {{amount}} store credit",
                      {
                        points: summary.settings.conversion_points,
                        amount: formatCredit(
                          summary.settings.conversion_credit_cents,
                          summary.currency,
                        ),
                      },
                    )}
                  </Text>
                  <Text style={styles.soft}>
                    {t("loyalty.creditBalance", "Credit balance: {{amount}}", {
                      amount: formatCredit(summary.credit_cents, summary.currency),
                    })}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.rewardBtn, (!canConvert || converting) && styles.btnDisabled]}
                  disabled={!canConvert || converting}
                  onPress={handleConvert}
                  testID="loyalty-redeem"
                >
                  <Text style={styles.rewardBtnText}>
                    {converting
                      ? t("loyalty.converting", "…")
                      : canConvert
                        ? t("loyalty.redeem", "Redeem")
                        : t("loyalty.needMore", "Need more")}
                  </Text>
                </TouchableOpacity>
              </View>
              {lastConvertOk ? (
                <Text style={styles.convertOk} testID="loyalty-convert-done">
                  {t(
                    "loyalty.convertDone",
                    "Last conversion completed. Convert again only when you have enough points.",
                  )}
                </Text>
              ) : null}
              {summary.next_credit_expiry ? (
                <Text style={styles.soft}>
                  {t("loyalty.creditExpiry", "Credit expires {{date}}", {
                    date: new Date(summary.next_credit_expiry).toLocaleDateString(),
                  })}
                </Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.muted}>{t("loyalty.referral", "Parrainage")}</Text>
              {referralCode ? (
                <>
                  <Text style={styles.code}>{referralCode}</Text>
                  <Text style={styles.soft}>
                    {t("loyalty.referralCounts", "{{rewarded}} récompensés • {{pending}} en attente", {
                      rewarded: referralCounts.rewarded,
                      pending: referralCounts.pending,
                    })}
                  </Text>
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={handleShare}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.secondaryBtnText}>
                      {t("loyalty.share", "Inviter des amis")}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={styles.soft}>
                  {t("loyalty.referralPending", "Votre code sera bientôt disponible.")}
                </Text>
              )}

              <View style={styles.codeRow}>
                <TextInput
                  style={styles.input}
                  placeholder={t("loyalty.enterCode", "Entrer un code de parrainage")}
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="characters"
                  value={codeInput}
                  onChangeText={setCodeInput}
                />
                <TouchableOpacity
                  style={styles.applyBtn}
                  onPress={handleApplyCode}
                  activeOpacity={0.85}
                >
                  <Text style={styles.secondaryBtnText}>{t("loyalty.apply", "OK")}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.sectionTitle}>
              {t("loyalty.history", "Points history")}
            </Text>
            {points.length === 0 && credit.length === 0 ? (
              <Text style={styles.emptyText}>
                {t("loyalty.noActivity", "Aucune activité pour le moment.")}
              </Text>
            ) : (
              <>
                {points.map((entry) => (
                  <View key={`p-${entry.id}`} style={styles.listCard}>
                    <Text style={styles.listValue}>
                      {entry.delta_points > 0 ? "+" : ""}
                      {entry.delta_points} pts
                    </Text>
                    <Text style={styles.listLabel}>
                      {entry.description ?? entry.entry_type}
                    </Text>
                  </View>
                ))}
                {credit.map((entry) => (
                  <View key={`c-${entry.id}`} style={styles.listCard}>
                    <Text style={styles.listValue}>
                      {entry.delta_cents > 0 ? "+" : ""}
                      {formatCredit(Math.abs(entry.delta_cents), entry.currency)}
                    </Text>
                    <Text style={styles.listLabel}>
                      {entry.description ?? entry.entry_type}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </>
      </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 12 },
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 50,
    gap: 12,
  },
  stateMuted: {
    color: COLORS.textMuted,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  stateSpacer: { flex: 1, minHeight: 24, width: "100%" },
  footerLogo: { width: 50, height: 50, borderRadius: 25 },
  footerBrand: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  errorTitle: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 18,
    textAlign: "center",
  },
  errorBody: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
    textAlign: "center",
  },
  retryBtn: {
    backgroundColor: MMD_GOLD_CLASSIC,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  retryBtnText: {
    color: "#0037A0",
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  card: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    gap: 8,
  },
  mmdPlusCard: {},
  mmdPlusTitle: {
    color: COLORS.gold,
    fontWeight: "800",
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
  },
  linkCta: {
    color: COLORS.accent,
    fontWeight: "800",
    marginTop: 0,
    fontFamily: MMD_FONT.bold,
    fontSize: 13,
  },
  muted: {
    color: COLORS.textMuted,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  soft: {
    color: COLORS.textSoft,
    marginTop: 0,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  valueLine: {
    color: MMD_WHITE,
    fontWeight: "600",
    fontSize: 14,
    marginTop: 0,
    fontFamily: MMD_FONT.semibold,
  },
  bigValue: {
    color: COLORS.textStrong,
    fontSize: 36,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
  },
  progressTrack: {
    marginTop: 4,
    height: 8,
    borderRadius: 999,
    backgroundColor: COLORS.progressTrack,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: MMD_GOLD_CLASSIC,
    borderRadius: 999,
  },
  sectionInCard: {
    color: COLORS.textStrong,
    fontWeight: "800",
    fontSize: 15,
    marginBottom: 0,
    fontFamily: MMD_FONT.bold,
  },
  rewardRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 0 },
  rewardTitle: {
    color: COLORS.textStrong,
    fontWeight: "700",
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
  },
  rewardBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rewardBtnText: {
    color: MMD_BLUE,
    fontWeight: "800",
    fontSize: 13,
    fontFamily: MMD_FONT.bold,
  },
  convertOk: {
    color: "#86EFAC",
    fontWeight: "700",
    marginTop: 8,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
  },
  code: {
    color: MMD_WHITE,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 1,
    fontFamily: MMD_FONT.extrabold,
  },
  btnDisabled: { opacity: 0.4 },
  secondaryBtn: {
    marginTop: 0,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    backgroundColor: "#0037A0",
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "flex-start",
  },
  secondaryBtnText: {
    color: MMD_WHITE,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    fontSize: 14,
  },
  codeRow: { flexDirection: "row", gap: 8, marginTop: 0, alignItems: "center" },
  input: {
    flex: 1,
    height: 42,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: COLORS.textStrong,
    fontFamily: MMD_FONT.regular,
  },
  applyBtn: {
    borderRadius: 10,
    backgroundColor: "#0037A0",
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: "center",
  },
  sectionTitle: {
    color: MMD_WHITE,
    fontWeight: "700",
    marginTop: 4,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    textAlign: textAlignStart(),
  },
  emptyText: { color: MMD_TEXT_MUTED_BLUE, fontFamily: MMD_FONT.regular },
  listCard: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    gap: 4,
  },
  listValue: {
    color: MMD_WHITE,
    fontWeight: "700",
    fontSize: 15,
    fontFamily: MMD_FONT.bold,
  },
  listLabel: {
    color: COLORS.textMuted,
    marginTop: 0,
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
});
