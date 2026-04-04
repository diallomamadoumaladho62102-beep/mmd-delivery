// apps/mobile/src/screens/DriverOpportunitiesScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { supabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// ✅ wrapper pour convertir i18next t(key, options) en t(key, fallback, vars)
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

// "21 h 00 – 00 h 00" => 21*60
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
  size = 14,
}: {
  rating: number | null | undefined;
  count: number;
  size?: number;
}) {
  if (!count) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ color: "#374151", fontSize: size, fontWeight: "900" }}>
          {"☆".repeat(5)}
        </Text>
      </View>
    );
  }

  const v = rating == null || !Number.isFinite(rating) ? 0 : clamp(rating, 0, 5);
  const full = Math.round(v);
  const empty = 5 - full;

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Text style={{ color: "#FBBF24", fontSize: size, fontWeight: "900" }}>
        {"★".repeat(full)}
      </Text>
      <Text style={{ color: "#374151", fontSize: size, fontWeight: "900" }}>
        {"☆".repeat(empty)}
      </Text>
    </View>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: "#0A1730",
        borderWidth: 1,
        borderColor: "#111827",
        marginTop: 10,
      }}
    >
      <Text style={{ color: "#93C5FD", fontWeight: "900" }}>{label}</Text>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: "#0B1220",
        borderColor: "#111827",
        borderWidth: 1,
        borderRadius: 18,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>{title}</Text>
      <View style={{ height: 10 }} />
      {children}
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
      style={{
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? "#2563EB" : "#111827",
        backgroundColor: active ? "#0A1730" : "#0B1220",
        marginRight: 10,
      }}
    >
      <Text style={{ color: active ? "#93C5FD" : "#CBD5E1", fontWeight: "900" }}>{label}</Text>
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
      style={{
        width: 56,
        paddingVertical: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: active ? "#2563EB" : "#111827",
        backgroundColor: active ? "#0A1730" : "#0B1220",
        alignItems: "center",
        marginRight: 10,
      }}
    >
      <Text style={{ color: active ? "#93C5FD" : "#94A3B8", fontWeight: "900" }}>
        {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date).toUpperCase()}
      </Text>
      <Text style={{ color: "white", fontSize: 16, fontWeight: "900", marginTop: 4 }}>
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
    <View
      style={{
        backgroundColor: "#0B1220",
        borderColor: "#111827",
        borderWidth: 1,
        borderRadius: 18,
        padding: 14,
        marginBottom: 14,
        opacity: joined ? 0.92 : 1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ color: "#94A3B8", fontWeight: "900" }}>{opp.timeRange}</Text>
          <Text style={{ color: "white", fontSize: 18, fontWeight: "900", marginTop: 6 }}>{opp.title}</Text>
          <Text style={{ color: "#9CA3AF", fontWeight: "800", marginTop: 6, lineHeight: 20 }}>
            {opp.subtitle}
          </Text>

          <Text style={{ color: "#64748B", fontWeight: "800", marginTop: 8 }}>{opp.distanceText}</Text>

          {pillLabel ? <Pill label={pillLabel} /> : null}
        </View>

        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#071022",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 34 }}>{opp.emoji ?? "🗺️"}</Text>
        </View>
      </View>

      <View style={{ height: 12 }} />

      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <TouchableOpacity
          onPress={onToggleSave}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#1F2937",
            backgroundColor: "#0A1730",
          }}
        >
          <Text style={{ color: "#CBD5E1", fontWeight: "900" }}>
            {saved ? t("driver.opps.actions.saved", "Enregistré ✅") : t("driver.opps.actions.save", "Enregistrer")}
          </Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        <TouchableOpacity
          onPress={onJoin}
          disabled={joined}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 14,
            backgroundColor: joined ? "#111827" : "#2563EB",
          }}
        >
          <Text style={{ color: "white", fontWeight: "900" }}>
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
  const navigation = useNavigation<any>();
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

  // Notifications
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
        // ✅ FIX TS: utiliser l'enum (pas "date")
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

  // Supabase: SAVED
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

  // JOINED
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

  const allOpps: Opportunity[] = useMemo(
    () => [
      {
        id: "opp_lga_peak",
        category: "airports",
        dayOffset: 0,
        timeRange: "21 h 00 – 00 h 00",
        title: t("driver.opps.demo.lga.title", "Revenus maximal à LGA"),
        subtitle: t("driver.opps.demo.lga.subtitle", "Estimation de revenus très élevés"),
        distanceText: t("driver.opps.demo.lga.distance", "À 7.4 mi de distance"),
        tag: t("driver.opps.tags.recommended", "Recommandé"),
        ctaLabel: t("driver.opps.actions.join", "S’inscrire"),
        emoji: "✈️",
      },
      {
        id: "opp_jfk_queue",
        category: "airports",
        dayOffset: 1,
        timeRange: "18 h 00 – 22 h 00",
        title: t("driver.opps.demo.jfk.title", "Zone JFK : forte demande"),
        subtitle: t("driver.opps.demo.jfk.subtitle", "Positionne-toi avant le pic du soir."),
        distanceText: t("driver.opps.demo.jfk.distance", "Zone aéroport"),
        tag: t("driver.opps.tags.soon", "Bientôt"),
        ctaLabel: t("driver.opps.actions.view", "Voir"),
        emoji: "🛬",
      },
      {
        id: "opp_reservations_morning",
        category: "reservations",
        dayOffset: 1,
        timeRange: "06 h 00 – 10 h 00",
        title: t("driver.opps.demo.resMorning.title", "Bloc Réservations du matin"),
        subtitle: t("driver.opps.demo.resMorning.subtitle", "Active les réservations pour sécuriser tes courses."),
        distanceText: t("driver.opps.demo.resMorning.distance", "Rayon: 3–5 miles"),
        tag: t("driver.opps.tags.new", "Nouveau"),
        ctaLabel: t("driver.opps.actions.activate", "Activer"),
        emoji: "📅",
      },
      {
        id: "opp_event_brooklyn",
        category: "events",
        dayOffset: 3,
        timeRange: "22 h 30 – 23 h 30",
        title: t("driver.opps.demo.bkEvent.title", "Événement : forte demande à Brooklyn"),
        subtitle: t("driver.opps.demo.bkEvent.subtitle", "Prépare-toi à des demandes plus élevées dans la zone."),
        distanceText: t("driver.opps.demo.bkEvent.distance", "Zone évènement"),
        tag: t("driver.opps.tags.soon", "Bientôt"),
        ctaLabel: t("driver.opps.actions.view", "Voir"),
        emoji: "🎟️",
      },
      {
        id: "opp_boost_airport",
        category: "promotions",
        dayOffset: 0,
        timeRange: "22 h 00 – 00 h 00",
        title: t("driver.opps.demo.boost.title", "Obtiens +4,50 $ US de plus sur chaque course"),
        subtitle: t("driver.opps.demo.boost.subtitle", "Amplificateur+ • Courses seulement"),
        distanceText: t("driver.opps.demo.boost.distance", "Zone aéroport"),
        tag: t("driver.opps.tags.boost", "Boost"),
        ctaLabel: t("driver.opps.actions.join", "S’inscrire"),
        emoji: "💸",
      },
      {
        id: "opp_promo_night",
        category: "promotions",
        dayOffset: 2,
        timeRange: "20 h 00 – 02 h 00",
        title: t("driver.opps.demo.night.title", "Bonus nuit : +2,00 $ par course"),
        subtitle: t("driver.opps.demo.night.subtitle", "Valable sur certaines zones."),
        distanceText: t("driver.opps.demo.night.distance", "Zones sélectionnées"),
        tag: t("driver.opps.tags.promo", "Promo"),
        ctaLabel: t("driver.opps.actions.view", "Voir"),
        emoji: "🌙",
      },
    ],
    [t]
  );

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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
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
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>{t("common.back", "← Retour")}</Text>
        </TouchableOpacity>

        <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>{t("driver.opps.title", "Opportunités")}</Text>

        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
          <Text style={{ color: "#9CA3AF", marginTop: 10 }}>{t("shared.common.loading", "Chargement…")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          <Card title={t("driver.opps.scoreCard.title", "Ton score")}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <StarsRow rating={avgRating} count={ratingCount} size={14} />
                  <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                    {scoreLabel}
                    {ratingCount ? ` (${ratingCount})` : ""}
                  </Text>
                </View>
                <Pill label={platformLabel} />
              </View>

              <View
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#111827",
                  backgroundColor: "#0B1220",
                }}
              >
                <Text style={{ color: "#CBD5E1", fontWeight: "900" }}>{t("driver.opps.scoreCard.badge", "Occasions")}</Text>
              </View>
            </View>
          </Card>

          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Chip
                label={t("driver.opps.tabs.savedWithCount", "Occasions enregistrées ({{count}})", { count: savedCount })}
                active={category === "saved"}
                onPress={() => setCategory("saved")}
              />
              <Chip label={t("driver.opps.tabs.promotions", "Promotions")} active={category === "promotions"} onPress={() => setCategory("promotions")} />
              <Chip label={t("driver.opps.tabs.airports", "Aéroports")} active={category === "airports"} onPress={() => setCategory("airports")} />
              <Chip label={t("driver.opps.tabs.reservations", "Réservations")} active={category === "reservations"} onPress={() => setCategory("reservations")} />
              <Chip label={t("driver.opps.tabs.events", "Événements")} active={category === "events"} onPress={() => setCategory("events")} />
            </ScrollView>
          </View>

          <View style={{ marginBottom: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {days.map((d) => (
                <DayChip key={String(d.offset)} date={d.date} active={selectedDayOffset === d.offset} onPress={() => setSelectedDayOffset(d.offset)} />
              ))}
            </ScrollView>
          </View>

          <View style={{ paddingVertical: 8 }}>
            <Text style={{ color: "white", fontSize: 22, fontWeight: "900" }}>{headerDateLabel}</Text>
          </View>

          {filteredOpps.length === 0 ? (
            <View
              style={{
                backgroundColor: "#0B1220",
                borderColor: "#111827",
                borderWidth: 1,
                borderRadius: 18,
                padding: 14,
                marginTop: 8,
              }}
            >
              <Text style={{ color: "#9CA3AF", fontWeight: "900", lineHeight: 20 }}>
                {t("driver.opps.empty", "Aucune opportunité pour ce jour dans cet onglet.")}
              </Text>
              <Pill label={t("driver.opps.tags.soon", "Bientôt")} />
            </View>
          ) : (
            <View style={{ marginTop: 8 }}>
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

          <Text style={{ color: "#6B7280", marginTop: 16, fontWeight: "700" }}>
            {t("driver.opps.footer", "{{platform}} • Opportunités Chauffeur MMD", { platform: platformLabel })}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}