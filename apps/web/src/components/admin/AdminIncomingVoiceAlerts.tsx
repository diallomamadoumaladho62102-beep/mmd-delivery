"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminFetch, type ResolvedStaffSession } from "@/lib/adminBrowserAuth";
import {
  adminVoicePhase,
  ADMIN_VOICE_HOLD_SUPPORTED,
  formatLiveCallClock,
} from "@/lib/adminVoiceCallControl";
import { createAdminVoiceRingingController } from "@/lib/adminVoiceRinging";
import {
  adminVoiceServiceLabel,
  shouldAlertIncomingAdminVoice,
} from "@/lib/adminVoiceIvr";
import { sessionHasPermission } from "@/lib/adminSessionAccess";
import { mmdAudio } from "@/lib/mmdAudio";
import { supabase } from "@/lib/supabaseBrowser";

type Destination = {
  userId: string;
  fullName: string;
  role: string | null;
  phoneLast4: string;
};

type ActiveCall = {
  id: string;
  status: string;
  displayStatus?: string;
  fromPhone: string | null;
  service: string | null;
  createdAt: string | null;
  answeredAt?: string | null;
  assignedAdminUserId?: string | null;
  conferenceName?: string | null;
  onHold?: boolean;
  holdAvailable?: boolean;
};

const AUDIO_UNLOCK_KEY = "mmd_admin_voice_audio_unlocked";

