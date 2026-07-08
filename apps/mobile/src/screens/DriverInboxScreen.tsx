import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import ScreenHeader from "../components/navigation/ScreenHeader";

type OrderRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  driver_id: string | null;
  restaurant_name: string | null;
  kind: string | null;

  client_id?: string | null;
  restaurant_id?: string | null;
};

type MsgRow = {
  order_id: string;
  user_id: string | null;
  text: string | null;
  created_at: string;
};

const BG = "#020617";
const CARD = "rgba(15,23,42,0.78)";
const CARD_DEEP = "rgba(2,6,23,0.72)";
const BORDER = "rgba(148,163,184,0.14)";
const PURPLE = "#A78BFA";
const BLUE = "#60A5FA";
const GREEN = "#22C55E";
const TEXT = "#F8FAFC";
const MUTED = "#94A3B8";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isInProgress(status?: string | null) {
  const s = (status ?? "").toLowerCase();
  return [
    "pending",
    "accepted",
    "preparing",
    "prepared",
    "ready",
    "picked_up",
    "dispatched",
    "en_route",
  ].includes(s);
}

export function DriverInboxScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();

  const mountedRef = useRef(true);

  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [lastMsgByOrder, setLastMsgByOrder] = useState<Record<string, MsgRow | undefined>>({});
  const [lastReadByOrder, setLastReadByOrder] = useState<Record<string, string | undefined>>({});
  const [me, setMe] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSet = useCallback((fn: () => void) => {
    if (mountedRef.current) fn();
  }, []);

  const locale = useMemo(() => {
    const lng = (i18n.language || "en").toLowerCase();
    if (lng.startsWith("fr")) return "fr-FR";
    if (lng.startsWith("ar")) return "ar";
    return "en-US";
  }, [i18n.language]);

  const fmtShortDateTime = useCallback(
    (iso?: string | null) => {
      if (!iso) return "—";
      const d = new Date(iso);
      const dd = d.toLocaleDateString(locale, { day: "2-digit", month: "short" });
      const tt = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
      return `${dd} ${tt}`;
    },
    [locale]
  );

  const safeMsgText = useCallback(
    (m?: MsgRow | null) => {
      if (!m) return t("driver.inbox.msg.none", "No messages");
      const s = (m.text ?? "").toString().trim();
      return s.length > 0 ? s : t("driver.inbox.msg.attachment", "Attachment");
    },
    [t]
  );

  const isUnread = useCallback(
    (orderId: string) => {
      const last = lastMsgByOrder[orderId];
      if (!last?.created_at) return false;

      const lastMsgTs = new Date(last.created_at).getTime();
      const lastReadIso = lastReadByOrder[orderId];
      if (!lastReadIso) return true;

      const lastReadTs = new Date(lastReadIso).getTime();
      return lastMsgTs > lastReadTs;
    },
    [lastMsgByOrder, lastReadByOrder]
  );

  const fetchInbox = useCallback(async () => {
    try {
      safeSet(() => setLoading(true));

      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id ?? null;

      if (!uid) {
        safeSet(() => {
          setMe(null);
          setOrders([]);
          setLastMsgByOrder({});
          setLastReadByOrder({});
        });

        Alert.alert(
          t("driver.inbox.auth_title", "Login"),
          t("driver.inbox.auth_body", "Log in as a driver to view your inbox.")
        );
        return;
      }

      safeSet(() => setMe(uid));

      const now = new Date();
      const from = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
      const fromISO = from.toISOString();

      const baseSelect = "id, created_at, status, driver_id, restaurant_name, kind";
      const INBOX_ORDER_LIMIT = 50;
      const INBOX_MESSAGE_LIMIT = 120;

      const { data: inProgress, error: e1 } = await supabase
        .from("orders")
        .select(baseSelect)
        .eq("driver_id", uid)
        .neq("status", "delivered")
        .order("created_at", { ascending: false })
        .limit(INBOX_ORDER_LIMIT);

      if (e1) throw e1;

      const { data: delivered7d, error: e2 } = await supabase
        .from("orders")
        .select(baseSelect)
        .eq("driver_id", uid)
        .eq("status", "delivered")
        .gte("created_at", fromISO)
        .order("created_at", { ascending: false })
        .limit(INBOX_ORDER_LIMIT);

      if (e2) throw e2;

      const mergedMap = new Map<string, OrderRow>();
      (inProgress ?? []).forEach((o: any) => mergedMap.set(o.id, o as OrderRow));
      (delivered7d ?? []).forEach((o: any) => mergedMap.set(o.id, o as OrderRow));

      const merged = Array.from(mergedMap.values()).sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });

      safeSet(() => setOrders(merged));

      const ids = merged.slice(0, INBOX_ORDER_LIMIT).map((o) => o.id);
      if (ids.length === 0) {
        safeSet(() => {
          setLastMsgByOrder({});
          setLastReadByOrder({});
        });
        return;
      }

      const { data: msgs, error: e3 } = await supabase
        .from("order_messages")
        .select("order_id, user_id, text, created_at")
        .in("order_id", ids)
        .order("created_at", { ascending: false })
        .limit(INBOX_MESSAGE_LIMIT);

      if (e3) {
        console.log("⚠️ order_messages preview error:", e3);
        safeSet(() => setLastMsgByOrder({}));
      } else {
        const map: Record<string, MsgRow> = {};
        for (const m of (msgs ?? []) as any[]) {
          const oid = m.order_id as string;
          if (!map[oid]) map[oid] = m as MsgRow;
        }
        safeSet(() => setLastMsgByOrder(map));
      }

      const { data: reads, error: e4 } = await supabase
        .from("order_chat_reads")
        .select("order_id, user_id, last_read_at")
        .eq("user_id", uid)
        .in("order_id", ids);

      if (e4) {
        console.log("⚠️ order_chat_reads error:", e4);
        safeSet(() => setLastReadByOrder({}));
      } else {
        const rmap: Record<string, string> = {};
        for (const r of (reads ?? []) as any[]) {
          rmap[r.order_id] = r.last_read_at;
        }
        safeSet(() => setLastReadByOrder(rmap));
      }
    } catch (e: any) {
      console.log("fetchInbox error:", e);
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Error"),
        e?.message ?? t("driver.inbox.load_error", "Unable to load inbox.")
      );

      safeSet(() => {
        setOrders([]);
        setLastMsgByOrder({});
        setLastReadByOrder({});
      });
    } finally {
      safeSet(() => setLoading(false));
    }
  }, [safeSet, t]);

  useFocusEffect(
    useCallback(() => {
      void fetchInbox();
    }, [fetchInbox])
  );

  useEffect(() => {
    void fetchInbox();
  }, [fetchInbox]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return orders;

    return orders.filter((o) => {
      const id8 = (o.id ?? "").slice(0, 8).toLowerCase();
      const r = (o.restaurant_name ?? "").toLowerCase();
      const st = (o.status ?? "").toLowerCase();
      return id8.includes(s) || r.includes(s) || st.includes(s);
    });
  }, [orders, q]);

  const inProgressOrders = useMemo(
    () => filtered.filter((o) => isInProgress(o.status)),
    [filtered]
  );

  const deliveredOrders = useMemo(
    () => filtered.filter((o) => (o.status ?? "").toLowerCase() === "delivered"),
    [filtered]
  );

  const openChat = useCallback(
    (orderId: string) => {
      navigation.navigate("DriverChat", { orderId });
    },
    [navigation]
  );

  const unreadCount = useMemo(() => {
    if (!me) return 0;
    let n = 0;
    for (const o of filtered) {
      if (isUnread(o.id)) n += 1;
    }
    return n;
  }, [filtered, isUnread, me]);

  const headerSub = useMemo(() => {
    const base = t("driver.inbox.header.subtitle_base", "In progress + delivered (7 days)");
    if (unreadCount <= 0) return base;

    return `${base} • ${t("driver.inbox.header.unread_count", "{{count}} unread", {
      count: unreadCount,
    })}`;
  }, [t, unreadCount]);

  function OrderCard({ o }: { o: OrderRow }) {
    const last = lastMsgByOrder[o.id];
    const title = o.restaurant_name ?? t("driver.inbox.order.fallback_title", "Order");
    const subtitle = safeMsgText(last);

    const delivered = (o.status ?? "").toLowerCase() === "delivered";
    const unread = isUnread(o.id);

    const badge = delivered
      ? {
          text: t("driver.inbox.badge.delivered", "Delivered"),
          bg: "rgba(34,197,94,0.12)",
          border: "rgba(34,197,94,0.3)",
          color: "#BBF7D0",
        }
      : {
          text: t("driver.inbox.badge.in_progress", "In progress"),
          bg: "rgba(96,165,250,0.12)",
          border: "rgba(96,165,250,0.36)",
          color: "#BFDBFE",
        };

    return (
      <TouchableOpacity
        onPress={() => openChat(o.id)}
        style={[styles.orderCard, unread && styles.orderCardUnread]}
        activeOpacity={0.86}
      >
        <View style={styles.orderTopRow}>
          <View style={styles.orderIconBox}>
            <Text style={styles.orderIcon}>{delivered ? "✓" : "✉"}</Text>
          </View>

          <View style={styles.orderContent}>
            <View style={styles.titleRow}>
              <Text style={styles.orderTitle} numberOfLines={1}>{title}</Text>
              {unread ? (
                <View style={styles.unreadPill}>
                  <Text style={styles.unreadText}>{t("driver.inbox.badge.unread", "Unread")}</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.messagePreview} numberOfLines={2}>{subtitle}</Text>

            <Text style={styles.metaLine} numberOfLines={1}>
              #{o.id.slice(0, 8)} • {fmtShortDateTime(o.created_at)} • {(o.status ?? "—").toUpperCase()}
            </Text>
          </View>

          <View style={[styles.statusPill, { backgroundColor: badge.bg, borderColor: badge.border }]}>
            <Text style={[styles.statusText, { color: badge.color }]}>{badge.text}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <View style={styles.headerWrap}>
        <ScreenHeader
          title={t("driver.inbox.title", "Inbox")}
          subtitle={headerSub}
          fallbackRoute="DriverTabs"
          showBack={navigation.canGoBack()}
          variant="dark"
          rightSlot={
            <TouchableOpacity
              onPress={() => void fetchInbox()}
              style={[styles.refreshButton, loading && { opacity: 0.65 }]}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text style={styles.refreshText}>
                {loading ? t("shared.common.loadingEllipsis", "…") : t("shared.common.refresh", "Refresh")}
              </Text>
            </TouchableOpacity>
          }
        />

        <View style={styles.heroCard}>
          <View>
            <Text style={styles.heroLabel}>{t("driver.inbox.hero.label", "Driver messages")}</Text>
            <Text style={styles.heroTitle}>{unreadCount > 0 ? `${unreadCount}` : "0"}</Text>
            <Text style={styles.heroSub}>{t("driver.inbox.hero.unread", "unread conversation(s)")}</Text>
          </View>

          <View style={styles.heroIconWrap}>
            <Text style={styles.heroIcon}>✉</Text>
          </View>
        </View>

        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t("driver.inbox.search_placeholder", "Search (#id, restaurant, status)…")}
            placeholderTextColor="#64748B"
            style={styles.searchInput}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.loadingText}>{t("shared.common.loading", "Loading…")}</Text>
          </View>
        ) : me == null ? (
          <EmptyState text={t("driver.inbox.not_logged_in", "Log in as a driver to view your conversations.")} />
        ) : filtered.length === 0 ? (
          <EmptyState text={t("driver.inbox.empty", "No orders found (in progress / delivered last 7 days).")} />
        ) : (
          <View style={styles.sectionsWrap}>
            <SectionHeader
              title={t("driver.inbox.sections.in_progress", "In progress")}
              count={inProgressOrders.length}
            />

            {inProgressOrders.length === 0 ? (
              <EmptyState compact text={t("driver.inbox.sections.in_progress_empty", "No in-progress orders.")} />
            ) : (
              <View style={styles.listGap}>
                {inProgressOrders.map((o) => <OrderCard key={o.id} o={o} />)}
              </View>
            )}

            <SectionHeader
              title={t("driver.inbox.sections.delivered_7d", "Delivered (7 days)")}
              count={deliveredOrders.length}
            />

            {deliveredOrders.length === 0 ? (
              <EmptyState compact text={t("driver.inbox.sections.delivered_empty", "No delivered orders in the last 7 days.")} />
            ) : (
              <View style={styles.listGap}>
                {deliveredOrders.map((o) => <OrderCard key={o.id} o={o} />)}
              </View>
            )}
          </View>
        )}

        {me ? (
          <Text style={styles.driverDebug}>{t("driver.inbox.driver_label", "Driver")}: {me.slice(0, 8)}…</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.countPill}>
        <Text style={styles.countText}>{count}</Text>
      </View>
    </View>
  );
}

