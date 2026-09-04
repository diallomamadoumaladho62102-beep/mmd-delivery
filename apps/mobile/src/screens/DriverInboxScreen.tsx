import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import {
  CLIENT_SCREEN_FETCH_TIMEOUT_MS,
  withTimeout,
} from "../lib/bootFailOpen";
import { applyLiveTripFilters } from "../lib/tripVisibility";
import ScreenHeader from "../components/navigation/ScreenHeader";
import DriverBrandLoadingState from "../components/driver/DriverBrandLoadingState";
import {
  MMD_BLUE,
  MMD_CARD_BORDER,
  MMD_TEXT,
  MMD_WHITE,
} from "../theme/mmdUi";

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

const BG = MMD_BLUE;
const CARD = "rgba(0,45,145,0.5)";
const CARD_DEEP = "rgba(0,45,145,0.4)";
const BORDER = MMD_CARD_BORDER;
const PURPLE = "#A78BFA";
const BLUE = "#60A5FA";
const GREEN = "#22C55E";
const TEXT = MMD_TEXT;
const MUTED = "#DCE6FA";

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

      await withTimeout(
        (async () => {
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

          const { data: inProgress, error: e1 } = await applyLiveTripFilters(
            supabase.from("orders").select(baseSelect),
          )
            .eq("driver_id", uid)
            .neq("status", "delivered")
            .order("created_at", { ascending: false })
            .limit(INBOX_ORDER_LIMIT);

          if (e1) throw e1;

          const { data: delivered7d, error: e2 } = await applyLiveTripFilters(
            supabase.from("orders").select(baseSelect),
          )
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
        })(),
        CLIENT_SCREEN_FETCH_TIMEOUT_MS,
        "driver_inbox_fetch",
      );
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
          <View style={styles.loadingBrand}>
            <DriverBrandLoadingState title={t("shared.common.loading", "Loading")} />
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
      {!compact ? (
        <Text style={styles.emptyTitle}>Inbox empty</Text>
      ) : null}
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
  refreshText: { color: TEXT, fontWeight: "800", fontSize: 12 },
  heroCard: {
    marginTop: 14,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: CARD_DEEP,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroLabel: { color: MUTED, fontWeight: "800", fontSize: 11 },
  heroTitle: { color: TEXT, fontWeight: "800", fontSize: 30, marginTop: 2 },
  heroSub: { color: MUTED, fontWeight: "700", marginTop: 2, fontSize: 11 },
  heroIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 22,
    backgroundColor: "rgba(139,92,246,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroIcon: { color: "#B4C8FF", fontSize: 28, fontWeight: "800" },
  searchBox: {
    marginTop: 12,
    height: 42,
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: "rgba(0,40,130,0.3)",
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
  },
  searchIcon: { color: "rgba(200,215,245,0.9)", fontSize: 18, fontWeight: "800", marginRight: 8 },
  searchInput: { flex: 1, color: TEXT, fontWeight: "400", height: "100%", fontSize: 14 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 30 },
  loadingBrand: { minHeight: 280, marginTop: 12 },
  loadingRow: { marginTop: 12, flexDirection: "row", alignItems: "center" },
  loadingText: { color: MUTED, fontWeight: "800", marginLeft: 10 },
  sectionsWrap: { gap: 16 },
  sectionHeader: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { color: TEXT, fontSize: 18, fontWeight: "800" },
  countPill: {
    minWidth: 34,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(139,92,246,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { color: MMD_WHITE, fontSize: 12, fontWeight: "800" },
  listGap: { gap: 10 },
  orderCard: {
    borderRadius: 16,
    padding: 12,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  orderCardUnread: {
    borderColor: BORDER,
  },
  orderTopRow: { flexDirection: "row", alignItems: "center" },
  orderIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    marginRight: 10,
    backgroundColor: "rgba(139,92,246,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  orderIcon: { color: MMD_WHITE, fontSize: 18, fontWeight: "800" },
  orderContent: { flex: 1, minWidth: 0, paddingRight: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  orderTitle: { flex: 1, color: TEXT, fontSize: 15, fontWeight: "800" },
  unreadPill: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(239,68,68,0.14)",
  },
  unreadText: { color: "#EF4447", fontWeight: "800", fontSize: 10 },
  messagePreview: { color: MUTED, marginTop: 3, fontWeight: "600", lineHeight: 18, fontSize: 13 },
  metaLine: { color: "#B4C8F0", marginTop: 3, fontSize: 11, fontWeight: "700" },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 0,
    alignSelf: "flex-start",
    backgroundColor: "rgba(96,165,250,0.12)",
  },
  statusText: { fontWeight: "800", fontSize: 11, color: MMD_WHITE },
  emptyState: {
    marginTop: 12,
    borderRadius: 22,
    padding: 20,
    backgroundColor: "transparent",
    alignItems: "center",
    maxWidth: 280,
    alignSelf: "center",
  },
  emptyStateCompact: { marginTop: 0, padding: 14, maxWidth: "100%" },
  emptyTitle: { color: TEXT, fontSize: 20, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  emptyText: { color: MUTED, fontWeight: "400", textAlign: "center", lineHeight: 20, fontSize: 15 },
  driverDebug: { color: "rgba(170,190,230,0.4)", marginTop: 18, fontSize: 11 },
});
