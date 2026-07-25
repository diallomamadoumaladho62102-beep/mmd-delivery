"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { supabase } from "@/lib/supabaseBrowser";

type Conversation = {
  id: string;
  kind: string;
  title: string | null;
  members?: { admin_id: string; role: string }[];
};

type Message = {
  id: string;
  body: string | null;
  message_type: string;
  sender_id: string;
  created_at: string;
  link_url?: string | null;
  attachment_path?: string | null;
};

type CallCapability = {
  canCreateLiveRoom: boolean;
  mode: string;
  capability: { enabled: boolean; reason?: string };
};

export default function StaffCommsPanel({
  peerAdminId,
  peerName,
  currentUserId,
}: {
  peerAdminId: string;
  peerName: string;
  currentUserId: string;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [typingPeer, setTypingPeer] = useState(false);
  const [callCap, setCallCap] = useState<CallCapability | null>(null);
  const [callNotice, setCallNotice] = useState<string | null>(null);
  const [busyCall, setBusyCall] = useState(false);

  const loadMessages = useCallback(async (id: string) => {
    const res = await adminFetch(
      `/api/admin/staff/messages?conversation_id=${id}`
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Failed to load messages");
      return;
    }
    setMessages(body.items ?? []);
  }, []);

  const ensureDirectConversation = useCallback(async () => {
    const listRes = await adminFetch("/api/admin/staff/conversations");
    const listBody = await listRes.json().catch(() => ({}));
    if (!listRes.ok || !listBody.ok) {
      setError(listBody.error ?? "Conversations unavailable");
      return null;
    }
    const existing = (listBody.items as Conversation[]).find((c) => {
      if (c.kind !== "direct") return false;
      const ids = (c.members ?? []).map((m) => m.admin_id);
      return ids.includes(peerAdminId) && ids.includes(currentUserId);
    });
    if (existing) return existing.id;

    const createRes = await adminFetch("/api/admin/staff/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "direct",
        member_ids: [peerAdminId],
        title: `DM · ${peerName}`,
      }),
    });
    const createBody = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createBody.ok) {
      setError(createBody.error ?? "Could not open conversation");
      return null;
    }
    return String(createBody.item.id);
  }, [peerAdminId, peerName, currentUserId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const id = await ensureDirectConversation();
      if (!alive || !id) return;
      setConversationId(id);
      await loadMessages(id);
      const capRes = await adminFetch("/api/admin/staff/calls/capability");
      const capBody = await capRes.json().catch(() => ({}));
      if (capRes.ok && capBody.ok) setCallCap(capBody);
    })();
    return () => {
      alive = false;
    };
  }, [ensureDirectConversation, loadMessages]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`staff-messages-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "staff_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void loadMessages(conversationId);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "staff_conversation_members",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as { admin_id?: string; typing_at?: string };
          if (row.admin_id && row.admin_id !== currentUserId) {
            setTypingPeer(Boolean(row.typing_at));
          }
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, currentUserId, loadMessages]);

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!conversationId || sending || !text.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/staff/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          body: text.trim(),
          message_type: "text",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Send failed");
        return;
      }
      setText("");
      await loadMessages(conversationId);
    } catch {
      setError("Connection lost — message not sent");
    } finally {
      setSending(false);
    }
  }

  async function setTyping(typing: boolean) {
    if (!conversationId) return;
    await adminFetch("/api/admin/staff/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, typing }),
    }).catch(() => undefined);
  }

  async function startCall(
    kind: "audio" | "video" | "meeting",
    startNow: boolean
  ) {
    if (busyCall) return;
    setBusyCall(true);
    setCallNotice(null);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/staff/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: `${kind} with ${peerName}`,
          participant_ids: [peerAdminId],
          start_now: startNow,
          scheduled_at: startNow
            ? null
            : new Date(Date.now() + 15 * 60_000).toISOString(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Call action failed");
        return;
      }
      setCallNotice(
        startNow
          ? `Live ${kind} room created (${body.item.provider_room_name}). Join via Twilio Video client.`
          : `Meeting scheduled for ${new Date(body.item.scheduled_at).toLocaleString()}.`
      );
    } catch {
      setError("Connection lost — call not created");
    } finally {
      setBusyCall(false);
    }
  }

  return (
    <section className="cc-card space-y-4 p-5">
      <h2 className="text-sm font-semibold text-slate-900">
        Internal communication
      </h2>
      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {callNotice ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {callNotice}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busyCall || !callCap?.capability.enabled}
          onClick={() => void startCall("audio", true)}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
          title={
            callCap?.canCreateLiveRoom
              ? "Start live audio room"
              : callCap?.capability.reason ?? "Calls unavailable"
          }
        >
          Audio call
        </button>
        <button
          type="button"
          disabled={busyCall || !callCap?.canCreateLiveRoom}
          onClick={() => void startCall("video", true)}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
          title={
            callCap?.canCreateLiveRoom
              ? "Start live video room"
              : "Requires TWILIO_API_KEY_SID/SECRET"
          }
        >
          Video call
        </button>
        <button
          type="button"
          disabled={busyCall || callCap?.mode === "disabled"}
          onClick={() => void startCall("meeting", false)}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        >
          Schedule meeting
        </button>
      </div>
      {callCap && !callCap.canCreateLiveRoom ? (
        <p className="text-xs text-[var(--cc-muted)]">
          Live A/V disabled until Twilio Video API keys are configured
          {callCap.capability.reason ? ` — ${callCap.capability.reason}` : ""}.
          Scheduling remains available when Twilio account credentials exist.
        </p>
      ) : null}

      <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-[var(--cc-border)] bg-slate-50 p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-[var(--cc-muted)]">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={[
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                m.sender_id === currentUserId
                  ? "ml-auto bg-slate-900 text-white"
                  : "bg-white text-slate-800",
              ].join(" ")}
            >
              <p>{m.body}</p>
              {m.link_url ? (
                <a
                  href={m.link_url.startsWith("/") ? m.link_url : "#"}
                  className="mt-1 block text-xs underline"
                >
                  {m.link_url}
                </a>
              ) : null}
              <p className="mt-1 text-[10px] opacity-70">
                {new Date(m.created_at).toLocaleTimeString()}
              </p>
            </div>
          ))
        )}
        {typingPeer ? (
          <p className="text-xs text-[var(--cc-muted)]">Typing…</p>
        ) : null}
      </div>

      <form onSubmit={(e) => void sendMessage(e)} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => void setTyping(true)}
          onBlur={() => void setTyping(false)}
          placeholder="Private message…"
          disabled={!conversationId || sending}
          className="min-w-0 flex-1 rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={!conversationId || sending || !text.trim()}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
      <p className="text-xs text-[var(--cc-muted)]">
        Messages persist in Supabase with RLS. Attachments use the private
        staff-attachments bucket (upload via storage path on message create).
      </p>
    </section>
  );
}