function EmptyState({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <View style={[styles.emptyState, compact && styles.emptyStateCompact]}>
      <Text style={styles.emptyIcon}>◇</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  headerWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  roundButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: CARD_DEEP,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { color: "#BFDBFE", fontSize: 18, fontWeight: "900" },
  headerCenter: { flex: 1, alignItems: "center", paddingHorizontal: 10 },
  headerTitle: { color: TEXT, fontWeight: "900", fontSize: 17, letterSpacing: 0.2 },
  headerSub: { color: MUTED, marginTop: 2, fontWeight: "800", fontSize: 11, maxWidth: 210 },
  refreshButton: {
    height: 42,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: CARD_DEEP,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshText: { color: TEXT, fontWeight: "900", fontSize: 12 },
  heroCard: {
    marginTop: 14,
    borderRadius: 28,
    padding: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.2)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#8B5CF6",
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  heroLabel: { color: MUTED, fontWeight: "900", fontSize: 12 },
  heroTitle: { color: TEXT, fontWeight: "900", fontSize: 38, marginTop: 2 },
  heroSub: { color: "#CBD5E1", fontWeight: "800", marginTop: 2 },
  heroIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: "rgba(139,92,246,0.16)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroIcon: { color: PURPLE, fontSize: 28, fontWeight: "900" },
  searchBox: {
    marginTop: 12,
    height: 50,
    borderRadius: 18,
    paddingHorizontal: 13,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
  },
  searchIcon: { color: "#64748B", fontSize: 18, fontWeight: "900", marginRight: 8 },
  searchInput: { flex: 1, color: TEXT, fontWeight: "800", height: "100%" },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 30 },
  loadingRow: { marginTop: 12, flexDirection: "row", alignItems: "center" },
  loadingText: { color: MUTED, fontWeight: "800", marginLeft: 10 },
  sectionsWrap: { gap: 12 },
  sectionHeader: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { color: TEXT, fontSize: 22, fontWeight: "900" },
  countPill: {
    minWidth: 34,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(139,92,246,0.14)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { color: PURPLE, fontSize: 12, fontWeight: "900" },
  listGap: { gap: 10 },
  orderCard: {
    borderRadius: 22,
    padding: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  orderCardUnread: {
    borderColor: "rgba(96,165,250,0.75)",
    shadowColor: BLUE,
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  orderTopRow: { flexDirection: "row", alignItems: "flex-start" },
  orderIconBox: {
    width: 44,
    height: 44,
    borderRadius: 16,
    marginRight: 12,
    backgroundColor: "rgba(139,92,246,0.14)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  orderIcon: { color: PURPLE, fontSize: 18, fontWeight: "900" },
  orderContent: { flex: 1, minWidth: 0, paddingRight: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  orderTitle: { flex: 1, color: TEXT, fontSize: 17, fontWeight: "900" },
  unreadPill: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(239,68,68,0.14)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
  },
  unreadText: { color: "#FCA5A5", fontWeight: "900", fontSize: 10 },
  messagePreview: { color: MUTED, marginTop: 6, fontWeight: "700", lineHeight: 18 },
  metaLine: { color: "#64748B", marginTop: 8, fontSize: 12, fontWeight: "800" },
  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  statusText: { fontWeight: "900", fontSize: 11 },
  emptyState: {
    marginTop: 12,
    borderRadius: 22,
    padding: 18,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
  },
  emptyStateCompact: { marginTop: 0, padding: 14 },
  emptyIcon: { color: PURPLE, fontSize: 24, fontWeight: "900", marginBottom: 6 },
  emptyText: { color: MUTED, fontWeight: "800", textAlign: "center", lineHeight: 20 },
  driverDebug: { color: "#334155", marginTop: 18, fontSize: 11 },
});
