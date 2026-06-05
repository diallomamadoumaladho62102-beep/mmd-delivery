"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/adminBrowserAuth";

type Channel = "push" | "sms" | "email";

export default function AdminCommunicationPanel() {
  const [channel, setChannel] = useState<Channel>("push");
  const [userId, setUserId] = useState("");
  const [to, setTo] = useState("");
  const [title, setTitle] = useState("MMD Delivery");
  const [subject, setSubject] = useState("MMD Delivery");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setResult(null);
    const res = await adminFetch("/api/admin/communication/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        userId: userId.trim() || undefined,
        to: to.trim() || undefined,
        title,
        subject,
        message,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok || !body.ok) {
      setResult(body.error ?? "Échec envoi");
      return;
    }
    setResult(`Envoyé via ${channel}`);
    setMessage("");
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {(["push", "sms", "email"] as Channel[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              channel === c ? "bg-black text-white" : "border border-slate-300"
            }`}
          >
            {c.toUpperCase()}
          </button>
        ))}
      </div>

      <input
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        placeholder="User ID (obligatoire pour push)"
        className="w-full rounded-lg border px-3 py-2 text-sm"
      />

      {(channel === "sms" || channel === "email") && (
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={channel === "sms" ? "Téléphone +1…" : "email@…"}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
      )}

      {channel === "push" && (
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre notification"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
      )}

      {channel === "email" && (
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Sujet email"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
      )}

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Message"
        rows={4}
        className="w-full rounded-lg border px-3 py-2 text-sm"
      />

      <button
        type="button"
        disabled={sending || !message.trim()}
        onClick={() => void send()}
        className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {sending ? "Envoi…" : "Envoyer"}
      </button>

      {result ? (
        <p className="text-sm text-slate-600">{result}</p>
      ) : null}

      <p className="text-xs text-slate-500">
        Chaque envoi est journalisé dans admin_communication_logs et admin_audit_logs.
      </p>
    </div>
  );
}
