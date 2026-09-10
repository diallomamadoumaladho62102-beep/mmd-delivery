import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { API_BASE_URL } from "../../lib/apiBase";
import { mmdAudio } from "../../lib/mmdAudio";
import { BOOT_AUTH_TIMEOUT_MS, withTimeout } from "../../lib/bootFailOpen";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../../lib/supabaseRealtime";
import {
  INCOMING_CALL_POLL_MS,
  callSessionsRealtimeFilter,
  createIncomingCallFetchGate,
  filterIncomingCallSessions,
  incomingCallSessionsEqual,
  shouldFetchIncomingCallsOnAuthEvent,
  shouldWatchIncomingCalls,
  type IncomingCallSessionRow,
} from "../../lib/incomingMaskedCallWatch";

type IncomingSession = IncomingCallSessionRow;

function formatElapsed(startedMs: number, nowMs: number): string {
  if (nowMs < startedMs) return "00:00";
  const sec = Math.floor((nowMs - startedMs) / 1000);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function IncomingMaskedCallHost() {
  const { t } = useTranslation();
  const [userId, setUserId] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<IncomingSession[]>([]);
  const [connected, setConnected] = useState<IncomingSession | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [actingId, setActingId] = useState<string | null>(null);
  const fetchGate = useRef(createIncomingCallFetchGate()).current;
  const incomingRef = useRef<IncomingSession[]>([]);

  const applyIncoming = useCallback((rows: IncomingSession[]) => {
    if (incomingCallSessionsEqual(incomingRef.current, rows)) return;
    incomingRef.current = rows;
    setIncoming(rows);
  }, []);

  const load = useCallback(
    async (uid: string, force = false) => {
      if (!shouldWatchIncomingCalls(AppState.currentState)) return;
      await fetchGate.run(async () => {
        const { data } = await supabase
          .from("call_sessions")
          .select("id, caller_role, target_role, status, order_id, expires_at, ended_at")
          .eq("target_user_id", uid)
          .order("created_at", { ascending: false })
          .limit(10);
        const rows = filterIncomingCallSessions(
          (data ?? []) as IncomingSession[],
        );
        applyIncoming(rows);
        setConnected((current) => {
          if (!current) return null;
          const stillOpen = ((data ?? []) as IncomingSession[]).some(
            (row) => row.id === current.id && !row.ended_at,
          );
          return stillOpen ? current : null;
        });
      }, force);
    },
    [applyIncoming, fetchGate],
  );

  useEffect(() => {
    let cancelled = false;
    void withTimeout(
      supabase.auth.getSession(),
      BOOT_AUTH_TIMEOUT_MS,
      "incoming_getSession",
    )
      .then(({ data }) => {
        const uid = data.session?.user?.id ?? null;
        if (cancelled) return;
        setUserId(uid);
        if (uid) void load(uid, true);
      })
      .catch((error) => {
        console.log("incoming getSession fail-open:", error);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (!uid) {
        incomingRef.current = [];
        setIncoming([]);
        setConnected(null);
        return;
      }
      if (shouldFetchIncomingCallsOnAuthEvent(event)) {
        void load(uid, true);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const poll = setInterval(() => {
      if (!shouldWatchIncomingCalls(AppState.currentState)) return;
      void load(userId);
    }, INCOMING_CALL_POLL_MS);
    const channel = subscribePostgresChannel(`masked-incoming-calls-${userId}`, [
      {
        event: "*",
        table: "call_sessions",
        filter: callSessionsRealtimeFilter(userId),
        callback: () => {
          if (!shouldWatchIncomingCalls(AppState.currentState)) return;
          void load(userId);
        },
      },
    ]);
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (shouldWatchIncomingCalls(state)) void load(userId, true);
    });
    return () => {
      clearInterval(poll);
      appStateSub.remove();
      fetchGate.dispose();
      void unsubscribeSupabaseChannel(channel);
    };
  }, [load, userId]);

  const current = connected ?? incoming[0] ?? null;
  const shouldRing = Boolean(incoming[0] && !connected);

  useEffect(() => {
    if (shouldRing) {
      void mmdAudio.startLongRing("driver");
      return () => {
        void mmdAudio.stopLongRing();
      };
    }
    void mmdAudio.stopLongRing();
    return undefined;
  }, [shouldRing, incoming[0]?.id]);

  useEffect(() => {
    if (!connected) return;
    const clock = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [connected]);

  const roleLabel = useMemo(() => {
    switch (String(current?.caller_role ?? "").trim().toLowerCase()) {
      case "client":
      case "customer":
        return t("calls.role.customer", "Customer");
      case "driver":
        return t("calls.role.driver", "Driver");
      case "restaurant":
        return t("calls.role.restaurant", "Restaurant");
      case "admin":
      case "support":
        return t("calls.role.support", "Support");
      default:
        return t("calls.role.caller", "Caller");
    }
  }, [current?.caller_role, t]);

  const title = useMemo(() => {
    if (!current) return "";
    if (connected) {
      return t("calls.connected.withRole", "Call with {{role}}", { role: roleLabel });
    }
    return t("calls.incoming.fromRole", "{{role}} is calling", { role: roleLabel });
  }, [connected, current, roleLabel, t]);

  async function postAction(sessionId: string, action: "decline" | "end") {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch(`${String(API_BASE_URL ?? "").replace(/\/+$/, "")}/api/twilio/calls/action`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId, action }),
    });
  }

  async function decline() {
    if (!current) return;
    setActingId(current.id);
    void mmdAudio.stopLongRing();
    try {
      await postAction(current.id, "decline");
    } finally {
      setActingId(null);
      setConnected(null);
      if (userId) void load(userId, true);
    }
  }

  function accept() {
    if (!current) return;
    void mmdAudio.stopLongRing();
    setConnected(current);
    setConnectedAt(Date.now());
    setNowMs(Date.now());
  }

  async function endCall() {
    if (!current) return;
    setActingId(current.id);
    void mmdAudio.stopLongRing();
    try {
      await postAction(current.id, "end");
    } finally {
      setActingId(null);
      setConnected(null);
      setConnectedAt(null);
      if (userId) void load(userId, true);
    }
  }

  useEffect(() => {
    return () => {
      void mmdAudio.stopLongRing();
    };
  }, []);

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
            {connected
              ? t("calls.connected.title", "Call in progress")
              : t("calls.incoming.title", "Incoming Call")}
          </Text>
          <Text style={{ fontSize: 24, fontWeight: "800", color: "#0F172A" }}>{title}</Text>
          <Text style={{ fontSize: 16, color: "#334155" }}>
            {connected
              ? t("calls.connected.subtitle", "Connected")
              : t("calls.incoming.subtitle", "Incoming call...")}
          </Text>
          {current.order_id ? (
            <Text style={{ fontSize: 14, color: "#64748B" }}>
              {t("calls.incoming.relatedOrder", "Related job")} · {current.order_id.slice(0, 8)}
            </Text>
          ) : null}
          {connected && connectedAt ? (
            <Text style={{ fontSize: 18, fontWeight: "700", color: "#0F172A" }}>
              {formatElapsed(connectedAt, nowMs)}
            </Text>
          ) : null}
          {connected ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("calls.connected.endA11y", "End call")}
              onPress={() => void endCall()}
              disabled={actingId === current.id}
              style={{
                minHeight: 56,
                borderRadius: 18,
                backgroundColor: "#DC2626",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 16,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>
                {t("calls.connected.end", "End Call")}
              </Text>
            </Pressable>
          ) : (
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
                onPress={() => accept()}
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
          )}
          <Text style={{ fontSize: 12, color: "#64748B", marginTop: 8 }}>
            {connected
              ? t(
                  "calls.connected.nativeHint",
                  "Talk on the phone. End Call hangs up the Twilio session. Mute and speaker are controlled on the phone.",
                )
              : t(
                  "calls.incoming.nativeHint",
                  "Accept stops the in-app ring. Answer the phone call itself to talk.",
                )}
          </Text>
        </View>
      </View>
    </Modal>
  );
}
