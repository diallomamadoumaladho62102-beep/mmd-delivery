"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { canAccessCommunication } from "@/lib/adminAccess";
import { adminVoiceServiceLabel } from "@/lib/adminVoiceIvr";
import {
  formatCallSessionDuration,
  isCallSessionLive,
  resolveCallSessionDisplayStatus,
} from "@/lib/callSessionDisplay";
import { normalizeUserRole } from "@/lib/roles";

type CallRole = "client" | "driver" | "restaurant" | "admin";
type CallFilter = "all" | "active" | "ended" | "expired";

type CallSessionRow = {
  id: string;
  order_id: string | null;
  caller_user_id: string | null;
  caller_role: CallRole | string | null;
  target_user_id: string | null;
  target_role: CallRole | string | null;
  proxy_number: string | null;
  caller_phone: string | null;
  target_phone: string | null;
  twilio_call_sid: string | null;
  status: string | null;
  started_at: string | null;
  answered_at?: string | null;
  ended_at: string | null;
  expires_at: string | null;
  created_at: string | null;
  duration_seconds?: number | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

type AdminRoleRow = {
  id: string;
  role: string | null;
};

type AdminVoiceCallView = {
  id: string;
  status: string;
  displayStatus?: string;
  createdAt: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
  fromPhone: string | null;
  currentAdminUserId: string | null;
  assignedAdminUserId?: string | null;
  parentCallSid: string;
  service?: string | null;
  ivrDigit?: string | null;
  transferCount?: number;
  conferenceName?: string | null;
  onHold?: boolean;
  holdAvailable?: boolean;
  transferHistory?: Array<{
    id: string;
    fromAdminUserId: string | null;
    toAdminUserId: string | null;
    createdAt: string | null;
  }>;
};

type AdminVoiceStats = {
  active: number;
  incoming: number;
  answered: number;
  missed: number;
  transferred: number;
  completed: number;
  byService: Record<string, number>;
};

type AdminVoiceDestinationView = {
  userId: string;
  fullName: string;
  role: string | null;
  phoneLast4: string;
};

const PAGE_LIMIT = 200;

function canAccessCalls(role: string | null): boolean {
  return canAccessCommunication(normalizeUserRole(role));
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case "client":
      return "Client";
    case "driver":
      return "Driver";
    case "restaurant":
      return "Restaurant";
    case "admin":
      return "Admin";
    default:
      return role || "—";
  }
}

function displayName(profile: ProfileRow | null | undefined): string {
  if (!profile) return "—";
  return profile.full_name || profile.email || profile.phone || profile.id;
}

function normalizeStatus(status: string | null | undefined): string {
  return String(status ?? "unknown").trim().toLowerCase() || "unknown";
}

