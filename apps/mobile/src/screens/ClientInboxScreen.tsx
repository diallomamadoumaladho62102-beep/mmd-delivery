import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  Image,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
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
import {
  MMD_BLUE,
  MMD_CARD_ON_BLUE,
  MMD_FONT,
  MMD_GREEN,
  MMD_LINK_BLUE,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
  mmdLogoSizeCompact,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

type OrderRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  client_id: string | null;
  restaurant_name: string | null;
};

type MsgRow = {
  order_id: string;
  created_at: string;
  text: string | null;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function safeMsgText(m?: MsgRow | null) {
  if (!m) return null;
  const s = (m.text ?? "").toString().trim();
  return s.length > 0 ? s : null;
}

function isInProgress(status?: string | null) {
  const s = (status ?? "").toLowerCase();
  return ["pending", "accepted", "preparing", "ready", "picked_up", "dispatched", "en_route"].includes(s);
}

export function ClientInboxScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();
  const { width, height } = useWindowDimensions();
  const logoSize = mmdLogoSizeCompact(width, height);

  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [lastMsgByOrder, setLastMsgByOrder] = useState<Record<string, MsgRow | undefined>>({});
  const [me, setMe] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const locale = (i18n.resolvedLanguage || i18n.language || "en").toLowerCase();

  const fmtShortDateTime = useCallback(
    (iso?: string | null) => {
      if (!iso) return "—";
      const d = new Date(iso);
      const loc = locale === "zh" ? "zh-CN" : locale;
      const dd = d.toLocaleDateString(loc, { day: "2-digit", month: "short" });
      const tt = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
      return `${dd} ${tt}`;
    },
    [locale]
  );

  const fetchInbox = useCallback(async () => {
    try {
      setLoading(true);

      await withTimeout(
        (async () => {
          const { data: sessionData } = await supabase.auth.getSession();
          const uid = sessionData.session?.user?.id ?? null;

          if (!uid) {
            setMe(null);
            setOrders([]);
            setLastMsgByOrder({});
            Alert.alert(
              t("auth.title", "Connexion"),
              t("client.inbox.alerts.loginAsClient", "Connecte-toi comme client.")
            );
            return;
          }

          setMe(uid);

          const now = new Date();
          const from = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
          const fromISO = from.toISOString();

          const baseSelect =
            "id, created_at, status, client_id, restaurant_name, is_test, hidden_from_user, archived_at";

          const { data: inProgress, error: e1 } = await applyLiveTripFilters(
            supabase.from("orders").select(baseSelect),
          )
            .eq("client_id", uid)
            .neq("status", "delivered")
            .order("created_at", { ascending: false });

          if (e1) throw e1;

          const { data: delivered7d, error: e2 } = await applyLiveTripFilters(
            supabase.from("orders").select(baseSelect),
          )
            .eq("client_id", uid)
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

          setOrders(merged);

          const ids = merged.map((o) => o.id);
          if (ids.length === 0) {
            setLastMsgByOrder({});
            return;
          }

          const { data: msgs, error: e3 } = await supabase
            .from("order_messages")
            .select("order_id, text, created_at")
            .in("order_id", ids)
            .order("created_at", { ascending: false });

          if (e3) {
            console.log("⚠️ order_messages preview error:", e3);
            setLastMsgByOrder({});
            return;
          }

          const map: Record<string, MsgRow> = {};
          for (const m of (msgs ?? []) as any[]) {
            const oid = m.order_id as string;
            if (!map[oid]) map[oid] = m as MsgRow;
          }

          setLastMsgByOrder(map);
        })(),
        CLIENT_SCREEN_FETCH_TIMEOUT_MS,
        "client_inbox_fetch",
      );
    } catch (e: any) {
      console.log("ClientInbox fetch error:", e);
      Alert.alert(
        t("common.error", "Erreur"),
        e?.message ?? t("client.inbox.errors.loadFailed", "Impossible de charger la boîte.")
      );
      setOrders([]);
      setLastMsgByOrder({});
    } finally {
      setLoading(false);
    }
  }, [t]);

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

  const openChat = (orderId: string) => navigation.navigate("ClientChat", { orderId });

  function Card({ o }: { o: OrderRow }) {
    const last = lastMsgByOrder[o.id];
    const delivered = (o.status ?? "").toLowerCase() === "delivered";

    const badge = delivered
      ? {
          text: t("client.inbox.badges.delivered", "Livrée"),
          bg: MMD_GREEN,
          border: "#14532D",
          color: MMD_WHITE,
        }
      : {
          text: t("client.inbox.badges.inProgress", "En cours"),
          bg: "#C5B722",
          border: "rgba(197,175,34,0.96)",
          color: MMD_WHITE,
        };

    const lastText =
      safeMsgText(last) ??
      t("client.inbox.lastMessage.none", "Aucun message");

    const attachmentFallback = t("client.inbox.lastMessage.attachment", "Pièce jointe");

    const shownLast =
      safeMsgText(last) != null ? lastText : attachmentFallback;

    return (
      <TouchableOpacity
        onPress={() => openChat(o.id)}
        style={styles.card}
        activeOpacity={0.85}
      >
        <View style={styles.cardRow}>
          <View style={styles.cardCopy}>
            <Text style={styles.cardTitle}>
              {o.restaurant_name ?? t("client.inbox.orderFallback", "Commande")}
            </Text>

            <Text style={styles.cardPreview}>{shownLast}</Text>

            <Text style={styles.cardMeta} numberOfLines={1}>
              #{o.id.slice(0, 8)} • {fmtShortDateTime(o.created_at)} • {(o.status ?? "—").toUpperCase()}
            </Text>
          </View>

          <View
            style={[
              styles.badge,
              { backgroundColor: badge.bg, borderColor: badge.border },
            ]}
          >
            <Text style={[styles.badgeText, { color: badge.color }]}>
              {badge.text}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  const showLoadingSplash = loading && orders.length === 0;
  const showEmpty =
    !loading && me != null && filtered.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("client.inbox.title", "Boîte")}
        subtitle={t("client.inbox.subtitle", "En cours + livrées (7 jours)")}
        fallbackRoute="ClientHome"
        variant="dark"
        rightSlot={
          <TouchableOpacity
            onPress={() => void fetchInbox()}
            style={styles.refreshBtn}
            activeOpacity={0.85}
          >
            <Text style={styles.refreshText}>
              {loading ? "..." : t("common.refresh", "Rafraîchir")}
            </Text>
          </TouchableOpacity>
        }
      />

      {!showLoadingSplash && !showEmpty ? (
        <View style={styles.searchWrap}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t("client.inbox.search.placeholder", "Rechercher (#id, restaurant, statut)…")}
            placeholderTextColor={MMD_TEXT_MUTED_BLUE}
            style={styles.searchInput}
          />
        </View>
      ) : null}

      {showLoadingSplash ? (
        <View style={styles.splash}>
          <Image
            source={MMD_LOGO}
            style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2 }}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.splashBrand}>MMD Delivery</Text>
          <Text style={styles.splashSub}>
            {t("client.inbox.loading.prepare", "Preparing your inbox...")}
          </Text>
          <ActivityIndicator color={MMD_WHITE} style={{ marginTop: 8 }} />
          <Text style={styles.splashSub}>{t("shared.common.loading", "Loading...")}</Text>
        </View>
      ) : showEmpty ? (
        <View style={styles.splash}>
          <Image
            source={MMD_LOGO}
            style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2 }}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.splashBrand}>{t("client.inbox.title", "Inbox")}</Text>
          <Text style={styles.emptyTitle}>
            {t("client.inbox.empty.noConversations", "No conversations yet")}
          </Text>
          <Text style={styles.emptyBody}>
            {t(
              "client.inbox.empty.hint",
              "Your chats with drivers and support will show up here."
            )}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {me == null ? (
            <Text style={styles.muted}>
              {t("client.inbox.empty.notLoggedIn", "Connecte-toi comme client pour voir tes conversations.")}
            </Text>
          ) : (
            <View style={styles.sections}>
              <Text style={styles.sectionTitle}>
                {t("client.inbox.sections.inProgress", "En cours")}
              </Text>

              {inProgressOrders.length === 0 ? (
                <Text style={styles.muted}>
                  {t("client.inbox.sections.inProgressEmpty", "Aucune commande en cours.")}
                </Text>
              ) : (
                <View style={styles.listGap}>
                  {inProgressOrders.map((o) => (
                    <Card key={o.id} o={o} />
                  ))}
                </View>
              )}

              <Text style={[styles.sectionTitle, { marginTop: 8 }]}>
                {t("client.inbox.sections.delivered7d", "Livrées (7 jours)")}
              </Text>

              {deliveredOrders.length === 0 ? (
                <Text style={styles.muted}>
                  {t("client.inbox.sections.deliveredEmpty", "Aucune commande livrée sur 7 jours.")}
                </Text>
              ) : (
                <View style={styles.listGap}>
                  {deliveredOrders.map((o) => (
                    <Card key={o.id} o={o} />
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  searchWrap: { paddingHorizontal: 16, paddingTop: 10 },
  searchInput: {
    height: 46,
    borderRadius: 16,
    paddingHorizontal: 12,
    backgroundColor: MMD_CARD_ON_BLUE,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
    color: MMD_WHITE,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    fontSize: 13,
  },
  refreshBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: MMD_CARD_ON_BLUE,
    borderWidth: 1,
    borderColor: MMD_STROKE,
  },
  refreshText: {
    color: MMD_TEXT,
    fontWeight: "900",
    fontFamily: MMD_FONT.extrabold,
  },
  scroll: { padding: 16, paddingBottom: 30 },
  sections: { gap: 14 },
  listGap: { gap: 10 },
  sectionTitle: {
    color: MMD_WHITE,
    fontSize: 22,
    fontWeight: "900",
    fontFamily: MMD_FONT.extrabold,
  },
  card: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: MMD_CARD_ON_BLUE,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  cardCopy: { flex: 1, paddingRight: 4, gap: 6 },
  cardTitle: {
    color: MMD_WHITE,
    fontSize: 18,
    fontWeight: "900",
    fontFamily: MMD_FONT.extrabold,
  },
  cardPreview: {
    color: MMD_TEXT_MUTED_BLUE,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    fontSize: 14,
    lineHeight: 18,
  },
  cardMeta: {
    color: MMD_LINK_BLUE,
    fontSize: 12,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontWeight: "900",
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
  },
  muted: {
    color: MMD_TEXT_MUTED_BLUE,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    marginTop: 12,
  },
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  splashBrand: {
    color: MMD_WHITE,
    fontSize: 22,
    fontWeight: "800",
    fontFamily: MMD_FONT.bold,
    textAlign: "center",
  },
  splashSub: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    textAlign: "center",
  },
  emptyTitle: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    textAlign: "center",
  },
  emptyBody: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 320,
  },
});
