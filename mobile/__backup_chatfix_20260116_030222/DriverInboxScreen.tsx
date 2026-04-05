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
import { supabase } from "../lib/supabase";

type OrderRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  driver_id: string | null;
  restaurant_name: string | null;
  kind: string | null;

  // optionnel si tu l’as dans ta table
  client_id?: string | null;
  restaurant_id?: string | null;
};

type MsgRow = {
  order_id: string;
  user_id: string | null;
  message: string | null;
  text?: string | null;
  created_at: string;
};

type ReadRow = {
  order_id: string;
  user_id: string;
  last_read_at: string;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtShortDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const dd = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  const tt = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${dd} ${tt}`;
}

// ✅ Aligné avec le reste du projet : on préfère "text", sinon fallback "message"
function safeMsgText(m?: MsgRow | null) {
  if (!m) return "Aucun message";
  const t = (m.text ?? (m as any).message ?? "") as string;
  const s = (t ?? "").toString().trim();
  return s.length > 0 ? s : "Pièce jointe";
}

function isInProgress(status?: string | null) {
  const s = (status ?? "").toLowerCase();
  return ["pending", "accepted", "preparing", "ready", "picked_up", "dispatched", "en_route"].includes(s);
}

export function DriverInboxScreen() {
  const navigation = useNavigation<any>();

  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [lastMsgByOrder, setLastMsgByOrder] = useState<Record<string, MsgRow | undefined>>({});
  const [lastReadByOrder, setLastReadByOrder] = useState<Record<string, string | undefined>>({});
  const [me, setMe] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const fetchInbox = useCallback(async () => {
    try {
      setLoading(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id ?? null;

      if (!uid) {
        setMe(null);
        setOrders([]);
        setLastMsgByOrder({});
        setLastReadByOrder({});
        Alert.alert("Connexion", "Connecte-toi comme chauffeur pour voir ta boîte.");
        return;
      }

      setMe(uid);

      // ✅ 7 derniers jours (inclut aujourd’hui)
      const now = new Date();
      const from = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)); // J-6 à 00:00 => 7 jours
      const fromISO = from.toISOString();

      const baseSelect = "id, created_at, status, driver_id, restaurant_name, kind";

      // ✅ En cours
      const { data: inProgress, error: e1 } = await supabase
        .from("orders")
        .select(baseSelect)
        .eq("driver_id", uid)
        .neq("status", "delivered")
        .order("created_at", { ascending: false });

      if (e1) throw e1;

      // ✅ Livrées 7 jours
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

      setOrders(merged);

      const ids = merged.map((o) => o.id);
      if (ids.length === 0) {
        setLastMsgByOrder({});
        setLastReadByOrder({});
        return;
      }

      // ✅ last message preview (dernier msg par commande)
      const { data: msgs, error: e3 } = await supabase
        .from("order_messages")
        .select("order_id, user_id, message, text, created_at")
        .in("order_id", ids)
        .order("created_at", { ascending: false });

      if (e3) {
        console.log("⚠️ order_messages preview error:", e3);
        setLastMsgByOrder({});
      } else {
        const map: Record<string, MsgRow> = {};
        for (const m of (msgs ?? []) as any[]) {
          const oid = m.order_id as string;
          if (!map[oid]) map[oid] = m as MsgRow; // garde le 1er = plus récent
        }
        setLastMsgByOrder(map);
      }

      // ✅ read receipts (pour badge "Non lu")
      const { data: reads, error: e4 } = await supabase
        .from("order_chat_reads")
        .select("order_id, user_id, last_read_at")
        .eq("user_id", uid)
        .in("order_id", ids);

      if (e4) {
        console.log("⚠️ order_chat_reads error:", e4);
        setLastReadByOrder({});
      } else {
        const rmap: Record<string, string> = {};
        for (const r of (reads ?? []) as any[]) {
          rmap[r.order_id] = r.last_read_at;
        }
        setLastReadByOrder(rmap);
      }
    } catch (e: any) {
      console.log("fetchInbox error:", e);
      Alert.alert("Erreur", e?.message ?? "Impossible de charger la boîte.");
      setOrders([]);
      setLastMsgByOrder({});
      setLastReadByOrder({});
    } finally {
      setLoading(false);
    }
  }, []);

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

  const inProgressOrders = useMemo(() => filtered.filter((o) => isInProgress(o.status)), [filtered]);

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

  function isUnread(orderId: string) {
    const last = lastMsgByOrder[orderId];
    if (!last?.created_at) return false;

    const lastMsgTs = new Date(last.created_at).getTime();
    const lastReadIso = lastReadByOrder[orderId];

    // si pas encore de read => non lu
    if (!lastReadIso) return true;

    const lastReadTs = new Date(lastReadIso).getTime();
    return lastMsgTs > lastReadTs;
  }

  function OrderCard({ o }: { o: OrderRow }) {
    const last = lastMsgByOrder[o.id];
    const title = o.restaurant_name ?? "Commande";
    const subtitle = safeMsgText(last);

    const delivered = (o.status ?? "").toLowerCase() === "delivered";
    const unread = isUnread(o.id);

    const badge = delivered
      ? { text: "Livrée", bg: "rgba(34,197,94,0.12)", border: "#14532D", color: "#BBF7D0" }
      : { text: "En cours", bg: "rgba(59,130,246,0.12)", border: "#1D4ED8", color: "#BFDBFE" };

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
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>{title}</Text>

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
                  <Text style={{ color: "#FCA5A5", fontWeight: "900", fontSize: 11 }}>Non lu</Text>
                </View>
              )}
            </View>

            <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "700", lineHeight: 18 }}>
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

  const unreadCount = useMemo(() => {
    if (!me) return 0;
    let n = 0;
    for (const o of filtered) {
      if (isUnread(o.id)) n += 1;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, lastMsgByOrder, lastReadByOrder, me]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingVertical: 8, paddingRight: 10 }}>
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>←</Text>
          </TouchableOpacity>

          <View style={{ alignItems: "center" }}>
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>Boîte</Text>
            <Text style={{ color: "#9CA3AF", marginTop: 2, fontWeight: "800", fontSize: 12 }}>
              En cours + livrées (7 jours) {unreadCount > 0 ? `• ${unreadCount} non lu` : ""}
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
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>{loading ? "..." : "Rafraîchir"}</Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={{ marginTop: 10 }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Rechercher (#id, restaurant, statut)…"
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
            <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>Chargement…</Text>
          </View>
        ) : me == null ? (
          <Text style={{ color: "#9CA3AF", marginTop: 12 }}>
            Connecte-toi comme chauffeur pour voir tes conversations.
          </Text>
        ) : filtered.length === 0 ? (
          <Text style={{ color: "#9CA3AF", marginTop: 12 }}>
            Aucune commande trouvée (en cours / livrée 7 jours).
          </Text>
        ) : (
          <View style={{ gap: 14 }}>
            <Text style={{ color: "white", fontSize: 22, fontWeight: "900" }}>En cours</Text>
            {inProgressOrders.length === 0 ? (
              <Text style={{ color: "#9CA3AF" }}>Aucune commande en cours.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {inProgressOrders.map((o) => (
                  <OrderCard key={o.id} o={o} />
                ))}
              </View>
            )}

            <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 8 }}>
              Livrées (7 jours)
            </Text>
            {deliveredOrders.length === 0 ? (
              <Text style={{ color: "#9CA3AF" }}>Aucune commande livrée sur 7 jours.</Text>
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
            Driver: {me.slice(0, 8)}…
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
