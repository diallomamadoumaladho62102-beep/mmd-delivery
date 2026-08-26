"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { adminFetch, type ResolvedStaffSession } from "@/lib/adminBrowserAuth";
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
};

const AUDIO_UNLOCK_KEY = "mmd_admin_voice_audio_unlocked";

export default function AdminIncomingVoiceAlerts({
  session,
}: {
  session: ResolvedStaffSession | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
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
  const [audioBlocked, setAudioBlocked] = useState(true);
  const [realtimeDegraded, setRealtimeDegraded] = useState(false);
  const ringingRef = useRef(false);

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
      void supabase.removeChannel(channel);
      mmdAudio.stopLongRing();
      ringingRef.current = false;
    };
  }, [canListen, loadCalls]);

  const incomingCalls = useMemo(
    () => calls.filter((call) => shouldAlertIncomingAdminVoice(call.status)),
    [calls],
  );
  const shouldRing = incomingCalls.length > 0;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(AUDIO_UNLOCK_KEY) === "1") {
      setAudioBlocked(false);
    }
  }, []);

  useEffect(() => {
    if (!shouldRing) {
      mmdAudio.stopLongRing();
      ringingRef.current = false;
      return;
    }
    if (audioBlocked) return;
    if (ringingRef.current) return;
    ringingRef.current = true;
    try {
      mmdAudio.startLongRing("driver");
    } catch {
      setAudioBlocked(true);
      ringingRef.current = false;
    }
  }, [audioBlocked, shouldRing]);

  async function unlockAudio() {
    try {
      mmdAudio.unlockOnInteraction();
      mmdAudio.startLongRing("driver");
      if (!shouldRing) mmdAudio.stopLongRing();
      window.sessionStorage.setItem(AUDIO_UNLOCK_KEY, "1");
      setAudioBlocked(false);
    } catch {
      setAudioBlocked(true);
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

  if (!canListen || incomingCalls.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-[88px] z-50 w-[min(100%-2rem,380px)] space-y-3">
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

      {incomingCalls.map((call) => (
        <section
          key={call.id}
          className="pointer-events-auto rounded-2xl border-2 border-red-500 bg-white p-4 shadow-2xl"
          role="status"
          aria-live="assertive"
        >
          <p className="text-sm font-extrabold tracking-wide text-red-700">
            🔴 INCOMING MMD SUPPORT CALL
          </p>
          <p className="mt-2 text-sm text-slate-800">
            Caller: {call.fromPhone || "Unknown"}
          </p>
          <p className="text-sm text-slate-800">
            Service: {adminVoiceServiceLabel(call.service)}
          </p>
          <p className="text-sm text-slate-800">
            Status: {call.displayStatus || call.status}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <Link
              href="/admin/calls"
              className="rounded-xl bg-slate-900 px-3 py-2 text-center text-sm font-semibold text-white"
              onClick={() => {
                if (pathname === "/admin/calls") router.refresh();
              }}
            >
              OPEN CALL
            </Link>
            {destinations.length > 0 ? (
              <div className="flex gap-2">
                <select
                  value={transferTarget[call.id] ?? ""}
                  onChange={(event) =>
                    setTransferTarget((current) => ({
                      ...current,
                      [call.id]: event.target.value,
                    }))
                  }
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
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
                  disabled={
                    !transferTarget[call.id] || transferringId === call.id
                  }
                  onClick={() => void transferCall(call.id)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  TRANSFER
                </button>
              </div>
            ) : (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {authorizedAdminCount <= 1
                  ? "Seul administrateur autorisé — décrochez le téléphone pour répondre. Le transfert vers un second admin n’est pas encore configuré."
                  : "Aucun autre administrateur éligible n’est disponible pour un transfert."}
              </p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
