import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

type Nav = NativeStackNavigationProp<RootStackParamList, "LoyaltyHub">;

const COLORS = {
  bg: "#0B1220",
  surface: "rgba(15,23,42,0.95)",
  border: "#334155",
  accent: "#A78BFA",
  gold: "#F59E0B",
  textStrong: "#F8FAFC",
  textMuted: "#94A3B8",
  textSoft: "#CBD5E1",
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
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={t("loyalty.title", "Fidélité MMD")}
        fallbackRoute={fallbackRoute}
        variant="dark"
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <ActivityIndicator color={COLORS.accent} testID="loyalty-loading" />
        ) : loadError || !summary ? (
          <View style={styles.card} testID="loyalty-error">
            <Text style={styles.soft}>
              {loadError ?? t("loyalty.loadFailed", "Chargement impossible.")}
            </Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => void load()}>
              <Text style={styles.secondaryBtnText}>
                {t("common.retry", "Retry")}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
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
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 20, gap: 14 },
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  mmdPlusCard: { borderColor: COLORS.gold },
  mmdPlusTitle: { color: COLORS.gold, fontWeight: "800", fontSize: 18 },
  linkCta: { color: COLORS.accent, fontWeight: "800", marginTop: 8 },
  muted: { color: COLORS.textMuted },
  soft: { color: COLORS.textSoft, marginTop: 4 },
  valueLine: {
    color: COLORS.gold,
    fontWeight: "800",
    fontSize: 15,
    marginTop: 2,
  },
  bigValue: { color: COLORS.textStrong, fontSize: 36, fontWeight: "800" },
  progressTrack: {
    marginTop: 12,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(148,163,184,0.2)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.accent,
    borderRadius: 999,
  },
  sectionInCard: {
    color: COLORS.textStrong,
    fontWeight: "800",
    fontSize: 16,
    marginBottom: 4,
  },
  rewardRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  rewardTitle: { color: COLORS.textStrong, fontWeight: "700", fontSize: 15 },
  rewardBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rewardBtnText: { color: "#0B1220", fontWeight: "800", fontSize: 12 },
  convertOk: { color: "#86EFAC", fontWeight: "700", marginTop: 8, fontSize: 12 },
  code: {
    color: COLORS.gold,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 2,
  },
  btnDisabled: { opacity: 0.4 },
  secondaryBtn: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.accent,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtnText: { color: COLORS.accent, fontWeight: "700" },
  codeRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.textStrong,
  },
  applyBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.accent,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  sectionTitle: {
    color: COLORS.textSoft,
    fontWeight: "700",
    marginTop: 8,
    textAlign: textAlignStart(),
  },
  emptyText: { color: "#64748B" },
  listCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  listValue: { color: "#E2E8F0", fontWeight: "700" },
  listLabel: { color: COLORS.textMuted, marginTop: 2 },
});
