// apps/mobile/src/screens/RestaurantInboxScreen.tsx
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
  restaurant_id: string | null;
  restaurant_name: string | null;
};

type MsgRow = {
  order_id: string;
  created_at: string;
  message: string | null;
  text?: string | null;
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

// ✅ Aligné avec le reste : on préfère "text", sinon fallback "message"
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

export function RestaurantInboxScreen() {
  const navigation = useNavigation<any>();

  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [lastMsgByOrder, setLastMsgByOrder] = useState<Record<string, MsgRow | undefined>>({});
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // ✅ récupérer l’ID du restaurant connecté
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;

        if (!cancelled) {
          setRestaurantId(data?.user?.id ?? null);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setRestaurantId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const fetchInbox = useCallback(async () => {
    if (!restaurantId) return;

    try {
      setLoading(true);

      const now = new Date();
      const from = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
      const fromISO = from.toISOString();

      const baseSelect = "id, created_at, status, restaurant_id, restaurant_name";

      const { data: inProgress, error: e1 } = await supabase
        .from("orders")
        .select(baseSelect)
        .eq("restaurant_id", restaurantId)
        .neq("status", "delivered")
        .order("created_at", { ascending: false });
      if (e1) throw e1;

      const { data: delivered7d, error: e2 } = await supabase
        .from("orders")
        .select(baseSelect)
        .eq("restaurant_id", restaurantId)
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
        .select("order_id, message, text, created_at")
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
      console.log("RestaurantInbox fetch error:", e);
      Alert.alert("Erreur", e?.message ?? "Impossible de charger la boîte.");
      setOrders([]);
      setLastMsgByOrder({});
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

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
      navigation.navigate("RestaurantChat", { orderId });
    },
    [navigation]
  );

  function Card({ o }: { o: OrderRow }) {
    const last = lastMsgByOrder[o.id];
    const delivered = (o.status ?? "").toLowerCase() === "delivered";

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
          borderColor: "#1F2937",
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
              {o.restaurant_name ?? "Commande"}
            </Text>
            <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "700" }}>
              {safeMsgText(last)}
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
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>←</Text>
          </TouchableOpacity>

          <View style={{ alignItems: "center" }}>
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>Boîte</Text>
            <Text style={{ color: "#9CA3AF", marginTop: 2, fontWeight: "800", fontSize: 12 }}>
              En cours + livrées (7 jours)
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
        ) : !restaurantId ? (
          <Text style={{ color: "#9CA3AF", marginTop: 12 }}>
            Connecte-toi comme restaurant pour voir tes conversations.
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
                  <Card key={o.id} o={o} />
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
                  <Card key={o.id} o={o} />
                ))}
              </View>
            )}
          </View>
        )}

        {restaurantId && (
          <Text style={{ color: "#334155", marginTop: 18, fontSize: 11 }}>
            Restaurant: {restaurantId.slice(0, 8)}…
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
