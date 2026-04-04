import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

type BoostKind = "boost" | "bonus" | "challenge";

type BenefitItem = {
  id: string;
  kind: BoostKind;
  title: string;
  subtitle: string;
  badge: string;
  accent: "blue" | "green" | "amber" | "purple";
  active?: boolean;
  expiresAt?: string; // affichage
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
  active_boosts: any; // jsonb
  bonus_total: number | null;
  bonus_count: number | null;
  last_bonus_events: any; // jsonb
  payout_total_estimated: number | null;

  // ✅ AJOUT : défis
  challenges?: any; // jsonb array
};

function badgeColors(accent: BenefitItem["accent"]) {
  switch (accent) {
    case "green":
      return { bg: "rgba(34,197,94,0.12)", border: "#14532D", text: "#BBF7D0" };
    case "amber":
      return { bg: "rgba(245,158,11,0.12)", border: "#78350F", text: "#FDE68A" };
    case "purple":
      return { bg: "rgba(168,85,247,0.12)", border: "#4C1D95", text: "#E9D5FF" };
    case "blue":
    default:
      return { bg: "rgba(59,130,246,0.12)", border: "#1D4ED8", text: "#BFDBFE" };
  }
}

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
  const day = x.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // Monday=0
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

// ✅ wrapper pour convertir i18next t(key, options) en t(key, fallback, vars)
const tf =
  (t: TFunction) =>
  (k: string, fb?: string, vars?: Record<string, any>) =>
    t(k, { defaultValue: fb ?? k, ...(vars ?? {}) });

// ✅ notre type “simple” utilisé par les helpers (badge/subtitle)
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
      `Gagne +${pct}% sur ta part chauffeur.`
    ).replace("{value}", pct);
  }

  if (b.kind === "per_order") {
    const money = Number.isFinite(v) ? v.toFixed(2) : "0.00";
    return t(
      "driver.benefits.boostSubtitle.perOrder",
      `Bonus ajouté : +${money} $ par course livrée.`
    ).replace("{value}", money);
  }

  return t("driver.benefits.boostSubtitle.timeWindow", "Boost actif sur une période limitée.");
}

