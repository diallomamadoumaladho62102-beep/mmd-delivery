"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { canAccessCommunication } from "@/lib/adminAccess";
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
  ended_at: string | null;
  expires_at: string | null;
  created_at: string | null;
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

  if (["active", "in_progress", "ringing", "queued", "initiated"].includes(normalized)) {
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
  if (!row.expires_at) return false;
  const expires = new Date(row.expires_at).getTime();
  return Number.isFinite(expires) && expires < Date.now() && !row.ended_at;
}

function isEnded(row: CallSessionRow): boolean {
  const status = normalizeStatus(row.status);
  return Boolean(row.ended_at) || ["completed", "ended", "failed", "busy", "no-answer", "canceled", "cancelled"].includes(status);
}

function isActive(row: CallSessionRow): boolean {
  if (isEnded(row) || isExpired(row)) return false;
  const status = normalizeStatus(row.status);
  return ["active", "in_progress", "ringing", "queued", "initiated", "created", "pending"].includes(status);
}

function durationLabel(row: CallSessionRow): string {
  const startRaw = row.started_at ?? row.created_at;
  if (!startRaw) return "—";

  const start = new Date(startRaw).getTime();
  const end = row.ended_at ? new Date(row.ended_at).getTime() : Date.now();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "—";
  }

  const totalSeconds = Math.floor((end - start) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
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

  const loadPage = useCallback(async () => {
    try {
      setLoading(true);
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
        router.push("/auth/login");
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
          ended_at,
          expires_at,
          created_at
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
      setLoading(false);
    }
  }, [router]);

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
      .subscribe();

    return () => {
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
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Admin calls</h1>
          <p className="mt-2 text-sm text-slate-600">Chargement…</p>
        </div>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-red-200 bg-red-50 p-8 text-red-700 shadow-sm">
          {err || "Accès réservé aux administrateurs."}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-screen-xl space-y-6 px-6 py-6">
        <header className="space-y-3">
          <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            MMD Delivery · Admin Calls
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Centre de surveillance des appels
          </h1>

          <p className="text-sm text-slate-600">
            Suis les appels masqués Twilio, les participants, les statuts et les commandes liées.
          </p>
        </header>

        {err && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            {err}
          </div>
        )}

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
                            call.status,
                          )}`}
                        >
                          {normalizeStatus(call.status)}
                        </span>

                        {isExpired(call) && (
                          <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                            Expiré
                          </span>
                        )}

                        {isActive(call) && (
                          <span className="inline-flex rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
                            En cours
                          </span>
                        )}
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
                            {call.caller_phone || caller?.phone || "—"}
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
                            {call.target_phone || target?.phone || "—"}
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