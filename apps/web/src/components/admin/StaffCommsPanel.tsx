"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { adminFetch, getAdminAccessToken } from "@/lib/adminBrowserAuth";
import { supabase } from "@/lib/supabaseBrowser";

const StaffVideoRoom = dynamic(() => import("./StaffVideoRoom"), {
  ssr: false,
});

type Conversation = {
  id: string;
  kind: string;
  title: string | null;
  members?: { admin_id: string; role: string }[];
};

type Reaction = { emoji: string; admin_id: string };
type Receipt = {
  admin_id: string;
  delivered_at?: string | null;
  read_at?: string | null;
};

type Message = {
  id: string;
  body: string | null;
  message_type: string;
  sender_id: string;
  created_at: string;
  edited_at?: string | null;
  reply_to_message_id?: string | null;
  link_url?: string | null;
  attachment_path?: string | null;
  attachment_mime?: string | null;
  attachment_bytes?: number | null;
  staff_message_reactions?: Reaction[];
  staff_message_receipts?: Receipt[];
};

type CallCapability = {
  canCreateLiveRoom: boolean;
  mode: string;
  capability: { enabled: boolean; reason?: string };
};

const REACTIONS = ["👍", "❤️", "😂", "👀", "✅", "🔥"] as const;

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

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
  const [peerPresence, setPeerPresence] = useState<string | null>(null);
  const [callCap, setCallCap] = useState<CallCapability | null>(null);
  const [callNotice, setCallNotice] = useState<string | null>(null);
  const [busyCall, setBusyCall] = useState(false);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [unreadHint, setUnreadHint] = useState(false);

  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [voiceMs, setVoiceMs] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const voiceTimerRef = useRef<number | null>(null);
  const voiceStartedRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

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
    setUnreadHint(false);
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

      // Peer presence from staff detail if exposed via profiles in list APIs
      const staffRes = await adminFetch(`/api/admin/staff?id=${peerAdminId}`).catch(
        () => null
      );
      if (staffRes?.ok) {
        const staffBody = await staffRes.json().catch(() => ({}));
        const status =
          staffBody?.item?.presence_status ??
          staffBody?.presence_status ??
          null;
        if (status) setPeerPresence(String(status));
      }
    })();
    return () => {
      alive = false;
    };
  }, [ensureDirectConversation, loadMessages, peerAdminId]);

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
        (payload) => {
          const row = payload.new as { sender_id?: string };
          if (row.sender_id && row.sender_id !== currentUserId) {
            setUnreadHint(true);
          }
          void loadMessages(conversationId);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "staff_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => void loadMessages(conversationId)
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

  async function ensureSignedUrl(path: string) {
    if (!conversationId || !path || signedUrls[path]) return;
    const res = await adminFetch(
      `/api/admin/staff/attachments?conversation_id=${encodeURIComponent(conversationId)}&path=${encodeURIComponent(path)}`
    );
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok && body.signed_url) {
      setSignedUrls((prev) => ({ ...prev, [path]: body.signed_url }));
    }
  }

  useEffect(() => {
    for (const m of messages) {
      if (m.attachment_path) void ensureSignedUrl(m.attachment_path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, conversationId]);

  async function sendMessage(e?: FormEvent) {
    e?.preventDefault();
    if (!conversationId || sending) return;
    if (editingId) {
      if (!text.trim()) return;
      setSending(true);
      setError(null);
      try {
        const res = await adminFetch("/api/admin/staff/messages", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversationId,
            message_id: editingId,
            body: text.trim(),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) {
          setError(body.error ?? "Edit failed");
          return;
        }
        setText("");
        setEditingId(null);
        await loadMessages(conversationId);
      } finally {
        setSending(false);
      }
      return;
    }
    if (!text.trim()) return;
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
          reply_to_message_id: replyTo?.id,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Send failed");
        return;
      }
      setText("");
      setReplyTo(null);
      await loadMessages(conversationId);
    } catch {
      setError("Connection lost — message not sent");
    } finally {
      setSending(false);
    }
  }

  async function softDelete(messageId: string) {
    if (!conversationId) return;
    const res = await adminFetch("/api/admin/staff/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        message_id: messageId,
        soft_delete: true,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Delete failed");
      return;
    }
    await loadMessages(conversationId);
  }

  async function react(messageId: string, emoji: string) {
    if (!conversationId) return;
    await adminFetch("/api/admin/staff/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        message_id: messageId,
        reaction: { emoji, op: "add" },
      }),
    }).catch(() => undefined);
    await loadMessages(conversationId);
  }

  async function uploadFile(file: File, caption = "") {
    if (!conversationId) return;
    setSending(true);
    setError(null);
    setUploadProgress(5);
    try {
      const form = new FormData();
      form.append("conversation_id", conversationId);
      form.append("file", file, file.name);
      if (caption) form.append("caption", caption);
      if (replyTo) form.append("caption", caption || `Re: ${replyTo.body ?? ""}`);

      const token = await getAdminAccessToken();
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/admin/staff/attachments");
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };
        xhr.onload = () => {
          try {
            const body = JSON.parse(xhr.responseText || "{}");
            if (xhr.status >= 200 && xhr.status < 300 && body.ok) {
              if (body.signed_url && body.item?.attachment_path) {
                setSignedUrls((prev) => ({
                  ...prev,
                  [body.item.attachment_path]: body.signed_url,
                }));
              }
              resolve();
            } else {
              reject(new Error(body.error ?? "Upload failed"));
            }
          } catch {
            reject(new Error("Upload failed"));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(form);
      });
      setUploadProgress(100);
      setReplyTo(null);
      await loadMessages(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed — retry");
    } finally {
      setSending(false);
      window.setTimeout(() => setUploadProgress(null), 800);
    }
  }

  function clearVoiceTimer() {
    if (voiceTimerRef.current != null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  }

  async function startVoiceNote() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearVoiceTimer();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        setVoiceBlob(blob);
        setVoiceUrl(URL.createObjectURL(blob));
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
      setPaused(false);
      voiceStartedRef.current = Date.now();
      setVoiceMs(0);
      voiceTimerRef.current = window.setInterval(() => {
        setVoiceMs(Date.now() - voiceStartedRef.current);
      }, 250);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Microphone permission denied"
      );
    }
  }

  function pauseVoiceNote() {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state !== "recording") return;
    rec.pause();
    setPaused(true);
    clearVoiceTimer();
  }

  function resumeVoiceNote() {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state !== "paused") return;
    rec.resume();
    setPaused(false);
    const already = voiceMs;
    voiceStartedRef.current = Date.now() - already;
    voiceTimerRef.current = window.setInterval(() => {
      setVoiceMs(Date.now() - voiceStartedRef.current);
    }, 250);
  }

  function stopVoiceNote() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    setPaused(false);
    clearVoiceTimer();
  }

  function discardVoiceNote() {
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    setVoiceBlob(null);
    setVoiceUrl(null);
    setVoiceMs(0);
  }

  async function sendVoiceNote() {
    if (!voiceBlob) return;
    const file = new File([voiceBlob], `voice-${Date.now()}.webm`, {
      type: voiceBlob.type || "audio/webm",
    });
    await uploadFile(file, `Voice note (${formatDuration(voiceMs)})`);
    discardVoiceNote();
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
      if (startNow && body.item?.id) {
        setActiveCallId(String(body.item.id));
        setCallNotice(`Live ${kind} room ready — joining…`);
      } else {
        setCallNotice(
          `Meeting scheduled for ${new Date(body.item.scheduled_at).toLocaleString()}.`
        );
      }
    } catch {
      setError("Connection lost — call not created");
    } finally {
      setBusyCall(false);
    }
  }

  function receiptLabel(m: Message): string {
    if (m.sender_id !== currentUserId) return "";
    const receipts = m.staff_message_receipts ?? [];
    const peer = receipts.find((r) => r.admin_id === peerAdminId);
    if (peer?.read_at) return "Read";
    if (peer?.delivered_at) return "Delivered";
    return "Sent";
  }

  const parentById = Object.fromEntries(messages.map((m) => [m.id, m]));

  return (
    <section
      ref={dropRef}
      className={[
        "cc-card space-y-4 p-5",
        dragOver ? "ring-2 ring-slate-400" : "",
      ].join(" ")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void uploadFile(f);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Internal communication
        </h2>
        <div className="flex items-center gap-2 text-xs text-[var(--cc-muted)]">
          {peerPresence ? (
            <span
              className={[
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
                peerPresence === "online"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-600",
              ].join(" ")}
            >
              <span
                className={[
                  "h-1.5 w-1.5 rounded-full",
                  peerPresence === "online" ? "bg-emerald-500" : "bg-slate-400",
                ].join(" ")}
              />
              {peerPresence}
            </span>
          ) : null}
          {unreadHint ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
              New message
            </span>
          ) : null}
        </div>
      </div>

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
          disabled={busyCall || !callCap?.canCreateLiveRoom}
          onClick={() => void startCall("audio", true)}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        >
          Audio call
        </button>
        <button
          type="button"
          disabled={busyCall || !callCap?.canCreateLiveRoom}
          onClick={() => void startCall("video", true)}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
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
          Live A/V SDK join blocked until TWILIO_API_KEY_SID/SECRET are set.
          SMS, Voice PSTN and Video room creation use existing Production
          secrets.
        </p>
      ) : null}

      <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-[var(--cc-border)] bg-slate-50 p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-[var(--cc-muted)]">No messages yet.</p>
        ) : (
          messages.map((m) => {
            const url = m.attachment_path
              ? signedUrls[m.attachment_path]
              : null;
            const parent = m.reply_to_message_id
              ? parentById[m.reply_to_message_id]
              : null;
            const reactions = m.staff_message_reactions ?? [];
            return (
              <div
                key={m.id}
                className={[
                  "max-w-[90%] rounded-2xl px-3 py-2 text-sm",
                  m.sender_id === currentUserId
                    ? "ml-auto bg-slate-900 text-white"
                    : "bg-white text-slate-800",
                ].join(" ")}
              >
                {parent ? (
                  <p className="mb-1 border-l-2 border-current/40 pl-2 text-[11px] opacity-70">
                    Reply to: {(parent.body || parent.message_type).slice(0, 80)}
                  </p>
                ) : null}
                {m.body ? <p>{m.body}</p> : null}
                {m.attachment_path && m.message_type === "image" && url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt=""
                    className="mt-2 max-h-48 rounded-lg"
                  />
                ) : null}
                {m.attachment_path && m.message_type === "audio" && url ? (
                  <audio controls src={url} className="mt-2 w-full" />
                ) : null}
                {m.attachment_path && m.message_type === "video" && url ? (
                  <video
                    controls
                    src={url}
                    className="mt-2 max-h-48 w-full rounded-lg"
                  />
                ) : null}
                {m.attachment_path && m.message_type === "file" && url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block text-xs underline"
                  >
                    Download document
                  </a>
                ) : null}
                {m.attachment_path && !url ? (
                  <p className="mt-1 text-[10px] opacity-70">
                    Loading secure preview…
                  </p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] opacity-80">
                  <span>{new Date(m.created_at).toLocaleTimeString()}</span>
                  {m.edited_at ? <span>· edited</span> : null}
                  {receiptLabel(m) ? <span>· {receiptLabel(m)}</span> : null}
                </div>
                {reactions.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {REACTIONS.map((emoji) => {
                      const count = reactions.filter(
                        (r) => r.emoji === emoji
                      ).length;
                      if (!count) return null;
                      return (
                        <span
                          key={emoji}
                          className="rounded-full bg-black/10 px-1.5 py-0.5 text-[11px]"
                        >
                          {emoji} {count}
                        </span>
                      );
                    })}
                  </div>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="text-[10px] underline opacity-70"
                    onClick={() => setReplyTo(m)}
                  >
                    Reply
                  </button>
                  {m.sender_id === currentUserId && m.message_type === "text" ? (
                    <button
                      type="button"
                      className="text-[10px] underline opacity-70"
                      onClick={() => {
                        setEditingId(m.id);
                        setText(m.body ?? "");
                      }}
                    >
                      Edit
                    </button>
                  ) : null}
                  {m.sender_id === currentUserId ? (
                    <button
                      type="button"
                      className="text-[10px] underline opacity-70"
                      onClick={() => void softDelete(m.id)}
                    >
                      Delete
                    </button>
                  ) : null}
                  {REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="text-[11px] opacity-80"
                      onClick={() => void react(m.id, emoji)}
                      title="React"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
        {typingPeer ? (
          <p className="text-xs text-[var(--cc-muted)]">Typing…</p>
        ) : null}
      </div>

      {replyTo ? (
        <div className="flex items-center justify-between rounded-xl border border-[var(--cc-border)] bg-slate-50 px-3 py-2 text-xs">
          <span>
            Replying to: {(replyTo.body || replyTo.message_type).slice(0, 60)}
          </span>
          <button type="button" onClick={() => setReplyTo(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      {editingId ? (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>Editing message</span>
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setText("");
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {voiceUrl ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--cc-border)] bg-slate-50 px-3 py-2">
          <audio controls src={voiceUrl} className="max-w-xs flex-1" />
          <span className="text-xs text-[var(--cc-muted)]">
            {formatDuration(voiceMs)}
          </span>
          <button
            type="button"
            onClick={() => void sendVoiceNote()}
            disabled={sending}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Send voice
          </button>
          <button
            type="button"
            onClick={discardVoiceNote}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
          >
            Delete
          </button>
        </div>
      ) : null}

      {recording ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-red-700">
          <span>
            {paused ? "Paused" : "Recording"} {formatDuration(voiceMs)}
          </span>
          {!paused ? (
            <button
              type="button"
              onClick={pauseVoiceNote}
              className="rounded border px-2 py-1"
            >
              Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={resumeVoiceNote}
              className="rounded border px-2 py-1"
            >
              Resume
            </button>
          )}
          <button
            type="button"
            onClick={stopVoiceNote}
            className="rounded bg-red-600 px-2 py-1 text-white"
          >
            Stop
          </button>
        </div>
      ) : null}

      {uploadProgress != null ? (
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-slate-900 transition-all"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      ) : null}

      <form
        onSubmit={(e) => void sendMessage(e)}
        className="flex flex-wrap gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => void setTyping(true)}
          onBlur={() => void setTyping(false)}
          placeholder={
            dragOver
              ? "Drop file to upload…"
              : editingId
                ? "Edit message…"
                : "Private message… (or drop a file)"
          }
          disabled={!conversationId || sending}
          className="min-w-0 flex-1 rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,audio/*,video/mp4,video/webm,application/pdf,text/plain,.doc,.docx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={!conversationId || sending}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
        >
          Attach
        </button>
        {!recording ? (
          <button
            type="button"
            disabled={!conversationId || sending}
            onClick={() => void startVoiceNote()}
            className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
          >
            Voice
          </button>
        ) : null}
        <button
          type="submit"
          disabled={!conversationId || sending || !text.trim()}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : editingId ? "Save" : "Send"}
        </button>
      </form>
      <p className="text-xs text-[var(--cc-muted)]">
        Private bucket + signed URLs. Drag-and-drop supported. Images 8MB ·
        Audio 15MB · Video 50MB · Docs 20MB.
      </p>

      {activeCallId ? (
        <StaffVideoRoom
          callId={activeCallId}
          onClose={() => setActiveCallId(null)}
        />
      ) : null}
    </section>
  );
}