export function DriverBenefitsScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();

  // ✅ t compatible avec nos helpers “(k, fb?)”
  const tt = useMemo(() => tf(t), [t]);
  const ts: TSimple = useMemo(() => (k, fb) => tt(k, fb), [tt]);

  // Période (alignée sur Revenus -> semaine par défaut)
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

  const [loading, setLoading] = useState(false);
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

      // 1) Boosts/bonus/payout
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

      // 2) Défis
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

      // UI: boost actif = 1er boost retourné
      const boostsRaw = (merged as any)?.active_boosts;
      const boostsArr: BoostRow[] = Array.isArray(boostsRaw) ? boostsRaw : [];
      setActiveBoostId(boostsArr[0]?.id ?? null);

      console.log("✅ get_driver_benefits merged:", merged);
    } catch (e: any) {
      console.log("fetchBenefits error:", e);
      setRpc(null);
      setActiveBoostId(null);
    } finally {
      setLoading(false);
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

    const boostItems: BenefitItem[] = boostsArr.map((b) => ({
      id: b.id,
      kind: "boost",
      title: b.title,
      subtitle: boostSubtitle(b, ts),
      badge: boostBadgeFromKind(b.kind, ts),
      accent: boostAccentFromKind(b.kind),
      active: b.id === activeBoostId,
      expiresAt: b.ends_at ?? undefined,
    }));

    const bonusItems: BenefitItem[] = bonusArr.map((e) => ({
      id: e.id,
      kind: "bonus",
      title: e.label,
      subtitle: `+${fmtMoneyUSD(e.amount)} • ${fmtDateShort(
        e.occurred_at,
        localeForDate(i18n.language)
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
        fmtMoneyUSD(c.reward_amount)
      );

      return {
        id: c.id,
        kind: "challenge",
        title: c.title,
        subtitle: `${line1}${line2} • ${line3}`,
        badge,
        accent: "purple",
        expiresAt: c.ends_at ?? undefined,
      };
    });

    return [...boostItems, ...bonusItems, ...challengeItems];
  }, [rpc, activeBoostId, ts, t, i18n.language]);

  const active = items.filter((x) => x.kind === "boost" && x.id === activeBoostId);
  const boosts = items.filter((x) => x.kind === "boost" && x.id !== activeBoostId);
  const bonuses = items.filter((x) => x.kind === "bonus");
  const challenges = items.filter((x) => x.kind === "challenge");

  function renderCard(item: BenefitItem, opts?: { canActivate?: boolean }) {
    const c = badgeColors(item.accent);
    const canActivate = !!opts?.canActivate;

    return (
      <View
        key={item.id}
        style={{
          borderRadius: 18,
          backgroundColor: "rgba(15,23,42,0.65)",
          borderWidth: 1,
          borderColor: "#1F2937",
          padding: 14,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
              {item.title}
            </Text>
            <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "700", lineHeight: 18 }}>
              {item.subtitle}
            </Text>

            {!!item.expiresAt && (
              <Text style={{ color: "#64748B", marginTop: 8, fontSize: 12, fontWeight: "700" }}>
                {t("driver.benefits.expires", "Expire :")}{" "}
                {fmtDateShort(item.expiresAt, localeForDate(i18n.language))}
              </Text>
            )}
          </View>

          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: c.bg,
              borderWidth: 1,
              borderColor: c.border,
            }}
          >
            <Text style={{ color: c.text, fontWeight: "900", fontSize: 12 }}>{item.badge}</Text>
          </View>
        </View>

        {canActivate && (
          <TouchableOpacity
            onPress={() => {
              setActiveBoostId(item.id);
              Alert.alert(
                t("driver.benefits.alert.boostSelected.title", "Boost sélectionné ✅"),
                t(
                  "driver.benefits.alert.boostSelected.body",
                  "Activation réelle (DB) = prochaine étape."
                )
              );
            }}
            style={{
              marginTop: 12,
              height: 46,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(2,6,23,0.55)",
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
              {t("driver.benefits.actions.activate", "Activer")}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const bonusTotal = Number(rpc?.bonus_total ?? 0);
  const bonusCount = Number(rpc?.bonus_count ?? 0);
  const payoutEstimated = Number(rpc?.payout_total_estimated ?? 0);

  const safeBonusTotal = Number.isFinite(bonusTotal) ? bonusTotal : 0;
  const safeBonusCount = Number.isFinite(bonusCount) ? bonusCount : 0;
  const safePayoutEstimated = Number.isFinite(payoutEstimated) ? payoutEstimated : 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingVertical: 8, paddingRight: 10 }}>
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>←</Text>
          </TouchableOpacity>

          <View style={{ alignItems: "center" }}>
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
              {t("driver.benefits.header.title", "Avantages")}
            </Text>
            <Text style={{ color: "#9CA3AF", marginTop: 2, fontWeight: "800", fontSize: 12 }}>
              {t("driver.benefits.header.subtitle", "Bonus & boosts")} • {daysLabel}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => {
              Alert.alert(
                t("driver.benefits.alert.help.title", "Aide"),
                t(
                  "driver.benefits.alert.help.body",
                  "Boosts = promos actives (config). Bonus = événements réellement gagnés. Défis = objectifs (progression). Payout estimé = (payout livraisons) + (bonus)."
                )
              );
            }}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
              backgroundColor: "rgba(15,23,42,0.7)",
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
              {t("driver.benefits.actions.help", "Aide")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30, gap: 12 }}>
        {/* Résumé bonus/payout */}
        <View
          style={{
            borderRadius: 18,
            backgroundColor: "rgba(15,23,42,0.65)",
            borderWidth: 1,
            borderColor: "#1F2937",
            padding: 14,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View style={{ width: "48%" }}>
              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                {t("driver.benefits.summary.bonusEarned", "Bonus gagnés")}
              </Text>
              <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 6 }}>
                {fmtMoneyUSD(safeBonusTotal)}
              </Text>
              <Text style={{ color: "#94A3B8", marginTop: 4, fontWeight: "700" }}>
                {t("driver.benefits.summary.events", "Événements :")} {safeBonusCount}
              </Text>
            </View>

            <View style={{ width: "48%" }}>
              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                {t("driver.benefits.summary.payoutEstimated", "Payout estimé")}
              </Text>
              <Text style={{ color: "#22C55E", fontSize: 22, fontWeight: "900", marginTop: 6 }}>
                {fmtMoneyUSD(safePayoutEstimated)}
              </Text>
              <Text style={{ color: "#94A3B8", marginTop: 4, fontWeight: "700" }}>
                {t("driver.benefits.summary.deliveryPlusBonus", "(Livraisons + bonus)")}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => void fetchBenefits()}
            style={{
              marginTop: 12,
              height: 46,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(2,6,23,0.55)",
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
              {loading
                ? t("driver.benefits.actions.refreshing", "Rafraîchissement...")
                : t("driver.benefits.actions.refresh", "Rafraîchir")}
            </Text>
          </TouchableOpacity>
        </View>

        {loading && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
              {t("driver.benefits.loading", "Chargement…")}
            </Text>
          </View>
        )}

        {/* Boost actif */}
        <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 6 }}>
          {t("driver.benefits.sections.activeBoost", "Boost actif")}
        </Text>
        {active.length === 0 ? (
          <Text style={{ color: "#9CA3AF" }}>{t("driver.benefits.empty.activeBoost", "Aucun boost actif.")}</Text>
        ) : (
          <View style={{ gap: 10 }}>{active.map((i) => renderCard(i))}</View>
        )}

        {/* Boosts disponibles */}
        <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 10 }}>
          {t("driver.benefits.sections.availableBoosts", "Boosts disponibles")}
        </Text>
        <View style={{ gap: 10 }}>
          {boosts.length === 0 ? (
            <Text style={{ color: "#9CA3AF" }}>
              {t("driver.benefits.empty.availableBoosts", "Aucun boost disponible.")}
            </Text>
          ) : (
            boosts.map((i) => renderCard(i, { canActivate: true }))
          )}
        </View>

        {/* Bonus */}
        <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 10 }}>
          {t("driver.benefits.sections.bonus", "Bonus")}
        </Text>
        <View style={{ gap: 10 }}>
          {bonuses.length === 0 ? (
            <Text style={{ color: "#9CA3AF" }}>
              {t("driver.benefits.empty.bonusPeriod", "Aucun bonus sur cette période.")}
            </Text>
          ) : (
            bonuses.map((i) => renderCard(i))
          )}
        </View>

        {/* Défis */}
        <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 10 }}>
          {t("driver.benefits.sections.challenges", "Défis")}
        </Text>
        <View style={{ gap: 10 }}>
          {challenges.length === 0 ? (
            <Text style={{ color: "#9CA3AF" }}>
              {t("driver.benefits.empty.challenges", "Aucun défi pour l’instant.")}
            </Text>
          ) : (
            challenges.map((i) => renderCard(i))
          )}
        </View>

        <Text style={{ color: "#334155", marginTop: 8, fontSize: 11 }}>
          {t(
            "driver.benefits.footer",
            "Branché Supabase : boosts actifs + bonus events + défis + payout estimé."
          )}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}