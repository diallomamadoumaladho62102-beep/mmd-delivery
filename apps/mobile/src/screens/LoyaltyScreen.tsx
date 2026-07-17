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
  const fallbackRoute = params.role === "driver" ? "DriverTabs" : "ClientHome";

  const [summary, setSummary] = useState<LoyaltySummary | null>(null);
  const [points, setPoints] = useState<LoyaltyPointsEntry[]>([]);
  const [credit, setCredit] = useState<LoyaltyCreditEntry[]>([]);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referralCounts, setReferralCounts] = useState({ total: 0, rewarded: 0, pending: 0 });
  const [codeInput, setCodeInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, historyRes, referralRes] = await Promise.all([
        fetchLoyaltySummary(),
        fetchLoyaltyHistory(),
        fetchLoyaltyReferral(),
      ]);
      setSummary(summaryRes);
      setPoints(historyRes.points);
      setCredit(historyRes.credit);
      setReferralCode(referralRes.code);
      setReferralLink(referralRes.link);
      setReferralCounts(referralRes.counts);
    } catch (e: unknown) {
      Alert.alert(
        t("loyalty.title", "Fidélité MMD"),
        toUserFacingError(e, t("loyalty.loadFailed", "Chargement impossible.")),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

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

  const handleConvert = useCallback(async () => {
    if (!summary || !canConvert) return;
    setConverting(true);
    try {
      const { summary: next } = await convertLoyaltyPoints(1);
      setSummary(next);
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
  }, [summary, canConvert, load, t]);

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
        {loading || !summary ? (
          <ActivityIndicator color={COLORS.accent} />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.muted}>{t("loyalty.balance", "Points")}</Text>
              <Text style={styles.bigValue}>{summary.points_balance} pts</Text>
              <Text style={styles.soft}>
                {t("loyalty.tierLine", "Niveau {{tier}} • Cumul {{lifetime}} pts", {
                  tier: summary.tier_label,
                  lifetime: summary.lifetime_points,
                })}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.muted}>{t("loyalty.credit", "Crédit MMD")}</Text>
              <Text style={styles.bigValue}>
                {formatCredit(summary.credit_cents, summary.currency)}
              </Text>
              <Text style={styles.soft}>
                {t(
                  "loyalty.conversionRate",
                  "{{points}} pts = {{amount}}",
                  {
                    points: summary.settings.conversion_points,
                    amount: formatCredit(
                      summary.settings.conversion_credit_cents,
                      summary.currency,
                    ),
                  },
                )}
              </Text>
              <TouchableOpacity
                style={[styles.primaryBtn, (!canConvert || converting) && styles.btnDisabled]}
                disabled={!canConvert || converting}
                onPress={handleConvert}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryBtnText}>
                  {converting
                    ? t("loyalty.converting", "Conversion…")
                    : t("loyalty.convert", "Convertir mes points")}
                </Text>
              </TouchableOpacity>
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

            <Text style={styles.sectionTitle}>{t("loyalty.history", "Historique")}</Text>
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
  muted: { color: COLORS.textMuted },
  soft: { color: COLORS.textSoft, marginTop: 4 },
  bigValue: { color: COLORS.textStrong, fontSize: 30, fontWeight: "800" },
  code: {
    color: COLORS.gold,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 2,
  },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: "#0B1220", fontWeight: "800" },
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
