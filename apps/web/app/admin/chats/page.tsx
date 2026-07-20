"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { canAccessCommunication } from "@/lib/adminAccess";
import {
  messagePreview,
  ORDER_MESSAGE_SELECT,
} from "@/lib/orderMessages";
import { normalizeUserRole } from "@/lib/roles";
import { isLiveVisibleTrip } from "@/lib/tripVisibility";

type ChatRole = "client" | "driver" | "restaurant" | "admin";

type OrderRow = {
  id: string;
  status: string | null;
  created_at: string | null;
  client_id: string | null;
  client_user_id: string | null;
  driver_id: string | null;
  restaurant_id: string | null;
  is_test?: boolean | null;
  archived_at?: string | null;
  hidden_from_user?: boolean | null;
};

type MessageRow = {
  id: string;
  order_id: string;
  text: string | null;
  image_path: string | null;
  sender_role: ChatRole | null;
  target_role: ChatRole | null;
  created_at: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type AdminRoleRow = {
  id: string;
  role: string | null;
};

type ChatThread = {
  order: OrderRow;
  lastMessage: MessageRow | null;
  messagesCount: number;
  participants: {
    client: ProfileRow | null;
    driver: ProfileRow | null;
    restaurant: ProfileRow | null;
  };
};

const CHAT_TARGETS: Exclude<ChatRole, "admin">[] = [
  "client",
  "driver",
  "restaurant",
];

function canAccessChats(role: string | null): boolean {
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

function roleLabel(role: ChatRole): string {
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
      return role;
  }
}

function statusClass(status: string | null): string {
  const normalized = String(status ?? "").toLowerCase();

  if (["delivered", "completed", "paid"].includes(normalized)) {
    return "border-green-200 bg-green-50 text-green-700";
  }

  if (["cancelled", "canceled", "refunded"].includes(normalized)) {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (["pending", "created", "waiting"].includes(normalized)) {
    return "border-yellow-200 bg-yellow-50 text-yellow-700";
  }

  return "border-blue-200 bg-blue-50 text-blue-700";
}

function displayName(profile: ProfileRow | null): string {
  if (!profile) return "—";
  return profile.full_name || profile.email || profile.id;
}

export default function AdminChatsPage() {
  const router = useRouter();

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [targetFilter, setTargetFilter] = useState<ChatRole | "all">("all");

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
        router.push("/admin/login");
        return;
      }

      const { data: me, error: meError } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", user.id)
        .maybeSingle<AdminRoleRow>();

      if (meError) throw new Error(meError.message);

      if (!me || !canAccessChats(me.role)) {
        setAuthChecked(true);
        setIsAdmin(false);
        setErr("Accès réservé aux administrateurs.");
        return;
      }

      setAuthChecked(true);
      setIsAdmin(true);

      const { data: messagesRaw, error: messagesError } = await supabase
        .from("order_messages")
        .select(ORDER_MESSAGE_SELECT)
        .order("created_at", { ascending: false })
        .limit(300);

      if (messagesError) throw new Error(messagesError.message);

      const messages = (messagesRaw ?? []) as MessageRow[];
      const orderIds = Array.from(new Set(messages.map((m) => m.order_id).filter(Boolean)));

      if (orderIds.length === 0) {
        setThreads([]);
        return;
      }

      const { data: ordersRaw, error: ordersError } = await supabase
        .from("orders")
        .select(
          "id, status, created_at, client_id, client_user_id, driver_id, restaurant_id, is_test, archived_at, hidden_from_user"
        )
        .in("id", orderIds);

      if (ordersError) throw new Error(ordersError.message);

      const orders = ((ordersRaw ?? []) as OrderRow[]).filter(isLiveVisibleTrip);

      const profileIds = Array.from(
        new Set(
          orders
            .flatMap((o) => [
              o.client_id ?? o.client_user_id,
              o.driver_id,
              o.restaurant_id,
            ])
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      );

      let profilesById = new Map<string, ProfileRow>();

      if (profileIds.length > 0) {
        const { data: profilesRaw, error: profilesError } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", profileIds);

        if (profilesError) throw new Error(profilesError.message);

        profilesById = new Map(
          ((profilesRaw ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]),
        );
      }

      const messagesByOrder = new Map<string, MessageRow[]>();

      for (const msg of messages) {
        const existing = messagesByOrder.get(msg.order_id) ?? [];
        existing.push(msg);
        messagesByOrder.set(msg.order_id, existing);
      }

      const merged: ChatThread[] = orders
        .map((order) => {
          const orderMessages = messagesByOrder.get(order.id) ?? [];
          const lastMessage = orderMessages[0] ?? null;

          return {
            order,
            lastMessage,
            messagesCount: orderMessages.length,
            participants: {
              client:
                order.client_id || order.client_user_id
                  ? profilesById.get(order.client_id ?? order.client_user_id ?? "") ??
                    null
                  : null,
              driver: order.driver_id ? profilesById.get(order.driver_id) ?? null : null,
              restaurant: order.restaurant_id
                ? profilesById.get(order.restaurant_id) ?? null
                : null,
            },
          };
        })
        .sort((a, b) => {
          const aTime = new Date(a.lastMessage?.created_at ?? a.order.created_at ?? 0).getTime();
          const bTime = new Date(b.lastMessage?.created_at ?? b.order.created_at ?? 0).getTime();
          return bTime - aTime;
        });

      setThreads(merged);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erreur lors du chargement des chats.";
      setErr(message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadPage();

    const channel = supabase
      .channel("admin-chats-dashboard")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_messages",
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

  const filteredThreads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return threads.filter((thread) => {
      if (targetFilter !== "all") {
        const msg = thread.lastMessage;
        const touchesTarget =
          msg?.sender_role === targetFilter || msg?.target_role === targetFilter;

        if (!touchesTarget) return false;
      }

      if (!query) return true;

      const searchable = [
        thread.order.id,
        thread.order.status,
        thread.lastMessage?.text,
        thread.lastMessage?.sender_role,
        thread.lastMessage?.target_role,
        displayName(thread.participants.client),
        displayName(thread.participants.driver),
        displayName(thread.participants.restaurant),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [threads, searchQuery, targetFilter]);

  if (loading || !authChecked) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Admin chats</h1>
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
            MMD Delivery · Admin Chats
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Centre de messages admin
          </h1>

          <p className="text-sm text-slate-600">
            Suis tous les chats liés aux commandes et réponds rapidement au client,
            au chauffeur ou au restaurant.
          </p>
        </header>

        {err && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            {err}
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <div className="text-sm font-medium text-slate-500">Conversations</div>
            <div className="mt-3 text-4xl font-extrabold text-slate-900">
              {threads.length}
            </div>
          </div>

          {CHAT_TARGETS.map((role) => (
            <div
              key={role}
              className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-center shadow-sm"
            >
              <div className="text-sm font-medium text-blue-700">{roleLabel(role)}</div>
              <div className="mt-3 text-4xl font-extrabold text-blue-900">
                {
                  threads.filter(
                    (thread) =>
                      thread.lastMessage?.sender_role === role ||
                      thread.lastMessage?.target_role === role,
                  ).length
                }
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_140px]">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Rechercher par commande, nom, email, message..."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />

            <select
              value={targetFilter}
              onChange={(event) => setTargetFilter(event.target.value as ChatRole | "all")}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            >
              <option value="all">Tous les rôles</option>
              <option value="client">Client</option>
              <option value="driver">Driver</option>
              <option value="restaurant">Restaurant</option>
              <option value="admin">Admin</option>
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

        {filteredThreads.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-slate-600">
              Aucun chat trouvé pour ce filtre.
            </p>
          </section>
        ) : (
          <section className="space-y-4">
            {filteredThreads.map((thread) => {
              const last = thread.lastMessage;
              const status = thread.order.status ?? "unknown";

              return (
                <article
                  key={thread.order.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-bold text-slate-900">
                          Order #{thread.order.id.slice(0, 8)}
                        </h2>

                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(
                            status,
                          )}`}
                        >
                          {status}
                        </span>

                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                          {thread.messagesCount} message(s)
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-2 text-sm text-slate-600 md:grid-cols-3">
                        <p>
                          <span className="font-semibold text-slate-700">Client:</span>{" "}
                          {displayName(thread.participants.client)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-700">Driver:</span>{" "}
                          {displayName(thread.participants.driver)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-700">Restaurant:</span>{" "}
                          {displayName(thread.participants.restaurant)}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        {last ? (
                          <>
                            <div className="mb-1 text-xs font-semibold text-slate-500">
                              Dernier message · {roleLabel(last.sender_role ?? "admin")} →{" "}
                              {roleLabel(last.target_role ?? "admin")} ·{" "}
                              {formatDate(last.created_at)}
                            </div>
                            <div className="line-clamp-2">
                              {messagePreview(last)}
                            </div>
                          </>
                        ) : (
                          "Aucun message récent."
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:min-w-[420px]">
                      {CHAT_TARGETS.map((role) => (
                        <Link
                          key={role}
                          href={`/admin/orders/${thread.order.id}/chat?targetRole=${role}`}
                          className="rounded-xl border border-slate-300 bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
                        >
                          Répondre {roleLabel(role)}
                        </Link>
                      ))}
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