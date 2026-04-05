import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  const { t, i18n } = useTranslation(); // ✅ re-render on language change

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

      // ✅ essayer d'utiliser la locale i18n, sinon fallback
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

      const baseSelect = "id, created_at, status, client_id, restaurant_name";

      const { data: inProgress, error: e1 } = await supabase
        .from("orders")
        .select(baseSelect)
        .eq("client_id", uid)
        .neq("status", "delivered")
        .order("created_at", { ascending: false });

      if (e1) throw e1;

      const { data: delivered7d, error: e2 } = await supabase
        .from("orders")
        .select(baseSelect)
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
          bg: "rgba(34,197,94,0.12)",
          border: "#14532D",
          color: "#BBF7D0",
        }
      : {
          text: t("client.inbox.badges.inProgress", "En cours"),
          bg: "rgba(59,130,246,0.12)",
          border: "#1D4ED8",
          color: "#BFDBFE",
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
        style={{
          borderRadius: 18,
          padding: 14,
          backgroundColor: "rgba(15,23,42,0.65)",
          borderWidth: 1,
          borderColor: "#1F2937",
        }}
        activeOpacity={0.85}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
              {o.restaurant_name ?? t("client.inbox.orderFallback", "Commande")}
            </Text>

            <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "700", lineHeight: 18 }}>
              {shownLast}
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
            <Text style={{ color: badge.color, fontWeight: "900", fontSize: 12 }}>
              {badge.text}
            </Text>
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
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>←</Text>
          </TouchableOpacity>

          <View style={{ alignItems: "center" }}>
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
              {t("client.inbox.title", "Boîte")}
            </Text>
            <Text style={{ color: "#9CA3AF", marginTop: 2, fontWeight: "800", fontSize: 12 }}>
              {t("client.inbox.subtitle", "En cours + livrées (7 jours)")}
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
            activeOpacity={0.85}
          >
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
              {loading ? "..." : t("common.refresh", "Rafraîchir")}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: 10 }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t("client.inbox.search.placeholder", "Rechercher (#id, restaurant, statut)…")}
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
              {t("shared.common.loading", "Chargement…")}
            </Text>
          </View>
        ) : me == null ? (
          <Text style={{ color: "#9CA3AF", marginTop: 12 }}>
            {t("client.inbox.empty.notLoggedIn", "Connecte-toi comme client pour voir tes conversations.")}
          </Text>
        ) : filtered.length === 0 ? (
          <Text style={{ color: "#9CA3AF", marginTop: 12 }}>
            {t("client.inbox.empty.noOrders", "Aucune commande trouvée.")}
          </Text>
        ) : (
          <View style={{ gap: 14 }}>
            <Text style={{ color: "white", fontSize: 22, fontWeight: "900" }}>
              {t("client.inbox.sections.inProgress", "En cours")}
            </Text>

            {inProgressOrders.length === 0 ? (
              <Text style={{ color: "#9CA3AF" }}>
                {t("client.inbox.sections.inProgressEmpty", "Aucune commande en cours.")}
              </Text>
            ) : (
              <View style={{ gap: 10 }}>
                {inProgressOrders.map((o) => (
                  <Card key={o.id} o={o} />
                ))}
              </View>
            )}

            <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 8 }}>
              {t("client.inbox.sections.delivered7d", "Livrées (7 jours)")}
            </Text>

            {deliveredOrders.length === 0 ? (
              <Text style={{ color: "#9CA3AF" }}>
                {t("client.inbox.sections.deliveredEmpty", "Aucune commande livrée sur 7 jours.")}
              </Text>
            ) : (
              <View style={{ gap: 10 }}>
                {deliveredOrders.map((o) => (
                  <Card key={o.id} o={o} />
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
