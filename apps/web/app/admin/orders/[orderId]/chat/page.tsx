"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { supabase } from "@/lib/supabaseBrowser";

type ChatRole = "client" | "driver" | "restaurant" | "admin";

type MessageRow = {
  id: string;
  order_id: string;
  user_id: string | null;
  text: string | null;
  image_path: string | null;
  created_at: string;
  sender_role: ChatRole | null;
  target_role: ChatRole | null;
};

const CHAT_ROLES: ChatRole[] = ["client", "driver", "restaurant"];

function normalizeChatRole(value: string | null): ChatRole {
  const role = String(value ?? "").trim().toLowerCase();

  if (role === "driver" || role === "restaurant" || role === "admin") {
    return role;
  }

  return "client";
}

function fmtDate(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function roleLabel(role: ChatRole, t: (key: string, fallback: string) => string) {
  switch (role) {
    case "client":
      return t("admin.chat.roles.client", "Client");
    case "driver":
      return t("admin.chat.roles.driver", "Driver");
    case "restaurant":
      return t("admin.chat.roles.restaurant", "Restaurant");
    case "admin":
      return t("admin.chat.roles.admin", "Admin");
    default:
      return role;
  }
}

export default function AdminOrderChatPage() {
  const params = useParams<{ orderId: string }>();
  const search = useSearchParams();
  const { t: translate } = useTranslation();

  const t = useCallback(
    (key: string, fallback: string) =>
      String(translate(key, { defaultValue: fallback })),
    [translate]
  );

  const orderId = String(params?.orderId ?? "").trim();
  const targetRole = normalizeChatRole(search?.get("targetRole"));

  const [rows, setRows] = useState<MessageRow[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    window.setTimeout(() => {
      if (!scrollRef.current) return;

      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 100);
  }, []);

  const load = useCallback(async () => {
    if (!orderId) return;

    try {
      setLoading(true);
      setLoadError(null);

      const res = await adminFetch(
        `/api/admin/chats/messages?orderId=${encodeURIComponent(orderId)}&targetRole=${encodeURIComponent(targetRole)}`
      );
      const payload = await res.json().catch(() => ({}));

      if (!res.ok || !payload.ok) {
        throw new Error(
          String(payload.error ?? "Impossible de charger les messages.")
        );
      }

      setRows((payload.items ?? []) as MessageRow[]);
      scrollToBottom();
    } catch (error) {
      console.error("admin order chat load error:", error);

      const message =
        error instanceof Error
          ? error.message
          : t("admin.chat.errors.loadFailed", "Impossible de charger les messages.");

      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [orderId, scrollToBottom, t, targetRole]);

  useEffect(() => {
    void load();

    if (!orderId) return;

    const channel = supabase
      .channel(`admin-order-chat-${orderId}-${targetRole}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_messages",
          filter: `order_id=eq.${orderId}`,
        },
        () => {
          void load();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, orderId, targetRole]);

  const send = useCallback(async () => {
    const trimmed = text.trim();

    if (!orderId || !trimmed || sending) return;

    try {
      setSending(true);
      setLoadError(null);

      const res = await adminFetch("/api/admin/chats/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          text: trimmed,
          targetRole,
        }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok || !payload.ok) {
        throw new Error(
          String(payload.error ?? "Impossible d'envoyer le message.")
        );
      }

      setText("");
      await load();
    } catch (error) {
      console.error("admin order chat send error:", error);

      const message =
        error instanceof Error
          ? error.message
          : t("admin.chat.errors.sendFailed", "Impossible d’envoyer le message.");

      setLoadError(message);
    } finally {
      setSending(false);
    }
  }, [load, orderId, sending, t, targetRole, text]);

  const title = useMemo(() => {
    return t("admin.chat.title", "Admin Chat → {{role}}").replace(
      "{{role}}",
      roleLabel(targetRole, t)
    );
  }, [t, targetRole]);

  if (!orderId) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-4xl p-4">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <p className="text-sm text-red-600">
              {t("admin.chat.errors.missingOrderId", "Order ID manquant.")}
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl space-y-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={`/admin/orders/${orderId}`}
            className="text-sm font-medium text-blue-600 underline"
          >
            {t("admin.chat.backOrder", "← Retour commande")}
          </Link>

          <div className="flex flex-wrap gap-2">
            {CHAT_ROLES.map((role) => {
              const active = role === targetRole;

              return (
                <Link
                  key={role}
                  href={`/admin/orders/${orderId}/chat?targetRole=${role}`}
                  className={[
                    "rounded-lg border px-3 py-2 text-sm font-medium",
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {roleLabel(role, t)}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-950">{title}</h1>

              <p className="mt-1 text-sm text-slate-500">
                {t("admin.chat.orderLabel", "Order")} #{orderId.slice(0, 8)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              {loading
                ? t("admin.chat.loading", "Chargement...")
                : t("admin.chat.refresh", "Rafraîchir")}
            </button>
          </div>

          {loadError ? (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {loadError}
            </p>
          ) : null}
        </div>

        <div
          ref={scrollRef}
          className="h-[520px] space-y-4 overflow-y-auto rounded-2xl border bg-white p-4 shadow-sm"
        >
          {loading && rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              {t("admin.chat.loadingMessages", "Chargement des messages...")}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              {t("admin.chat.empty", "Aucun message.")}
            </p>
          ) : (
            rows.map((row) => {
              const sender = row.sender_role
                ? roleLabel(row.sender_role, t)
                : t("admin.chat.legacy", "legacy");

              return (
                <div
                  key={row.id}
                  className={[
                    "rounded-xl border p-3",
                    row.sender_role === "admin"
                      ? "border-slate-900 bg-slate-50"
                      : "border-slate-200 bg-white",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-slate-500">
                      {sender}
                    </div>

                    <div className="text-xs text-slate-400">
                      {fmtDate(row.created_at)}
                    </div>
                  </div>

                  {row.text ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-900">
                      {row.text}
                    </p>
                  ) : null}

                  {row.image_path ? (
                    <p className="mt-2 text-xs text-slate-500">
                      {t("admin.chat.imageAttached", "Image jointe")}
                    </p>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t(
              "admin.chat.placeholder",
              "Écrire un message admin..."
            )}
            className="min-h-[120px] w-full rounded-xl border p-3 text-sm outline-none focus:border-slate-500"
          />

          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || text.trim() === ""}
            className="mt-3 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {sending
              ? t("admin.chat.sending", "Envoi...")
              : t("admin.chat.send", "Envoyer")}
          </button>
        </div>
      </div>
    </main>
  );
}