export default function AdminIncomingVoiceAlerts({
  session,
}: {
  session: ResolvedStaffSession | null;
}) {
  const canListen = Boolean(
    session &&
      sessionHasPermission(
        { role: session.role, isFounder: session.isFounder },
        "communication.calls",
      ),
  );

  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [authorizedAdminCount, setAuthorizedAdminCount] = useState(0);
  const [transferTarget, setTransferTarget] = useState<Record<string, string>>({});
  const [transferringId, setTransferringId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(true);
  const [realtimeDegraded, setRealtimeDegraded] = useState(false);
  const [acceptedIds, setAcceptedIds] = useState<Record<string, true>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const ringing = useRef(
    createAdminVoiceRingingController({
      start: () => mmdAudio.startLongRing("driver"),
      stop: () => mmdAudio.stopLongRing(),
    }),
  );

  const loadCalls = useCallback(async () => {
    if (!canListen) return;
    try {
      const response = await adminFetch("/api/admin/voice/calls", {
        cache: "no-store",
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        activeCalls?: ActiveCall[];
        destinations?: Destination[];
        authorizedAdminCount?: number;
      } | null;
      if (!response.ok || !json?.ok) return;
      setCalls(json.activeCalls ?? []);
      setDestinations(json.destinations ?? []);
      setAuthorizedAdminCount(json.authorizedAdminCount ?? 0);
    } catch {
      // Best-effort live alerts; the calls page remains the source of truth.
    }
  }, [canListen]);

  useEffect(() => {
    if (!canListen) return;
    void loadCalls();
    const poll = window.setInterval(() => void loadCalls(), 4000);
    const clock = window.setInterval(() => setNowMs(Date.now()), 1000);
    const channel = supabase
      .channel("admin-incoming-voice")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_voice_calls" },
        () => {
          void loadCalls();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeDegraded(false);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setRealtimeDegraded(true);
        }
      });
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
      void supabase.removeChannel(channel);
      ringing.current.stopAll();
    };
  }, [canListen, loadCalls]);

  const visibleCalls = useMemo(
    () =>
      calls.filter((call) => {
        const phase = adminVoicePhase(call.status);
        return (
          phase === "incoming" ||
          phase === "connecting" ||
          phase === "connected" ||
          phase === "on_hold"
        );
      }),
    [calls],
  );

  const shouldRing = visibleCalls.some((call) => {
    const phase = adminVoicePhase(call.status);
    if (acceptedIds[call.id] || phase === "connected" || phase === "ended") {
      return false;
    }
    return (
      shouldAlertIncomingAdminVoice(call.status) ||
      phase === "incoming" ||
      phase === "connecting"
    );
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(AUDIO_UNLOCK_KEY) === "1") {
      setAudioBlocked(false);
    }
  }, []);

  useEffect(() => {
    ringing.current.sync({ shouldRing, audioBlocked });
  }, [audioBlocked, shouldRing]);

  async function unlockAudio() {
    try {
      mmdAudio.unlockOnInteraction();
      if (shouldRing) mmdAudio.startLongRing("driver");
      if (!shouldRing) ringing.current.stopAll();
      window.sessionStorage.setItem(AUDIO_UNLOCK_KEY, "1");
      setAudioBlocked(false);
    } catch {
      setAudioBlocked(true);
    }
  }

  async function runAction(
    callId: string,
    action: "accept" | "decline" | "end" | "hold" | "resume",
  ) {
    try {
      setActingId(callId);
      if (action === "accept" || action === "decline" || action === "end") {
        ringing.current.stopAll();
      }
      if (action === "accept") {
        setAcceptedIds((current) => ({ ...current, [callId]: true }));
      }
      const response = await adminFetch(`/api/admin/voice/calls/${callId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await response.json().catch(() => null);
      await loadCalls();
    } finally {
      setActingId(null);
    }
  }

  async function transferCall(callId: string) {
    const destinationUserId = transferTarget[callId];
    if (!destinationUserId) return;
    try {
      setTransferringId(callId);
      const response = await adminFetch("/api/admin/voice/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, destinationUserId }),
      });
      await response.json().catch(() => null);
      await loadCalls();
    } finally {
      setTransferringId(null);
    }
  }

  if (!canListen || visibleCalls.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 top-[72px] z-50 mx-auto w-[min(100%,440px)] space-y-3 sm:right-4 sm:left-auto sm:mx-0">
      {audioBlocked ? (
        <button
          type="button"
          onClick={() => void unlockAudio()}
          className="pointer-events-auto w-full rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm font-semibold text-amber-900 shadow-lg"
        >
          Activer les notifications sonores des appels. L’alerte visuelle reste active.
        </button>
      ) : null}

      {realtimeDegraded ? (
        <p className="pointer-events-auto rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          Realtime indisponible — les appels sont synchronisés par sonde automatique.
        </p>
      ) : null}

      {visibleCalls.map((call) => {
        const phase = adminVoicePhase(call.status);
        const claimed = Boolean(acceptedIds[call.id] || call.assignedAdminUserId);
        const incoming = phase === "incoming" || (phase === "connecting" && !claimed);
        const onHold = phase === "on_hold" || Boolean(call.onHold);
        const connected = phase === "connected" || onHold;
        const holdAvailable = Boolean(call.holdAvailable || call.conferenceName);
        const startedMs = call.answeredAt
          ? new Date(call.answeredAt).getTime()
          : call.createdAt
            ? new Date(call.createdAt).getTime()
            : null;

        return (
          <section
            key={call.id}
            className="pointer-events-auto rounded-3xl border-2 border-red-500 bg-white p-5 shadow-2xl"
            role="alertdialog"
            aria-live="assertive"
            aria-label={incoming ? "Incoming call" : "Active call"}
          >
            <p className="text-xs font-extrabold uppercase tracking-wide text-red-700">
              {incoming
                ? "Incoming Call"
                : onHold
                  ? "On hold"
                  : connected
                    ? "Call in progress"
                    : "Connecting"}
            </p>
            <p className="mt-2 text-2xl font-extrabold text-slate-900">
              {call.fromPhone || "Unknown caller"}
            </p>
            <p className="text-base font-semibold text-slate-700">
              MMD Support · {adminVoiceServiceLabel(call.service)}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {incoming
                ? "Incoming call..."
                : onHold
                  ? `${call.fromPhone || "Caller"} is on hold`
                  : connected
                    ? `Connected with ${call.fromPhone || "caller"}`
                    : "Pick up your phone to connect. Web ringing has stopped."}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              Status: {call.displayStatus || call.status}
              {connected ? ` · ${formatLiveCallClock(startedMs, nowMs)}` : null}
            </p>

            {incoming ? (
              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={actingId === call.id}
                  onClick={() => void runAction(call.id, "decline")}
                  aria-label="Decline call"
                  className="min-h-14 rounded-2xl bg-red-600 px-4 py-4 text-lg font-extrabold text-white shadow-sm disabled:opacity-60"
                >
                  Decline
                </button>
                <button
                  type="button"
                  disabled={actingId === call.id}
                  onClick={() => void runAction(call.id, "accept")}
                  aria-label="Accept call"
                  className="min-h-14 rounded-2xl bg-emerald-600 px-4 py-4 text-lg font-extrabold text-white shadow-sm disabled:opacity-60"
                >
                  Accept
                </button>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {holdAvailable && ADMIN_VOICE_HOLD_SUPPORTED && connected ? (
                  <button
                    type="button"
                    disabled={actingId === call.id}
                    onClick={() => void runAction(call.id, onHold ? "resume" : "hold")}
                    aria-label={onHold ? "Resume call" : "Hold call"}
                    className="min-h-14 w-full rounded-2xl border-2 border-slate-800 bg-white px-4 py-4 text-lg font-extrabold text-slate-900 shadow-sm disabled:opacity-60"
                  >
                    {onHold ? "Resume" : "Hold"}
                  </button>
                ) : (
                  <p className="text-xs text-slate-500">
                    Mute and speaker are controlled on the phone that answered.
                    Hold is available only on conference support calls.
                  </p>
                )}
                <button
                  type="button"
                  disabled={actingId === call.id}
                  onClick={() => void runAction(call.id, "end")}
                  aria-label="End call"
                  className="min-h-14 w-full rounded-2xl bg-red-600 px-4 py-4 text-lg font-extrabold text-white shadow-sm disabled:opacity-60"
                >
                  End Call
                </button>
              </div>
            )}

            {destinations.length > 0 ? (
              <div className="mt-3 flex gap-2">
                <select
                  value={transferTarget[call.id] ?? ""}
                  onChange={(event) =>
                    setTransferTarget((current) => ({
                      ...current,
                      [call.id]: event.target.value,
                    }))
                  }
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  aria-label="Transfer destination"
                >
                  <option value="">Choose an admin…</option>
                  {destinations.map((destination) => (
                    <option key={destination.userId} value={destination.userId}>
                      {destination.fullName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!transferTarget[call.id] || transferringId === call.id}
                  onClick={() => void transferCall(call.id)}
                  className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  TRANSFER
                </button>
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {authorizedAdminCount <= 1
                  ? "Seul administrateur autorisé — décrochez le téléphone pour parler. Accept arrête la sonnerie web."
                  : "Aucun autre administrateur éligible n’est disponible pour un transfert."}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