function statusClass(status: string | null | undefined): string {
  const normalized = normalizeStatus(status);

  if (["active", "in_progress", "ringing", "queued", "initiated", "incoming", "in_ivr"].includes(normalized)) {
    return "border-green-200 bg-green-50 text-green-700";
  }

  if (["completed", "ended", "answered"].includes(normalized)) {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  if (["expired", "failed", "busy", "no-answer", "canceled", "cancelled"].includes(normalized)) {
    return "border-red-200 bg-red-50 text-red-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function isExpired(row: CallSessionRow): boolean {
  return resolveCallSessionDisplayStatus(row) === "expired";
}

function isEnded(row: CallSessionRow): boolean {
  const display = resolveCallSessionDisplayStatus(row);
  return ["completed", "ended", "failed", "busy", "no-answer", "no_answer", "canceled", "cancelled", "missed", "declined"].includes(display);
}

function isActive(row: CallSessionRow): boolean {
  return isCallSessionLive(row);
}

function durationLabel(row: CallSessionRow): string {
  return formatCallSessionDuration(row);
}

export default function AdminCallsPage() {
  const router = useRouter();

  const [calls, setCalls] = useState<CallSessionRow[]>([]);
  const [profilesById, setProfilesById] = useState<Map<string, ProfileRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<CallFilter>("all");
  const [voiceCalls, setVoiceCalls] = useState<AdminVoiceCallView[]>([]);
  const [voiceDestinations, setVoiceDestinations] = useState<
    AdminVoiceDestinationView[]
  >([]);
  const [transferTargetByCall, setTransferTargetByCall] = useState<
    Record<string, string>
  >({});
  const [transferringCallId, setTransferringCallId] = useState<string | null>(
    null,
  );
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const [voiceStats, setVoiceStats] = useState<AdminVoiceStats | null>(null);
  const [recentVoiceCalls, setRecentVoiceCalls] = useState<AdminVoiceCallView[]>([]);
  const [authorizedAdminCount, setAuthorizedAdminCount] = useState(0);
  const [realtimeDegraded, setRealtimeDegraded] = useState(false);
  const firstLoadRef = useRef(true);

  const loadPage = useCallback(async () => {
    try {
      if (firstLoadRef.current) setLoading(true);
      setErr(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw new Error(userError.message);

      if (!user) {
        setAuthChecked(true);
        setIsAdmin(false);
        setErr("Tu dois te connecter en admin.");
        router.push("/admin/login");
        return;
      }

      const { data: me, error: meError } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", user.id)
        .maybeSingle<AdminRoleRow>();

      if (meError) throw new Error(meError.message);

      if (!me || !canAccessCalls(me.role)) {
        setAuthChecked(true);
        setIsAdmin(false);
        setErr("Accès réservé aux administrateurs.");
        return;
      }

      setAuthChecked(true);
      setIsAdmin(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      if (accessToken) {
        const voiceRes = await fetch("/api/admin/voice/calls", {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const voiceJson = (await voiceRes.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          activeCalls?: AdminVoiceCallView[];
          recentCalls?: AdminVoiceCallView[];
          destinations?: AdminVoiceDestinationView[];
          authorizedAdminCount?: number;
          stats?: AdminVoiceStats;
        } | null;

        if (voiceRes.ok && voiceJson?.ok) {
          setVoiceCalls(voiceJson.activeCalls ?? []);
          setRecentVoiceCalls(voiceJson.recentCalls ?? []);
          setVoiceDestinations(voiceJson.destinations ?? []);
          setAuthorizedAdminCount(voiceJson.authorizedAdminCount ?? 0);
          setVoiceStats(voiceJson.stats ?? null);
          setVoiceErr(null);
        } else if (voiceRes.status !== 401 && voiceRes.status !== 403) {
          setVoiceErr(
            voiceJson?.error || "Impossible de charger les appels support.",
          );
        }
      }

      const { data: callsRaw, error: callsError } = await supabase
        .from("call_sessions")
        .select(
          `
          id,
          order_id,
          caller_user_id,
          caller_role,
          target_user_id,
          target_role,
          proxy_number,
          caller_phone,
          target_phone,
          twilio_call_sid,
          status,
          started_at,
          answered_at,
          ended_at,
          expires_at,
          created_at,
          duration_seconds
        `,
        )
        .order("created_at", { ascending: false })
        .limit(PAGE_LIMIT);

      if (callsError) throw new Error(callsError.message);

      const typedCalls = (callsRaw ?? []) as CallSessionRow[];

      const userIds = Array.from(
        new Set(
          typedCalls
            .flatMap((call) => [call.caller_user_id, call.target_user_id])
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      );

      const nextProfiles = new Map<string, ProfileRow>();

      if (userIds.length > 0) {
        const { data: profilesRaw, error: profilesError } = await supabase
          .from("profiles")
          .select("id, full_name, email, phone")
          .in("id", userIds);

        if (profilesError) throw new Error(profilesError.message);

        for (const profile of (profilesRaw ?? []) as ProfileRow[]) {
          nextProfiles.set(profile.id, profile);
        }
      }

      setCalls(typedCalls);
      setProfilesById(nextProfiles);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erreur lors du chargement des appels.";
      setErr(message);
    } finally {
      firstLoadRef.current = false;
      setLoading(false);
    }
  }, [router]);

  const voiceAction = useCallback(async (
    callId: string,
    action: "accept" | "decline" | "end" | "hold" | "resume",
  ) => {
    try {
      setTransferringCallId(callId);
      setVoiceErr(null);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setVoiceErr("Session admin expirée. Reconnecte-toi.");
        return;
      }
      const response = await fetch(`/api/admin/voice/calls/${callId}/action`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !json?.ok) {
        setVoiceErr(json?.error || "L’action d’appel a échoué.");
        return;
      }
      await loadPage();
    } catch (error) {
      setVoiceErr(
        error instanceof Error ? error.message : "L’action d’appel a échoué.",
      );
    } finally {
      setTransferringCallId(null);
    }
  }, [loadPage]);

  const transferCall = useCallback(async (callId: string) => {
    const destinationUserId = transferTargetByCall[callId];
    if (!destinationUserId) {
      setVoiceErr("Choisis un administrateur autorisé.");
      return;
    }

    try {
      setTransferringCallId(callId);
      setVoiceErr(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setVoiceErr("Session admin expirée. Reconnecte-toi.");
        return;
      }

      const response = await fetch("/api/admin/voice/transfer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ callId, destinationUserId }),
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (!response.ok || !json?.ok) {
        setVoiceErr(json?.error || "Le transfert a échoué.");
        return;
      }

      await loadPage();
    } catch (error) {
      setVoiceErr(
        error instanceof Error ? error.message : "Le transfert a échoué.",
      );
    } finally {
      setTransferringCallId(null);
    }
  }, [loadPage, transferTargetByCall]);

  useEffect(() => {
    void loadPage();

    const channel = supabase
      .channel("admin-calls-dashboard")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "call_sessions",
        },
        () => {
          void loadPage();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "admin_voice_calls",
        },
        () => {
          void loadPage();
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

    const poll = window.setInterval(() => void loadPage(), 4000);

    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [loadPage]);

  const activeCount = useMemo(() => calls.filter(isActive).length, [calls]);
  const endedCount = useMemo(() => calls.filter(isEnded).length, [calls]);
  const expiredCount = useMemo(() => calls.filter(isExpired).length, [calls]);

  const filteredCalls = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return calls.filter((call) => {
      if (filter === "active" && !isActive(call)) return false;
      if (filter === "ended" && !isEnded(call)) return false;
      if (filter === "expired" && !isExpired(call)) return false;

      if (!query) return true;

      const caller = call.caller_user_id ? profilesById.get(call.caller_user_id) : null;
      const target = call.target_user_id ? profilesById.get(call.target_user_id) : null;

      const searchable = [
        call.id,
        call.order_id,
        call.caller_role,
        call.target_role,
        call.caller_phone,
        call.target_phone,
        call.proxy_number,
        call.status,
        call.twilio_call_sid,
        displayName(caller),
        displayName(target),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [calls, filter, profilesById, searchQuery]);

  if (loading || !authChecked) {
    return (
      <main className="space-y-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Admin calls</h1>
          <p className="mt-2 text-sm text-slate-600">Chargement…</p>
        </div>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="space-y-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-red-200 bg-red-50 p-8 text-red-700 shadow-sm">
          {err || "Accès réservé aux administrateurs."}
        </div>
      </main>
    );
  }

  return (
    <main className="min-w-0">
      <div className="mx-auto w-full max-w-screen-xl space-y-6 px-6 py-6">
        <header className="space-y-3">
          <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            MMD Delivery · Admin Calls
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Centre de surveillance des appels
          </h1>

          <p className="text-sm text-slate-600">
            Suis les appels support IVR en temps réel, transfère vers un admin
            autorisé, et consulte les appels masqués liés aux commandes.
          </p>
        </header>

        {(err || voiceErr || realtimeDegraded) && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            {voiceErr || err}
            {realtimeDegraded ? (
              <p className="mt-1 text-amber-800">
                Realtime indisponible — rafraîchissement automatique toutes les 4 secondes.
              </p>
            ) : null}
          </div>
        )}

        {voiceStats ? (
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              ["Active", voiceStats.active],
              ["Incoming", voiceStats.incoming],
              ["Answered", voiceStats.answered],
              ["Missed", voiceStats.missed],
              ["Transferred", voiceStats.transferred],
              ["Completed", voiceStats.completed],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm"
              >
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {label}
                </div>
                <div className="mt-2 text-3xl font-extrabold text-slate-900">
                  {value}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {voiceStats?.byService ? (
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Object.entries(voiceStats.byService).map(([service, count]) => (
              <div
                key={service}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              >
                <span className="font-semibold capitalize">
                  {adminVoiceServiceLabel(service)}
                </span>
                <span className="ml-2 font-bold">{count}</span>
              </div>
            ))}
          </section>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Appels support en cours
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Numéro public MMD Delivery : +1 929-492-4563. Transfert direct
                vers un admin autorisé.
              </p>
            </div>
            <span className="inline-flex rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
              {voiceCalls.length} actif{voiceCalls.length === 1 ? "" : "s"}
            </span>
          </div>

          {voiceCalls.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">
              Aucun appel support en cours.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {voiceCalls.map((call) => (
                <div
                  key={call.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-1 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">
                        {call.status === "in_ivr" ||
                        call.status === "ringing" ||
                        call.status === "incoming"
                          ? "🔴 INCOMING MMD SUPPORT CALL"
                          : "MMD Delivery Support"}{" "}
                        · {call.displayStatus || call.status}
                      </p>
                      <p>Caller: {call.fromPhone || "—"}</p>
                      <p>Service: {adminVoiceServiceLabel(call.service)}</p>
                      <p>IVR: {call.ivrDigit ?? "—"}</p>
                      <p>Début : {formatDate(call.createdAt)}</p>
                      {call.answeredAt ? (
                        <p>Répondu : {formatDate(call.answeredAt)}</p>
                      ) : null}
                      {(call.transferHistory?.length ?? 0) > 0 ? (
                        <p>
                          Transfers: {call.transferCount ?? call.transferHistory?.length}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex min-w-full flex-col gap-2 sm:flex-row lg:min-w-[420px]">
                      {call.status === "in_ivr" ||
                      call.status === "ringing" ||
                      call.status === "incoming" ? (
                        <div className="flex w-full gap-2">
                          <button
                            type="button"
                            aria-label="Decline call"
                            onClick={() => void voiceAction(call.id, "decline")}
                            className="min-h-12 flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-extrabold text-white"
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            aria-label="Accept call"
                            onClick={() => void voiceAction(call.id, "accept")}
                            className="min-h-12 flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white"
                          >
                            Accept
                          </button>
                        </div>
                      ) : call.status === "answered" ||
                        call.status === "in_progress" ||
                        call.status === "on_hold" ||
                        call.status === "transferred" ? (
                        <div className="flex w-full gap-2">
                          {call.holdAvailable ? (
                            <button
                              type="button"
                              aria-label={call.onHold || call.status === "on_hold" ? "Resume call" : "Hold call"}
                              onClick={() =>
                                void voiceAction(
                                  call.id,
                                  call.onHold || call.status === "on_hold"
                                    ? "resume"
                                    : "hold",
                                )
                              }
                              className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-extrabold text-slate-900"
                            >
                              {call.onHold || call.status === "on_hold"
                                ? "Resume"
                                : "Hold"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            aria-label="End call"
                            onClick={() => void voiceAction(call.id, "end")}
                            className="min-h-12 flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-extrabold text-white"
                          >
                            End Call
                          </button>
                        </div>
                      ) : null}
                      {voiceDestinations.length > 0 ? (
                        <>
                          <select
                            value={transferTargetByCall[call.id] ?? ""}
                            onChange={(event) =>
                              setTransferTargetByCall((current) => ({
                                ...current,
                                [call.id]: event.target.value,
                              }))
                            }
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                          >
                            <option value="">Choisir un admin…</option>
                            {voiceDestinations.map((destination) => (
                              <option
                                key={destination.userId}
                                value={destination.userId}
                              >
                                {destination.fullName} · {destination.role || "admin"}{" "}
                                · {destination.phoneLast4}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => void transferCall(call.id)}
                            disabled={
                              transferringCallId === call.id ||
                              !transferTargetByCall[call.id]
                            }
                            className="rounded-xl border border-slate-300 bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {transferringCallId === call.id
                              ? "Transfert…"
                              : "Transfer"}
                          </button>
                        </>
                      ) : (
                        <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                          {authorizedAdminCount <= 1
                            ? "Seul administrateur autorisé. Décrochez le téléphone pour répondre. Le transfert vers un second admin n’est pas encore configuré."
                            : "Aucun autre administrateur éligible n’est disponible pour un transfert."}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">
            Historique des appels support
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            24 dernières heures, y compris les appels terminés, transférés ou
            manqués.
          </p>
          {recentVoiceCalls.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">
              Aucun appel support sur les dernières 24 heures.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm text-slate-700">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2">Heure</th>
                    <th className="px-2 py-2">Service</th>
                    <th className="px-2 py-2">Statut</th>
                    <th className="px-2 py-2">Appelant</th>
                    <th className="px-2 py-2">IVR</th>
                    <th className="px-2 py-2">Transferts</th>
                  </tr>
                </thead>
                <tbody>
                  {recentVoiceCalls.map((call) => (
                    <tr key={call.id} className="border-b border-slate-100">
                      <td className="px-2 py-2">{formatDate(call.createdAt)}</td>
                      <td className="px-2 py-2">
                        {adminVoiceServiceLabel(call.service)}
                      </td>
                      <td className="px-2 py-2">
                        {call.displayStatus || call.status}
                      </td>
                      <td className="px-2 py-2">{call.fromPhone || "—"}</td>
                      <td className="px-2 py-2">{call.ivrDigit ?? "—"}</td>
                      <td className="px-2 py-2">{call.transferCount ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <div className="text-sm font-medium text-slate-500">Total appels</div>
            <div className="mt-3 text-4xl font-extrabold text-slate-900">
              {calls.length}
            </div>
          </div>

          <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center shadow-sm">
            <div className="text-sm font-medium text-green-700">Actifs</div>
            <div className="mt-3 text-4xl font-extrabold text-green-900">
              {activeCount}
            </div>
          </div>

          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-center shadow-sm">
            <div className="text-sm font-medium text-blue-700">Terminés</div>
            <div className="mt-3 text-4xl font-extrabold text-blue-900">
              {endedCount}
            </div>
          </div>

          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center shadow-sm">
            <div className="text-sm font-medium text-red-700">Expirés/échoués</div>
            <div className="mt-3 text-4xl font-extrabold text-red-900">
              {expiredCount}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_140px]">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Rechercher par téléphone, commande, rôle, SID Twilio..."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />

            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as CallFilter)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            >
              <option value="all">Tous les appels</option>
              <option value="active">Actifs</option>
              <option value="ended">Terminés</option>
              <option value="expired">Expirés/échoués</option>
            </select>

            <button
              type="button"
              onClick={() => void loadPage()}
              className="rounded-xl border border-slate-300 bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
            >
              Rafraîchir
            </button>
          </div>
        </section>

        {filteredCalls.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-slate-600">Aucun appel trouvé pour ce filtre.</p>
          </section>
        ) : (
          <section className="space-y-4">
            {filteredCalls.map((call) => {
              const displayStatus = resolveCallSessionDisplayStatus(call);
              const caller = call.caller_user_id
                ? profilesById.get(call.caller_user_id)
                : null;
              const target = call.target_user_id
                ? profilesById.get(call.target_user_id)
                : null;

              return (
                <article
                  key={call.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-bold text-slate-900">
                          Call #{call.id.slice(0, 8)}
                        </h2>

                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(
                            displayStatus,
                          )}`}
                        >
                          {displayStatus}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-3 text-sm text-slate-700 md:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-semibold uppercase text-slate-500">
                            Appelant
                          </div>
                          <div className="mt-1 font-semibold text-slate-900">
                            {roleLabel(call.caller_role)} · {displayName(caller)}
                          </div>
                          <div className="mt-1 text-slate-600">
                            {call.proxy_number
                              ? `Masked · ${call.proxy_number}`
                              : call.caller_phone || caller?.phone || "—"}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-semibold uppercase text-slate-500">
                            Destinataire
                          </div>
                          <div className="mt-1 font-semibold text-slate-900">
                            {roleLabel(call.target_role)} · {displayName(target)}
                          </div>
                          <div className="mt-1 text-slate-600">
                            {call.proxy_number
                              ? "Masked · (hidden)"
                              : call.target_phone || target?.phone || "—"}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 text-sm text-slate-600 md:grid-cols-3">
                        <p>
                          <span className="font-semibold text-slate-700">Proxy:</span>{" "}
                          {call.proxy_number || "—"}
                        </p>
                        <p className="break-all">
                          <span className="font-semibold text-slate-700">Twilio SID:</span>{" "}
                          {call.twilio_call_sid || "—"}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-700">Durée:</span>{" "}
                          {durationLabel(call)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-700">Créé:</span>{" "}
                          {formatDate(call.created_at)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-700">Début:</span>{" "}
                          {formatDate(call.started_at)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-700">Réponse:</span>{" "}
                          {formatDate(call.answered_at)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-700">Fin:</span>{" "}
                          {formatDate(call.ended_at)}
                        </p>
                      </div>
                    </div>

                    <div className="grid min-w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:min-w-[360px]">
                      {call.order_id && (
                        <>
                          <Link
                            href={`/admin/orders/${call.order_id}`}
                            className="rounded-xl border border-slate-300 bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
                          >
                            Voir commande
                          </Link>

                          <Link
                            href={`/admin/orders/${call.order_id}/chat?targetRole=${call.caller_role || "client"}`}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50"
                          >
                            Ouvrir chat
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}