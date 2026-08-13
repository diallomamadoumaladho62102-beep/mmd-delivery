/**
 * Driver Benefits — Figma 308:7037 Loading / 308:7060 Empty / 308:7088 Benefits.
 * Keeps get_driver_benefits + get_driver_challenges RPCs.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { DriverBrandLoadingState } from "../components/driver/DriverBrandLoadingState";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

type BoostKind = "boost" | "bonus" | "challenge";
type TabKey = "boosts" | "payout";

type BenefitItem = {
  id: string;
  kind: BoostKind;
  title: string;
  subtitle: string;
  badge: string;
  accent: "blue" | "green" | "amber" | "purple";
  active?: boolean;
  expiresAt?: string;
  progressPct?: number;
};

type BoostRow = {
  id: string;
  title: string;
  description: string | null;
  kind: "per_order" | "percent" | "time_window";
  value: number;
  starts_at: string | null;
  ends_at: string | null;
};

type BonusEventRow = {
  id: string;
  label: string;
  amount: number;
  order_id: string | null;
  occurred_at: string;
};

type ChallengeRow = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  goal_trips: number;
  reward_amount: number;
  trips_done: number;
  claimed: boolean;
  claimable: boolean;
};

type BenefitsRPCRow = {
  active_boosts: any;
  bonus_total: number | null;
  bonus_count: number | null;
  last_bonus_events: any;
  payout_total_estimated: number | null;
  challenges?: any;
};

function fmtDateShort(iso?: string | null, locale?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const loc = locale || "en-US";
  return d.toLocaleDateString(loc, { day: "2-digit", month: "short" });
}

function fmtMoneyUSD(v: number | null | undefined) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)} $`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeekMonday(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  return x;
}

function boostAccentFromKind(kind: BoostRow["kind"]): BenefitItem["accent"] {
  if (kind === "percent") return "blue";
  if (kind === "per_order") return "green";
  return "amber";
}

function localeForDate(lang?: string) {
  const l = String(lang || "").toLowerCase();
  if (l.startsWith("fr")) return "fr-FR";
  if (l.startsWith("es")) return "es-ES";
  if (l.startsWith("ar")) return "ar";
  if (l.startsWith("zh")) return "zh-CN";
  if (l.startsWith("ff")) return "ff";
  return "en-US";
}

const tf =
  (t: TFunction) =>
  (k: string, fb?: string, vars?: Record<string, any>) =>
    t(k, { defaultValue: fb ?? k, ...(vars ?? {}) });

type TSimple = (k: string, fb?: string) => string;

function boostBadgeFromKind(kind: BoostRow["kind"], t: TSimple) {
  if (kind === "percent") return t("driver.benefits.badge.boostPercent", "Boost %");
  if (kind === "per_order") return t("driver.benefits.badge.bonusDollar", "Bonus $");
  return t("driver.benefits.badge.boost", "Boost");
}

function boostSubtitle(b: BoostRow, t: TSimple) {
  const desc = (b.description ?? "").trim();
  if (desc) return desc;

  const v = Number(b.value ?? 0);

  if (b.kind === "percent") {
    const pct = Number.isFinite(v) ? v.toFixed(0) : "0";
    return t(
      "driver.benefits.boostSubtitle.percent",
      `Gagne +${pct}% sur ta part chauffeur.`,
    ).replace("{value}", pct);
  }

  if (b.kind === "per_order") {
    const money = Number.isFinite(v) ? v.toFixed(2) : "0.00";
    return t(
      "driver.benefits.boostSubtitle.perOrder",
      `Bonus ajouté : +${money} $ par course livrée.`,
    ).replace("{value}", money);
  }

  return t("driver.benefits.boostSubtitle.timeWindow", "Boost actif sur une période limitée.");
}

function BrandFooter() {
  return (
    <View style={styles.footer}>
      <Image
        source={MMD_LOGO}
        style={styles.footerLogo}
        resizeMode="contain"
        accessibilityLabel="MMD Delivery"
      />
      <Text style={styles.footerBrand}>MMD Delivery</Text>
    </View>
  );
}

function EmptySectionCard({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.emptySectionCard}>
      <Text style={styles.emptyEmoji}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.emptySectionTitle}>{title}</Text>
        <Text style={styles.emptySectionBody}>{body}</Text>
      </View>
    </View>
  );
}

export function DriverBenefitsScreen() {
  const { t, i18n } = useTranslation();
  const tt = useMemo(() => tf(t), [t]);
  const ts: TSimple = useMemo(() => (k, fb) => tt(k, fb), [tt]);

  const { fromISO, toISO, daysLabel } = useMemo(() => {
    const now = new Date();
    const from = startOfWeekMonday(now);
    const to = endOfDay(now);
    const loc = localeForDate(i18n.language);
    const fromTxt = from.toLocaleDateString(loc, { day: "2-digit", month: "short" });
    const toTxt = now.toLocaleDateString(loc, { day: "2-digit", month: "short" });
    return {
      fromISO: from.toISOString(),
      toISO: to.toISOString(),
      daysLabel: `${fromTxt} - ${toTxt}`,
    };
  }, [i18n.language]);

  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [tab, setTab] = useState<TabKey>("boosts");
  const [rpc, setRpc] = useState<BenefitsRPCRow | null>(null);
  const [activeBoostId, setActiveBoostId] = useState<string | null>(null);

  const fetchBenefits = useCallback(async () => {
    try {
      setLoading(true);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setRpc(null);
        setActiveBoostId(null);
        return;
      }

      const { data, error } = await supabase.rpc("get_driver_benefits", {
        from_ts: fromISO,
        to_ts: toISO,
      });

      if (error) {
        console.log("❌ get_driver_benefits error:", error);
        setRpc(null);
        setActiveBoostId(null);
        return;
      }

      const row: BenefitsRPCRow | null = Array.isArray(data)
        ? ((data[0] as BenefitsRPCRow | undefined) ?? null)
        : (data as BenefitsRPCRow | null);

      const { data: chData, error: chErr } = await supabase.rpc("get_driver_challenges", {
        from_ts: fromISO,
        to_ts: toISO,
      });

      if (chErr) {
        console.log("❌ get_driver_challenges error:", chErr);
      }

      const merged: BenefitsRPCRow | null = row
        ? ({
            ...row,
            challenges: chErr ? [] : chData,
          } as BenefitsRPCRow)
        : ({
            active_boosts: [],
            bonus_total: 0,
            bonus_count: 0,
            last_bonus_events: [],
            payout_total_estimated: 0,
            challenges: chErr ? [] : chData,
          } as BenefitsRPCRow);

      setRpc(merged);

      const boostsRaw = (merged as any)?.active_boosts;
      const boostsArr: BoostRow[] = Array.isArray(boostsRaw) ? boostsRaw : [];
      setActiveBoostId(boostsArr[0]?.id ?? null);
    } catch (e: any) {
      console.log("fetchBenefits error:", e);
      setRpc(null);
      setActiveBoostId(null);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [fromISO, toISO]);

  useEffect(() => {
    void fetchBenefits();
  }, [fetchBenefits]);

  const items: BenefitItem[] = useMemo(() => {
    const boostsRaw = (rpc as any)?.active_boosts;
    const boostsArr: BoostRow[] = Array.isArray(boostsRaw) ? boostsRaw : [];
    const bonusRaw = (rpc as any)?.last_bonus_events;
    const bonusArr: BonusEventRow[] = Array.isArray(bonusRaw) ? bonusRaw : [];
    const challengesRaw = (rpc as any)?.challenges;
    const challengesArr: ChallengeRow[] = Array.isArray(challengesRaw) ? challengesRaw : [];

    const boostItems: BenefitItem[] = boostsArr.map((b) => {
      // Time-window progress from real starts_at/ends_at — never invent a percent.
      let progressPct: number | undefined;
      if (b.id === activeBoostId && b.starts_at && b.ends_at) {
        const start = Date.parse(b.starts_at);
        const end = Date.parse(b.ends_at);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          progressPct = Math.min(
            100,
            Math.max(0, Math.round(((Date.now() - start) / (end - start)) * 100)),
          );
        }
      }
      return {
        id: b.id,
        kind: "boost" as const,
        title: b.title,
        subtitle: boostSubtitle(b, ts),
        badge:
          b.id === activeBoostId
            ? t("driver.benefits.badge.active", "Actif")
            : t("driver.benefits.badge.available", "Dispo"),
        accent: boostAccentFromKind(b.kind),
        active: b.id === activeBoostId,
        expiresAt: b.ends_at ?? undefined,
        progressPct,
      };
    });

    const bonusItems: BenefitItem[] = bonusArr.map((e) => ({
      id: e.id,
      kind: "bonus",
      title: e.label,
      subtitle: `+${fmtMoneyUSD(e.amount)} • ${fmtDateShort(
        e.occurred_at,
        localeForDate(i18n.language),
      )}`,
      badge: t("driver.benefits.badge.earned", "Gagné"),
      accent: "green",
    }));

    const challengeItems: BenefitItem[] = challengesArr.map((c) => {
      const badge = c.claimed
        ? t("driver.benefits.badge.claimed", "Réclamé")
        : c.claimable
          ? t("driver.benefits.badge.claim", "Réclamer")
          : t("driver.benefits.badge.inProgress", "En cours");

      const desc = (c.description ?? "").trim();
      const line1 = desc ? `${desc}\n` : "";
      const line2 = t("driver.benefits.challenge.progress", `Progression: {done}/{goal}`)
        .replace("{done}", String(Number(c.trips_done ?? 0)))
        .replace("{goal}", String(Number(c.goal_trips ?? 0)));
      const line3 = t("driver.benefits.challenge.reward", `Récompense: {amount}`).replace(
        "{amount}",
        fmtMoneyUSD(c.reward_amount),
      );
      const goal = Math.max(1, Number(c.goal_trips ?? 1));
      const done = Math.max(0, Number(c.trips_done ?? 0));
      const progressPct = Math.min(100, Math.round((done / goal) * 100));

      return {
        id: c.id,
        kind: "challenge",
        title: c.title,
        subtitle: `${line1}${line2} • ${line3}`,
        badge,
        accent: "purple",
        expiresAt: c.ends_at ?? undefined,
        progressPct,
      };
    });

    return [...boostItems, ...bonusItems, ...challengeItems];
  }, [rpc, activeBoostId, ts, t, i18n.language]);

  const active = items.filter((x) => x.kind === "boost" && x.id === activeBoostId);
  const boosts = items.filter((x) => x.kind === "boost" && x.id !== activeBoostId);
  const bonuses = items.filter((x) => x.kind === "bonus");
  const challenges = items.filter((x) => x.kind === "challenge");
  const isEmpty =
    active.length === 0 && boosts.length === 0 && bonuses.length === 0 && challenges.length === 0;

  const bonusTotal = Number(rpc?.bonus_total ?? 0);
  const bonusCount = Number(rpc?.bonus_count ?? 0);
  const payoutEstimated = Number(rpc?.payout_total_estimated ?? 0);
  const safeBonusTotal = Number.isFinite(bonusTotal) ? bonusTotal : 0;
  const safeBonusCount = Number.isFinite(bonusCount) ? bonusCount : 0;
  const safePayoutEstimated = Number.isFinite(payoutEstimated) ? payoutEstimated : 0;

  function renderCard(item: BenefitItem, opts?: { canActivate?: boolean }) {
    const canActivate = !!opts?.canActivate;
    const activeBadge = item.active || item.badge === t("driver.benefits.badge.earned", "Gagné");

    return (
      <View key={item.id} style={styles.itemCard}>
        <View style={styles.itemTop}>
          <Text style={styles.itemTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={[styles.badge, activeBadge ? styles.badgeGreen : styles.badgeNeutral]}>
            <Text style={[styles.badgeText, activeBadge && styles.badgeTextGreen]}>
              {item.badge}
            </Text>
          </View>
        </View>
        <Text style={styles.itemSubtitle}>{item.subtitle}</Text>
        {!!item.expiresAt && (
          <Text style={styles.itemExpire}>
            {t("driver.benefits.expires", "Expire:")}{" "}
            {fmtDateShort(item.expiresAt, localeForDate(i18n.language))}
          </Text>
        )}
        {typeof item.progressPct === "number" ? (
          <View style={styles.progressBlock}>
            <View style={styles.progressLabels}>
              <Text style={styles.progressLabel}>
                {t("driver.benefits.progress", "Progression")}
              </Text>
              <Text style={styles.progressLabel}>{item.progressPct}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${item.progressPct}%` }]} />
            </View>
          </View>
        ) : null}
        {canActivate ? (
          <TouchableOpacity
            onPress={() => {
              setActiveBoostId(item.id);
              Alert.alert(
                t("driver.benefits.alert.boostSelected.title", "Boost sélectionné ✅"),
                t(
                  "driver.benefits.alert.boostSelected.body",
                  "Activation réelle (DB) = prochaine étape.",
                ),
              );
            }}
            style={styles.activateBtn}
            activeOpacity={0.85}
          >
            <Text style={styles.activateBtnText}>
              {t("driver.benefits.actions.activate", "Activer")}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (initialLoad && loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("driver.benefits.header.title", "Avantages")}
          subtitle={`${t("driver.benefits.header.subtitle", "Bonus & boosts")} • ${daysLabel}`}
          fallbackRoute="DriverTabs"
          variant="mmd"
        />
        <DriverBrandLoadingState
          title={t("driver.benefits.loading", "Chargement des avantages...")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.benefits.header.title", "Avantages")}
        subtitle={`${t("driver.benefits.header.subtitle", "Bonus & boosts")} • ${daysLabel}`}
        fallbackRoute="DriverTabs"
        variant="mmd"
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.tabs}>
          <TouchableOpacity
            onPress={() => setTab("boosts")}
            style={[styles.tab, tab === "boosts" && styles.tabActive]}
            activeOpacity={0.85}
          >
            <Text style={[styles.tabText, tab === "boosts" && styles.tabTextActive]}>
              {t("driver.benefits.tabs.boosts", "Boosts promos")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setTab("payout")}
            style={[styles.tab, tab === "payout" && styles.tabActive]}
            activeOpacity={0.85}
          >
            <Text style={[styles.tabText, tab === "payout" && styles.tabTextActive]}>
              {t("driver.benefits.tabs.payout", "Payout estimé")}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>
              {t("driver.benefits.summary.bonusEarned", "Bonus gagnés")}
            </Text>
            <Text style={styles.summaryValue}>
              {loading && !rpc ? "-" : fmtMoneyUSD(safeBonusTotal)}
            </Text>
            <Text style={styles.summaryMeta}>
              {t("driver.benefits.summary.events", "Événements:")}{" "}
              {loading && !rpc ? 0 : safeBonusCount}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>
              {t("driver.benefits.summary.payoutEstimated", "Payout estimé")}
            </Text>
            <Text style={[styles.summaryValue, styles.summaryValueGreen]}>
              {loading && !rpc ? "-" : fmtMoneyUSD(safePayoutEstimated)}
            </Text>
            <Text style={styles.summaryMeta}>
              {t("driver.benefits.summary.deliveryPlusBonus", "(Livraisons + bonus)")}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => void fetchBenefits()}
          style={styles.refreshBtn}
          activeOpacity={0.85}
          disabled={loading}
        >
          <Text style={styles.refreshBtnText}>
            {loading
              ? t("driver.benefits.actions.refreshing", "Rafraîchissement...")
              : t("driver.benefits.actions.refresh", "Rafraîchir")}
          </Text>
        </TouchableOpacity>

        {loading ? (
          <View style={styles.loadingCard}>
            <Text style={styles.loadingEmoji}>🎁</Text>
            <Text style={styles.loadingTitle}>
              {t("driver.benefits.loading", "Chargement des avantages...")}
            </Text>
            <ActivityIndicator color={MMD_WHITE} />
          </View>
        ) : tab === "payout" ? (
          <View style={styles.itemCard}>
            <Text style={styles.itemTitle}>
              {t("driver.benefits.summary.payoutEstimated", "Payout estimé")}
            </Text>
            <Text style={[styles.summaryValue, styles.summaryValueGreen, { marginTop: 8 }]}>
              {fmtMoneyUSD(safePayoutEstimated)}
            </Text>
            <Text style={styles.itemSubtitle}>
              {t(
                "driver.benefits.summary.deliveryPlusBonus",
                "(Livraisons + bonus)",
              )}
            </Text>
          </View>
        ) : isEmpty ? (
          <View style={styles.emptyStack}>
            <EmptySectionCard
              emoji="🚀"
              title={t("driver.benefits.sections.activeBoost", "Boost actif")}
              body={t(
                "driver.benefits.empty.activeBoost",
                "Aucun boost actif pour le moment",
              )}
            />
            <EmptySectionCard
              emoji="🎯"
              title={t("driver.benefits.sections.availableBoosts", "Boosts disponibles")}
              body={t("driver.benefits.empty.availableBoosts", "Aucun boost disponible")}
            />
            <EmptySectionCard
              emoji="💰"
              title={t("driver.benefits.sections.bonus", "Bonus")}
              body={t("driver.benefits.empty.bonusPeriod", "Aucun bonus sur cette période")}
            />
            <EmptySectionCard
              emoji="🏆"
              title={t("driver.benefits.sections.challenges", "Défis")}
              body={t("driver.benefits.empty.challenges", "Aucun défi pour l'instant")}
            />
          </View>
        ) : (
          <View style={styles.sections}>
            <Text style={styles.sectionTitle}>
              🚀 {t("driver.benefits.sections.activeBoost", "Boost actif")}
            </Text>
            {active.length === 0 ? (
              <Text style={styles.emptyInline}>
                {t("driver.benefits.empty.activeBoost", "Aucun boost actif.")}
              </Text>
            ) : (
              active.map((i) => renderCard(i))
            )}

            <Text style={styles.sectionTitle}>
              🎯 {t("driver.benefits.sections.availableBoosts", "Boosts disponibles")}
            </Text>
            {boosts.length === 0 ? (
              <Text style={styles.emptyInline}>
                {t("driver.benefits.empty.availableBoosts", "Aucun boost disponible.")}
              </Text>
            ) : (
              boosts.map((i) => renderCard(i, { canActivate: true }))
            )}

            <Text style={styles.sectionTitle}>
              💰 {t("driver.benefits.sections.bonus", "Bonus")}
            </Text>
            {bonuses.length === 0 ? (
              <Text style={styles.emptyInline}>
                {t("driver.benefits.empty.bonusPeriod", "Aucun bonus sur cette période.")}
              </Text>
            ) : (
              bonuses.map((i) => renderCard(i))
            )}

            <Text style={styles.sectionTitle}>
              🏆 {t("driver.benefits.sections.challenges", "Défis")}
            </Text>
            {challenges.length === 0 ? (
              <Text style={styles.emptyInline}>
                {t("driver.benefits.empty.challenges", "Aucun défi pour l'instant.")}
              </Text>
            ) : (
              challenges.map((i) => renderCard(i))
            )}
          </View>
        )}

        <Text style={styles.footnote}>
          {t(
            "driver.benefits.footer",
            "Branché Supabase : boosts actifs + bonus events + défis + payout estimé.",
          )}
        </Text>

        <BrandFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 10 },
  tabs: { flexDirection: "row", gap: 12 },
  tab: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tabActive: { backgroundColor: MMD_TAXI_GREEN },
  tabText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
  },
  tabTextActive: {
    color: MMD_BLUE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  summaryCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    gap: 8,
  },
  summaryCol: { flex: 1, gap: 2 },
  summaryDivider: {
    width: 1,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginVertical: 4,
  },
  summaryLabel: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 11,
  },
  summaryValue: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 20,
  },
  summaryValueGreen: { color: MMD_TAXI_GREEN },
  summaryMeta: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 10,
    fontFamily: MMD_FONT.regular,
  },
  refreshBtn: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 12,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshBtnText: {
    color: MMD_BLUE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  loadingCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    gap: 12,
  },
  loadingEmoji: { fontSize: 56 },
  loadingTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 18,
    textAlign: "center",
  },
  emptyStack: { gap: 10 },
  emptySectionCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  emptyEmoji: { fontSize: 32 },
  emptySectionTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 15,
  },
  emptySectionBody: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
    marginTop: 4,
  },
  sections: { gap: 6 },
  sectionTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 13,
    marginTop: 4,
  },
  emptyInline: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  itemCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  itemTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  itemTitle: {
    flex: 1,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  itemSubtitle: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
    lineHeight: 18,
  },
  itemExpire: {
    color: "rgba(255,255,255,0.4)",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  badgeGreen: { backgroundColor: "rgba(34,197,94,0.1)" },
  badgeNeutral: { backgroundColor: "rgba(255,255,255,0.1)" },
  badgeText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
  badgeTextGreen: { color: MMD_TAXI_GREEN },
  progressBlock: { gap: 6, marginTop: 4 },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressLabel: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 11,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: MMD_TAXI_GREEN,
  },
  activateBtn: {
    marginTop: 6,
    minHeight: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  activateBtnText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 13,
  },
  footnote: {
    color: "rgba(255,255,255,0.4)",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 8,
    textAlign: "center",
    marginTop: 4,
  },
  footer: {
    alignItems: "center",
    gap: 6,
    paddingTop: 8,
    paddingBottom: 8,
  },
  footerLogo: { width: 32, height: 32, borderRadius: 10 },
  footerBrand: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
});
