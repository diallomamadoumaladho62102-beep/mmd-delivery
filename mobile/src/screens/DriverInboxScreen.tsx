import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

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

  // ✅ locale dynamique selon i18n
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

      const { data: inProgress, error: e1 } = await supabase
        .from("orders")
        .select(baseSelect)
        .eq("driver_id", uid)
        .neq("status", "delivered")
        .order("created_at", { ascending: false });

      if (e1) throw e1;

      const { data: delivered7d, error: e2 } = await supabase
        .from("orders")
        .select(baseSelect)
        .eq("driver_id", uid)
        .eq("status", "delivered")
        .gte("created_at", fromISO)
        .order("created_at", { ascending: false });

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

      const ids = merged.map((o) => o.id);
      if (ids.length === 0) {
        safeSet(() => {
          setLastMsgByOrder({});
          setLastReadByOrder({});
        });
        return;
      }

      // ✅ dernier message par order
      const { data: msgs, error: e3 } = await supabase
        .from("order_messages")
        .select("order_id, user_id, text, created_at")
        .in("order_id", ids)
        .order("created_at", { ascending: false });

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

      // ✅ last_read_at
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
          border: "#14532D",
          color: "#BBF7D0",
        }
      : {
          text: t("driver.inbox.badge.in_progress", "In progress"),
          bg: "rgba(59,130,246,0.12)",
          border: "#1D4ED8",
          color: "#BFDBFE",
        };

    return (
      <TouchableOpacity
        onPress={() => openChat(o.id)}
        style={{
          borderRadius: 18,
          padding: 14,
          backgroundColor: "rgba(15,23,42,0.65)",
          borderWidth: 1,
          borderColor: unread ? "rgba(59,130,246,0.8)" : "#1F2937",
        }}
        activeOpacity={0.85}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }} numberOfLines={1}>
                {title}
              </Text>

              {unread && (
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 999,
                    backgroundColor: "rgba(239,68,68,0.14)",
                    borderWidth: 1,
                    borderColor: "#7F1D1D",
                  }}
                >
                  <Text style={{ color: "#FCA5A5", fontWeight: "900", fontSize: 11 }}>
                    {t("driver.inbox.badge.unread", "Unread")}
                  </Text>
                </View>
              )}
            </View>

            <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "700", lineHeight: 18 }} numberOfLines={2}>
              {subtitle}
            </Text>

            <Text style={{ color: "#64748B", marginTop: 8, fontSize: 12, fontWeight: "800" }}>
              #{o.id.slice(0, 8)} • {fmtShortDateTime(o.created_at)} • {(o.status ?? "—").toUpperCase()}
            </Text>
          </View>

          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: badge.bg,
              borderWidth: 1,
              borderColor: badge.border,
            }}
          >
            <Text style={{ color: badge.color, fontWeight: "900", fontSize: 12 }}>{badge.text}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingVertical: 8, paddingRight: 10 }}>
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
              {t("shared.common.backArrowOnly", "←")}
            </Text>
          </TouchableOpacity>

          <View style={{ alignItems: "center" }}>
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
              {t("driver.inbox.title", "Inbox")}
            </Text>
            <Text style={{ color: "#9CA3AF", marginTop: 2, fontWeight: "800", fontSize: 12 }}>
              {headerSub}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => void fetchInbox()}
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
              {loading ? t("shared.common.loadingEllipsis", "…") : t("shared.common.refresh", "Refresh")}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: 10 }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t("driver.inbox.search_placeholder", "Search (#id, restaurant, status)…")}
            placeholderTextColor="#64748B"
            style={{
              height: 46,
              borderRadius: 16,
              paddingHorizontal: 12,
              backgroundColor: "rgba(15,23,42,0.65)",
              borderWidth: 1,
              borderColor: "#1F2937",
              color: "white",
              fontWeight: "700",
            }}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        {loading ? (
          <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
              {t("shared.common.loading", "Loading…")}
            </Text>
          </View>
        ) : me == null ? (
          <Text style={{ color: "#9CA3AF", marginTop: 12 }}>
            {t("driver.inbox.not_logged_in", "Log in as a driver to view your conversations.")}
          </Text>
        ) : filtered.length === 0 ? (
          <Text style={{ color: "#9CA3AF", marginTop: 12 }}>
            {t("driver.inbox.empty", "No orders found (in progress / delivered last 7 days).")}
          </Text>
        ) : (
          <View style={{ gap: 14 }}>
            <Text style={{ color: "white", fontSize: 22, fontWeight: "900" }}>
              {t("driver.inbox.sections.in_progress", "In progress")}
            </Text>

            {inProgressOrders.length === 0 ? (
              <Text style={{ color: "#9CA3AF" }}>
                {t("driver.inbox.sections.in_progress_empty", "No in-progress orders.")}
              </Text>
            ) : (
              <View style={{ gap: 10 }}>
                {inProgressOrders.map((o) => (
                  <OrderCard key={o.id} o={o} />
                ))}
              </View>
            )}

            <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 8 }}>
              {t("driver.inbox.sections.delivered_7d", "Delivered (7 days)")}
            </Text>

            {deliveredOrders.length === 0 ? (
              <Text style={{ color: "#9CA3AF" }}>
                {t("driver.inbox.sections.delivered_empty", "No delivered orders in the last 7 days.")}
              </Text>
            ) : (
              <View style={{ gap: 10 }}>
                {deliveredOrders.map((o) => (
                  <OrderCard key={o.id} o={o} />
                ))}
              </View>
            )}
          </View>
        )}

        {me && (
          <Text style={{ color: "#334155", marginTop: 18, fontSize: 11 }}>
            {t("driver.inbox.driver_label", "Driver")}: {me.slice(0, 8)}…
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
