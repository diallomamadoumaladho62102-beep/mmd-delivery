// apps/mobile/src/screens/DriverOpportunitiesScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_DARK,
  MMD_MUTED,
  MMD_WHITE,
} from "../theme/mmdUi";

const BG = "#F8FAFF";
const CARD_BORDER = "#E2E8F0";
const TEXT_DARK = "#0F172A";
const TEXT_SLATE = "#475569";
const TEXT_MUTED = "#64748B";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

const tf =
  (t: TFunction) =>
  (k: string, fb?: string, vars?: Record<string, any>) =>
    t(k, { defaultValue: fb ?? k, ...(vars ?? {}) });

type TSimple = (k: string, fallback?: string) => string;

function formatRating(n: number | null, count: number, t: TSimple) {
  if (!count) return t("driver.opps.rating.new", "Nouveau");
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function parseStartMinutes(timeRange: string): number {
  try {
    const first = timeRange.split("–")[0]?.trim() ?? "";
    const m = first.match(/(\d{1,2})\s*h\s*(\d{2})/i);
    if (!m) return 0;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    return hh * 60 + mm;
  } catch {
    return 0;
  }
}

function toLocalDateForOpp(todayStart: Date, dayOffset: number, startMinutes: number) {
  const d = new Date(todayStart);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setMinutes(startMinutes, 0, 0);
  return target;
}

function StarsRow({
  rating,
  count,
  size = 28,
}: {
  rating: number | null | undefined;
  count: number;
  size?: number;
}) {
  if (!count) {
    return (
      <Text style={{ color: MMD_GOLD_DARK, fontSize: 14, fontFamily: MMD_FONT.extrabold, fontWeight: "800" }}>
        {"☆".repeat(5)} New
      </Text>
    );
  }

  const v = rating == null || !Number.isFinite(rating) ? 0 : clamp(rating, 0, 5);
  const full = Math.round(v);
  const empty = 5 - full;

  return (
    <Text
      style={{
        color: MMD_GOLD_DARK,
        fontSize: size,
        fontFamily: MMD_FONT.extrabold,
        fontWeight: "800",
      }}
    >
      {"★".repeat(full)}
      {"☆".repeat(empty)} {v.toFixed(2)}
    </Text>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

type OppCategory = "saved" | "promotions" | "airports" | "reservations" | "events";

type Opportunity = {
  id: string;
  category: Exclude<OppCategory, "saved">;
  dayOffset: number;
  title: string;
  subtitle: string;
  timeRange: string;
  distanceText: string;
  tag?: string;
  ctaLabel?: string;
  emoji?: string;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(base: Date, n: number) {
  const x = new Date(base);
  x.setDate(x.getDate() + n);
  return x;
}

function Chip({
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
      style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
    >
      <Text style={[styles.chipLabel, active ? styles.chipLabelActive : styles.chipLabelIdle]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function DayChip({
  date,
  active,
  onPress,
}: {
  date: Date;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.dayChip, active ? styles.dayChipActive : styles.dayChipIdle]}
    >
      <Text style={[styles.dayWeek, active ? styles.dayWeekActive : styles.dayWeekIdle]}>
        {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date).toUpperCase()}
      </Text>
      <Text style={[styles.dayNum, active ? styles.dayNumActive : styles.dayNumIdle]}>
        {date.getDate()}
      </Text>
    </TouchableOpacity>
  );
}

function OpportunityCard({
  opp,
  saved,
  joined,
  onToggleSave,
  onJoin,
  t,
}: {
  opp: Opportunity;
  saved: boolean;
  joined: boolean;
  onToggleSave: () => void;
  onJoin: () => void;
  t: (k: string, fallback?: string, vars?: any) => string;
}) {
  const pillLabel = joined
    ? t("driver.opps.pill.joined", "Inscrit ✅")
    : saved
    ? t("driver.opps.pill.saved", "Enregistrée")
    : opp.tag
    ? opp.tag
    : null;

  return (
    <View style={[styles.oppCard, joined ? { opacity: 0.92 } : null]}>
      <View style={styles.oppTop}>
        <View style={styles.oppLeft}>
          <Text style={styles.oppTime}>{opp.timeRange}</Text>
          <Text style={styles.oppTitle}>{opp.title}</Text>
          <Text style={styles.oppSub}>{opp.subtitle}</Text>
          <Text style={styles.oppDist}>{opp.distanceText}</Text>
          {pillLabel ? <Pill label={pillLabel} /> : null}
        </View>
        <View style={styles.emojiBox}>
          <Text style={{ fontSize: 34 }}>{opp.emoji ?? "✈️"}</Text>
        </View>
      </View>

      <View style={styles.oppActions}>
        <TouchableOpacity onPress={onToggleSave} style={styles.saveBtn}>
          <Text style={styles.saveBtnLabel}>
            {saved
              ? t("driver.opps.actions.saved", "Enregistré ✅")
              : t("driver.opps.actions.save", "Enregistrer")}
          </Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={onJoin}
          disabled={joined}
          style={[styles.joinBtn, joined ? styles.joinBtnDone : null]}
        >
          <Text style={styles.joinBtnLabel}>
            {joined
              ? t("driver.opps.actions.joined", "Inscrit ✅")
              : opp.ctaLabel ?? t("driver.opps.actions.join", "S’inscrire")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function DriverOpportunitiesScreen() {
  const { t, i18n } = useTranslation();

  const tt = useMemo(() => tf(t), [t]);
  const ts: TSimple = useMemo(() => (k, fb) => tt(k, fb), [tt]);

  const [loading, setLoading] = useState(true);

  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);

  const [category, setCategory] = useState<OppCategory>("airports");
  const [selectedDayOffset, setSelectedDayOffset] = useState(0);

  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const [joinedIds, setJoinedIds] = useState<Record<string, boolean>>({});
  const [userId, setUserId] = useState<string | null>(null);

  const [hydratedOnce, setHydratedOnce] = useState(false);

  const platformLabel = Platform.OS === "ios" ? "iOS" : "Android";

  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(() => {
    const arr: { offset: number; date: Date }[] = [];
    for (let i = 0; i < 10; i++) arr.push({ offset: i, date: addDays(today, i) });
    return arr;
  }, [today]);

  const headerDateLabel = useMemo(() => {
    const d = addDays(today, selectedDayOffset);
    try {
      return new Intl.DateTimeFormat(i18n.language || undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      }).format(d);
    } catch {
      return `${d.toDateString()}`;
    }
  }, [today, selectedDayOffset, i18n.language]);

  const SAVED_KEY_PREFIX = "mmd_driver_saved_opps_v1";
  const JOINED_KEY_PREFIX = "mmd_driver_joined_opps_v1";
  const NOTIF_KEY_PREFIX = "mmd_driver_saved_opps_notifs_v1";

  const getKey = useCallback((prefix: string, uid: string | null) => `${prefix}:${uid ?? "anon"}`, []);

  const restoreMap = useCallback(
    async (prefix: string, uid: string | null) => {
      try {
        const key = getKey(prefix, uid);
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed as Record<string, boolean>;
        return {};
      } catch (e) {
        console.log("restoreMap error", prefix, e);
        return {};
      }
    },
    [getKey]
  );

  const persistMap = useCallback(
    async (prefix: string, uid: string | null, next: any) => {
      try {
        const key = getKey(prefix, uid);
        await AsyncStorage.setItem(key, JSON.stringify(next));
      } catch (e) {
        console.log("persistMap error", prefix, e);
      }
    },
    [getKey]
  );

  const notifReadyRef = useRef(false);

  const ensureNotifPermissions = useCallback(async () => {
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("mmd-opps", {
          name: t("driver.opps.notifs.channelName", "MMD Opportunités"),
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      const settings = await Notifications.getPermissionsAsync();
      if (settings.status !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        notifReadyRef.current = req.status === "granted";
      } else {
        notifReadyRef.current = true;
      }
    } catch (e) {
      console.log("ensureNotifPermissions error", e);
      notifReadyRef.current = false;
    }
  }, [t]);

  const restoreNotifMap = useCallback(
    async (uid: string | null) => {
      try {
        const key = getKey(NOTIF_KEY_PREFIX, uid);
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return {} as Record<string, string>;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
        return {} as Record<string, string>;
      } catch (e) {
        console.log("restoreNotifMap error", e);
        return {} as Record<string, string>;
      }
    },
    [getKey]
  );

  const persistNotifMap = useCallback(
    async (uid: string | null, next: Record<string, string>) => {
      try {
        const key = getKey(NOTIF_KEY_PREFIX, uid);
        await AsyncStorage.setItem(key, JSON.stringify(next));
      } catch (e) {
        console.log("persistNotifMap error", e);
      }
    },
    [getKey]
  );

  const scheduleReminder = useCallback(
    async (uid: string | null, opp: Opportunity, notifMap: Record<string, string>) => {
      if (!uid) return notifMap;
      if (!notifReadyRef.current) return notifMap;
      if (notifMap[opp.id]) return notifMap;

      const startMin = parseStartMinutes(opp.timeRange);
      const startDate = toLocalDateForOpp(today, opp.dayOffset, startMin);
      const fireDate = new Date(startDate.getTime() - 30 * 60 * 1000);
      if (fireDate.getTime() <= Date.now() + 10_000) return notifMap;

      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: t("driver.opps.notifs.reminderTitle", "Rappel opportunité ⏰"),
          body: t("driver.opps.notifs.reminderBody", "{{title}} • commence dans 30 minutes", {
            title: opp.title,
          }),
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireDate,
        },
      });

      const next = { ...notifMap, [opp.id]: notificationId };
      await persistNotifMap(uid, next);
      return next;
    },
    [persistNotifMap, t, today]
  );

  const cancelReminder = useCallback(
    async (uid: string | null, oppId: string, notifMap: Record<string, string>) => {
      if (!uid) return notifMap;

      const notificationId = notifMap[oppId];
      if (!notificationId) return notifMap;

      try {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
      } catch (e) {
        console.log("cancelScheduledNotificationAsync error", e);
      }

      const next = { ...notifMap };
      delete next[oppId];
      await persistNotifMap(uid, next);
      return next;
    },
    [persistNotifMap]
  );

  const fetchSavedFromServer = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from("driver_saved_opportunities")
      .select("opportunity_id")
      .eq("driver_id", uid);

    if (error) {
      console.log("fetchSavedFromServer error", error);
      return null as Record<string, boolean> | null;
    }

    const map: Record<string, boolean> = {};
    for (const row of data ?? []) {
      const oppId = (row as any)?.opportunity_id;
      if (oppId) map[String(oppId)] = true;
    }
    return map;
  }, []);

  const setSavedOnServer = useCallback(async (uid: string, oppId: string, saved: boolean) => {
    if (saved) {
      const { error } = await supabase
        .from("driver_saved_opportunities")
        .upsert({ driver_id: uid, opportunity_id: oppId }, { onConflict: "driver_id,opportunity_id" });
      if (error) console.log("setSavedOnServer upsert error", error);
    } else {
      const { error } = await supabase
        .from("driver_saved_opportunities")
        .delete()
        .eq("driver_id", uid)
        .eq("opportunity_id", oppId);
      if (error) console.log("setSavedOnServer delete error", error);
    }
  }, []);

  const fetchJoinedFromServer = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from("driver_opportunity_signups")
      .select("opportunity_id")
      .eq("driver_id", uid);

    if (error) {
      console.log("fetchJoinedFromServer error", error);
      return null as Record<string, boolean> | null;
    }

    const map: Record<string, boolean> = {};
    for (const row of data ?? []) {
      const oppId = (row as any)?.opportunity_id;
      if (oppId) map[String(oppId)] = true;
    }
    return map;
  }, []);

  const setJoinedOnServer = useCallback(async (uid: string, oppId: string) => {
    const { error } = await supabase
      .from("driver_opportunity_signups")
      .upsert({ driver_id: uid, opportunity_id: oppId }, { onConflict: "driver_id,opportunity_id" });

    if (error) console.log("setJoinedOnServer upsert error", error);
  }, []);

  // Production: no hardcoded demo opportunities. Empty until a real feed exists.
  const allOpps: Opportunity[] = useMemo(() => [], []);

  const savedCount = useMemo(() => Object.values(savedIds).filter(Boolean).length, [savedIds]);

  const filteredOpps = useMemo(() => {
    if (category === "saved") {
      const savedList = allOpps.filter((o) => !!savedIds[o.id]);
      return savedList.sort((a, b) => {
        const aMin = parseStartMinutes(a.timeRange);
        const bMin = parseStartMinutes(b.timeRange);
        if (a.dayOffset !== b.dayOffset) return a.dayOffset - b.dayOffset;
        return aMin - bMin;
      });
    }
    return allOpps.filter((o) => o.category === category && o.dayOffset === selectedDayOffset);
  }, [allOpps, category, selectedDayOffset, savedIds]);

  const loadRating = useCallback(async (uid: string) => {
    const { data, error } = await supabase.from("driver_reviews").select("stars").eq("driver_id", uid).limit(500);

    if (error) {
      console.log("driver_reviews error", error);
      setAvgRating(null);
      setRatingCount(0);
      return;
    }

    const stars = (data ?? [])
      .map((r: any) => Number(r.stars))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);

    if (!stars.length) {
      setAvgRating(null);
      setRatingCount(0);
      return;
    }

    const sum = stars.reduce((a, b) => a + b, 0);
    setAvgRating(sum / stars.length);
    setRatingCount(stars.length);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);

      await ensureNotifPermissions();

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) console.log("auth.getUser error", authErr);

      const user = authData?.user;
      const uid = user?.id ?? null;
      setUserId(uid);

      const localSaved = await restoreMap(SAVED_KEY_PREFIX, uid);
      const localJoined = await restoreMap(JOINED_KEY_PREFIX, uid);
      setSavedIds(localSaved);
      setJoinedIds(localJoined);

      if (uid) {
        const serverSaved = await fetchSavedFromServer(uid);
        if (serverSaved) {
          setSavedIds(serverSaved);
          await persistMap(SAVED_KEY_PREFIX, uid, serverSaved);
        }

        const serverJoined = await fetchJoinedFromServer(uid);
        if (serverJoined) {
          setJoinedIds(serverJoined);
          await persistMap(JOINED_KEY_PREFIX, uid, serverJoined);
        }
      }

      if (!user) {
        setAvgRating(null);
        setRatingCount(0);
        return;
      }

      await loadRating(user.id);
    } finally {
      setLoading(false);
      setHydratedOnce(true);
    }
  }, [ensureNotifPermissions, fetchJoinedFromServer, fetchSavedFromServer, loadRating, persistMap, restoreMap]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!hydratedOnce) return;
      loadAll();
    }, [hydratedOnce, loadAll])
  );

  const scoreLabel = useMemo(() => formatRating(avgRating, ratingCount, ts), [avgRating, ratingCount, ts]);

  const toggleSave = useCallback(
    async (opp: Opportunity) => {
      const uid = userId;
      const notifMap = await restoreNotifMap(uid);

      const wasSaved = !!savedIds[opp.id];
      const nextSaved = !wasSaved;

      const nextMap = { ...savedIds, [opp.id]: nextSaved };
      setSavedIds(nextMap);

      await persistMap(SAVED_KEY_PREFIX, uid, nextMap);

      if (uid) await setSavedOnServer(uid, opp.id, nextSaved);

      if (uid) {
        if (nextSaved) await scheduleReminder(uid, opp, notifMap);
        else await cancelReminder(uid, opp.id, notifMap);
      }

      Alert.alert(
        nextSaved ? t("driver.opps.alerts.savedTitle", "Enregistré ✅") : t("driver.opps.alerts.removedTitle", "Retiré ✅"),
        nextSaved
          ? t("driver.opps.alerts.savedBody", "Ajouté: {{title}}", { title: opp.title })
          : t("driver.opps.alerts.removedBody", "Retiré: {{title}}", { title: opp.title })
      );
    },
    [cancelReminder, persistMap, restoreNotifMap, savedIds, scheduleReminder, setSavedOnServer, t, userId]
  );

  const joinOpp = useCallback(
    async (opp: Opportunity) => {
      const uid = userId;

      if (!uid) {
        Alert.alert(
          t("client.auth.titleLogin", "Connexion requise"),
          t("driver.opps.alerts.loginToJoin", "Connecte-toi pour t’inscrire.")
        );
        return;
      }

      if (joinedIds[opp.id]) return;

      const next = { ...joinedIds, [opp.id]: true };
      setJoinedIds(next);
      await persistMap(JOINED_KEY_PREFIX, uid, next);

      await setJoinedOnServer(uid, opp.id);

      Alert.alert(
        t("common.ok", "OK ✅"),
        t("driver.opps.alerts.joinedBody", "Inscription confirmée • {{title}}", { title: opp.title })
      );
    },
    [joinedIds, persistMap, setJoinedOnServer, t, userId]
  );

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("driver.opps.title", "Opportunités")}
        fallbackRoute="DriverTabs"
        variant="mmd"
        style={styles.header}
      />

      {loading ? (
        <View style={styles.loadingBody}>
          <ActivityIndicator color={MMD_BLUE} size="large" />
          <Text style={styles.loadingLabel}>
            {t("shared.common.loading", "Loading...")}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          style={{ backgroundColor: BG }}
        >
          <View style={styles.scoreCard}>
            <Text style={styles.scoreTitle}>
              {t("driver.opps.scoreCard.title", "Your score")}
            </Text>
            <StarsRow rating={avgRating} count={ratingCount} />
            {ratingCount ? (
              <Text style={styles.scoreMeta}>
                {scoreLabel} ({ratingCount})
              </Text>
            ) : null}
          </View>

          <View style={styles.chipRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Chip
                label={t("driver.opps.tabs.savedWithCount", "Saved ({{count}})", {
                  count: savedCount,
                })}
                active={category === "saved"}
                onPress={() => setCategory("saved")}
              />
              <Chip
                label={t("driver.opps.tabs.promotions", "Promotions")}
                active={category === "promotions"}
                onPress={() => setCategory("promotions")}
              />
              <Chip
                label={t("driver.opps.tabs.airports", "Airports")}
                active={category === "airports"}
                onPress={() => setCategory("airports")}
              />
              <Chip
                label={t("driver.opps.tabs.reservations", "Reservations")}
                active={category === "reservations"}
                onPress={() => setCategory("reservations")}
              />
              <Chip
                label={t("driver.opps.tabs.events", "Events")}
                active={category === "events"}
                onPress={() => setCategory("events")}
              />
            </ScrollView>
          </View>

          <View style={{ marginBottom: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {days.map((d) => (
                <DayChip
                  key={String(d.offset)}
                  date={d.date}
                  active={selectedDayOffset === d.offset}
                  onPress={() => setSelectedDayOffset(d.offset)}
                />
              ))}
            </ScrollView>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.dateHeading}>{headerDateLabel}</Text>
            {filteredOpps.length > 0 ? (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeLabel}>
                  {filteredOpps.length}{" "}
                  {filteredOpps.length === 1 ? "shift" : "shifts"}
                </Text>
              </View>
            ) : null}
          </View>

          {filteredOpps.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Ionicons name="search" size={32} color={MMD_BLUE} />
              </View>
              <Text style={styles.emptyTitle}>
                {t("driver.opps.emptyTitle", "No opportunity for today")}
              </Text>
              <Text style={styles.emptyBody}>
                {t(
                  "driver.opps.empty",
                  "We haven't found any opportunity matching your criteria. Try adjusting your filters or check back later."
                )}
              </Text>
              <View style={styles.soonPill}>
                <Text style={styles.soonPillLabel}>
                  {t("driver.opps.tags.soon", "Soon")}
                </Text>
              </View>
            </View>
          ) : (
            <View style={{ marginTop: 4, gap: 12 }}>
              {filteredOpps.map((opp) => (
                <OpportunityCard
                  key={opp.id}
                  opp={opp}
                  saved={!!savedIds[opp.id]}
                  joined={!!joinedIds[opp.id]}
                  onToggleSave={() => toggleSave(opp)}
                  onJoin={() => joinOpp(opp)}
                  t={tt}
                />
              ))}
            </View>
          )}

          <Text style={styles.footer}>
            {t("driver.opps.footer", "{{platform}} • Opportunities Driver MMD", {
              platform: platformLabel,
            })}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  header: { backgroundColor: MMD_BLUE },
  loadingBody: {
    flex: 1,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  loadingLabel: {
    color: MMD_BLUE,
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  scroll: {
    padding: 16,
    paddingBottom: 28,
    gap: 16,
    backgroundColor: BG,
  },
  scoreCard: {
    backgroundColor: MMD_WHITE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 16,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  scoreTitle: {
    color: TEXT_SLATE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  scoreMeta: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  chipRow: { flexDirection: "row", alignItems: "center" },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    marginRight: 10,
  },
  chipActive: { backgroundColor: MMD_BLUE },
  chipIdle: {
    backgroundColor: MMD_WHITE,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  chipLabel: { fontSize: 13, fontFamily: MMD_FONT.bold, fontWeight: "700" },
  chipLabelActive: { color: MMD_WHITE },
  chipLabelIdle: { color: TEXT_MUTED },
  dayChip: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    gap: 4,
  },
  dayChipActive: { backgroundColor: MMD_BLUE },
  dayChipIdle: {
    backgroundColor: MMD_WHITE,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  dayWeek: { fontSize: 11, fontFamily: MMD_FONT.bold, fontWeight: "700" },
  dayWeekActive: { color: "rgba(255,255,255,0.7)" },
  dayWeekIdle: { color: TEXT_MUTED },
  dayNum: { fontSize: 16, fontFamily: MMD_FONT.extrabold, fontWeight: "800" },
  dayNumActive: { color: MMD_WHITE },
  dayNumIdle: { color: TEXT_DARK },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateHeading: {
    color: TEXT_DARK,
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  countBadge: {
    backgroundColor: "#DBEAFE",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countBadgeLabel: {
    color: MMD_BLUE,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  emptyCard: {
    backgroundColor: MMD_WHITE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 24,
    alignItems: "center",
    gap: 16,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#E0E7FF",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: TEXT_DARK,
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyBody: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 20,
  },
  soonPill: {
    backgroundColor: MMD_BLUE,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  soonPillLabel: {
    color: MMD_WHITE,
    fontSize: 13,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  footer: {
    color: MMD_MUTED,
    marginTop: 8,
    fontSize: 12,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    textAlign: "center",
  },
  oppCard: {
    backgroundColor: MMD_WHITE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 14,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  oppTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  oppLeft: { flex: 1, gap: 6, minWidth: 0 },
  oppTime: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  oppTitle: {
    color: TEXT_DARK,
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  oppSub: {
    color: TEXT_SLATE,
    fontSize: 13,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    lineHeight: 18,
  },
  oppDist: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  emojiBox: {
    width: 72,
    height: 72,
    borderRadius: 16,
    backgroundColor: "#DBEAFE",
    borderWidth: 1,
    borderColor: MMD_BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  oppActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: MMD_WHITE,
  },
  saveBtnLabel: {
    color: TEXT_SLATE,
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  joinBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: MMD_BLUE,
  },
  joinBtnDone: { opacity: 0.85 },
  joinBtnLabel: {
    color: MMD_WHITE,
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#DBEAFE",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    marginTop: 4,
  },
  pillLabel: {
    color: MMD_BLUE,
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
});
