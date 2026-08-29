import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { API_BASE_URL } from "../../lib/apiBase";
import { mmdAudio } from "../../lib/mmdAudio";

type IncomingSession = {
  id: string;
  caller_role: string | null;
  target_role: string | null;
  status: string | null;
  order_id: string | null;
};

function isIncomingStatus(status: string | null): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return ["active", "ringing", "queued", "initiated"].includes(normalized);
}

export default function IncomingMaskedCallHost() {
  const { t } = useTranslation();
  const [userId, setUserId] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<IncomingSession[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("call_sessions")
      .select("id, caller_role, target_role, status, order_id, expires_at, ended_at")
      .eq("target_user_id", uid)
      .order("created_at", { ascending: false })
      .limit(10);
    const rows = ((data ?? []) as Array<IncomingSession & { expires_at?: string | null; ended_at?: string | null }>)
      .filter((row) => {
        if (!isIncomingStatus(row.status) || row.ended_at) return false;
        if (!row.expires_at) return true;
        const expires = new Date(row.expires_at).getTime();
        return Number.isFinite(expires) && expires > Date.now();
      });
    setIncoming(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null;
      if (cancelled) return;
      setUserId(uid);
      if (uid) void load(uid);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (uid) void load(uid);
      else setIncoming([]);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const poll = setInterval(() => void load(userId), 4000);
    const channel = supabase
      .channel("masked-incoming-calls")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_sessions" },
        () => {
          void load(userId);
        },
      )
      .subscribe();
    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [load, userId]);

  const current = incoming[0] ?? null;
  const shouldRing = Boolean(current);

  useEffect(() => {
    if (shouldRing) {
      void mmdAudio.startLongRing("driver");
      return () => {
        void mmdAudio.stopLongRing();
      };
    }
    void mmdAudio.stopLongRing();
    return undefined;
  }, [shouldRing, current?.id]);

  const title = useMemo(() => {
    if (!current) return "";
    const role = String(current.caller_role ?? "caller");
    return t("calls.incoming.fromRole", "{{role}} is calling", { role });
  }, [current, t]);

  async function decline() {
    if (!current) return;
    setActingId(current.id);
    void mmdAudio.stopLongRing();
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        await fetch(`${String(API_BASE_URL ?? "").replace(/\/+$/, "")}/api/twilio/calls/action`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionId: current.id, action: "decline" }),
        });
      }
    } finally {
      setActingId(null);
      if (userId) void load(userId);
    }
  }

  async function accept() {
    void mmdAudio.stopLongRing();
    setIncoming([]);
  }

  if (!current) return null;

  return (
    <Modal visible transparent animationType="fade" accessibilityViewIsModal>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(15,23,42,0.72)",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 28,
            padding: 24,
            gap: 10,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{ fontSize: 14, fontWeight: "800", color: "#B91C1C" }}
          >
            {t("calls.incoming.title", "Incoming Call")}
          </Text>
          <Text style={{ fontSize: 24, fontWeight: "800", color: "#0F172A" }}>{title}</Text>
          <Text style={{ fontSize: 16, color: "#334155" }}>
            {t("calls.incoming.subtitle", "Incoming call...")}
          </Text>
          {current.order_id ? (
            <Text style={{ fontSize: 14, color: "#64748B" }}>
              {t("calls.incoming.relatedOrder", "Related job")} · {current.order_id.slice(0, 8)}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("calls.incoming.declineA11y", "Decline call")}
              onPress={() => void decline()}
              disabled={actingId === current.id}
              style={{
                flex: 1,
                minHeight: 56,
                borderRadius: 18,
                backgroundColor: "#DC2626",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>
                {t("calls.incoming.decline", "Decline")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("calls.incoming.acceptA11y", "Accept call")}
              onPress={() => void accept()}
              style={{
                flex: 1,
                minHeight: 56,
                borderRadius: 18,
                backgroundColor: "#059669",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>
                {t("calls.incoming.accept", "Accept")}
              </Text>
            </Pressable>
          </View>
          <Text style={{ fontSize: 12, color: "#64748B", marginTop: 8 }}>
            {t(
              "calls.incoming.nativeHint",
              "Accept stops the in-app ring. Answer the phone call itself to talk.",
            )}
          </Text>
        </View>
      </View>
    </Modal>
  );
}
