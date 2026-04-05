"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type MessageRow = {
  id: string;
  order_id: string;
  user_id: string;
  content: string | null;
  created_at: string;
};

type Me = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type MemberRow = {
  user_id: string;
  role: string;
};

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function OrderChatPage() {
  const params = useParams();
  const orderId = params.orderId as string;

  const [me, setMe] = useState<Me | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [rolesByUserId, setRolesByUserId] = useState<Record<string, string>>(
    {}
  );
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  async function loadMe() {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) {
      console.error(userError);
      return;
    }
    const user = userData.user;
    if (!user) return;

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("id", user.id)
      .maybeSingle();

    if (profileRow) {
      setMe({
        id: profileRow.id,
        full_name: profileRow.full_name ?? null,
        email: user.email ?? null,
      });
    } else {
      setMe({
        id: user.id,
        full_name: user.user_metadata?.full_name ?? null,
        email: user.email ?? null,
      });
    }
  }

  async function loadMessages(initial = false) {
    if (initial) {
      setLoading(true);
      setErr(null);
    }

    // 1) Charger les messages (⚠️ plus de colonne role ici)
    const { data, error } = await supabase
      .from("order_messages")
      .select("id, order_id, user_id, content, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      setErr(error.message);
      if (initial) setLoading(false);
      return;
    }

    setMessages((data || []) as MessageRow[]);

    // 2) Charger les rôles via order_members
    const { data: membersData, error: membersError } = await supabase
      .from("order_members")
      .select("user_id, role")
      .eq("order_id", orderId);

    if (!membersError && membersData) {
      const map: Record<string, string> = {};
      (membersData as MemberRow[]).forEach((m) => {
        if (m.user_id && m.role) {
          map[m.user_id] = m.role;
        }
      });
      setRolesByUserId(map);
    }

    if (initial) setLoading(false);
  }

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      await loadMe();
      if (!cancelled) {
        await loadMessages(true);
        // Auto-refresh toutes les 4 secondes
        timer = setInterval(() => {
          loadMessages(false);
        }, 4000);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [orderId]);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim()) return;
    if (sending) return;

    setSending(true);
    setErr(null);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setErr("Tu dois être connecté pour envoyer un message.");
      setSending(false);
      return;
    }

    const user = userData.user;

    const { error: insertError } = await supabase.from("order_messages").insert({
      order_id: orderId,
      user_id: user.id,
      content: newMessage.trim(),
    });

    if (insertError) {
      console.error(insertError);
      setErr(insertError.message);
      setSending(false);
      return;
    }

    setNewMessage("");
    setSending(false);

    // Recharger immédiatement après envoi
    await loadMessages(false);
  }

  function getRoleBadge(userId: string): string {
    const role = rolesByUserId[userId];
    switch (role) {
      case "driver":
        return "Chauffeur";
      case "restaurant":
        return "Restaurant";
      case "admin":
        return "Admin";
      case "client":
      default:
        return "Client";
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">
          Chat — commande #{String(orderId).slice(0, 8)}
        </h1>
        <p className="text-xs text-gray-500">
          Discussion entre client, restaurant et chauffeur. Rafraîchissement
          automatique toutes les quelques secondes.
        </p>
        {me && (
          <p className="text-xs text-gray-600">
            Tu es connecté en tant que{" "}
            <span className="font-medium">
              {me.full_name || me.email || "profil MMD"}
            </span>
            .
          </p>
        )}
      </header>

      {loading && (
        <p className="text-sm text-gray-600">Chargement des messages…</p>
      )}

      {err && <p className="text-sm text-red-600">Erreur : {err}</p>}

      {/* Liste des messages */}
      <div className="border rounded-lg bg-white p-3 h-80 overflow-y-auto flex flex-col gap-2">
        {messages.length === 0 && !loading && (
          <p className="text-xs text-gray-500">
            Aucun message pour le moment. Commence la conversation.
          </p>
        )}

        {messages.map((msg) => {
          const isMe = me && msg.user_id === me.id;
          const badge = getRoleBadge(msg.user_id);

          return (
            <div
              key={msg.id}
              className={`flex ${
                isMe ? "justify-end" : "justify-start"
              } text-xs`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 border ${
                  isMe
                    ? "bg-emerald-50 border-emerald-200"
                    : "bg-gray-50 border-gray-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[10px] font-semibold text-gray-700">
                    {badge}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {formatDate(msg.created_at)}
                  </span>
                </div>
                <p className="text-[11px] text-gray-800 whitespace-pre-wrap">
                  {msg.content}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Formulaire d’envoi */}
      <form onSubmit={handleSend} className="flex flex-col gap-2">
        <label className="text-xs font-medium text-gray-600">
          Écrire un message
        </label>
        <textarea
          className="border rounded-lg px-3 py-2 text-sm min-h-[60px]"
          placeholder="Ton message ici…"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={sending || !newMessage.trim()}
            className="px-4 py-1.5 rounded-lg bg-black text-white text-sm font-semibold disabled:opacity-50"
          >
            {sending ? "Envoi…" : "Envoyer"}
          </button>
        </div>
      </form>
    </main>
  );
}
