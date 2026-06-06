"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/adminBrowserAuth";

type Channel = "push" | "sms" | "email";

type LookupUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  has_push_token: boolean;
  push_token_count: number;
  has_email: boolean;
  has_phone: boolean;
};

export default function AdminCommunicationPanel() {
  const [channel, setChannel] = useState<Channel>("push");
  const [searchQuery, setSearchQuery] = useState("");
  const [lookupResults, setLookupResults] = useState<LookupUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<LookupUser | null>(null);
  const [userId, setUserId] = useState("");
  const [to, setTo] = useState("");
  const [title, setTitle] = useState("MMD Delivery");
  const [subject, setSubject] = useState("MMD Delivery");
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function searchUsers() {
    const q = searchQuery.trim();
    if (!q) return;

    setSearching(true);
    setResult(null);
    setErrorCode(null);

    const res = await adminFetch(
      `/api/admin/communication/lookup?q=${encodeURIComponent(q)}`
    );
    const body = await res.json().catch(() => ({}));
    setSearching(false);

    if (!res.ok || !body.ok) {
      setResult(String(body.error ?? "Recherche échouée"));
      setLookupResults([]);
      return;
    }

    setLookupResults((body.items ?? []) as LookupUser[]);
    if ((body.items ?? []).length === 0) {
      setResult("Aucun utilisateur trouvé.");
    }
  }

  function pickUser(user: LookupUser) {
    setSelectedUser(user);
    setUserId(user.id);
    setLookupResults([]);
    setResult(null);
    setErrorCode(null);
  }

  async function send() {
    setSending(true);
    setResult(null);
    setErrorCode(null);

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
      setErrorCode(body.code ? String(body.code) : null);
      setResult(
        body.error ??
          (body.code ? String(body.code) : "Échec envoi")
      );
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

      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold text-slate-600">
          Rechercher un destinataire (email, nom ou téléphone)
        </p>
        <div className="flex gap-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="email@exemple.com ou +1… ou nom"
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={searching || !searchQuery.trim()}
            onClick={() => void searchUsers()}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {searching ? "…" : "Chercher"}
          </button>
        </div>

        {lookupResults.length > 0 ? (
          <ul className="space-y-1">
            {lookupResults.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => pickUser(user)}
                  className="w-full rounded-lg border border-white bg-white px-3 py-2 text-left text-sm hover:border-slate-300"
                >
                  <div className="font-medium text-slate-900">
                    {user.full_name ?? "—"} · {user.role ?? "—"}
                  </div>
                  <div className="text-xs text-slate-500">{user.email ?? "—"}</div>
                  <div className="font-mono text-xs text-slate-500">{user.id}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Push: {user.has_push_token ? `oui (${user.push_token_count})` : "non"} ·
                    Email: {user.has_email ? "oui" : "non"} · Tél:{" "}
                    {user.has_phone ? "oui" : "non"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <input
        value={userId}
        onChange={(e) => {
          setUserId(e.target.value);
          setSelectedUser(null);
        }}
        placeholder="User ID UUID Supabase (obligatoire pour push)"
        className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
      />

      {selectedUser ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Sélectionné : {selectedUser.full_name ?? selectedUser.email ?? selectedUser.id}
          {channel === "push" && !selectedUser.has_push_token
            ? " — aucun expo_push_token"
            : null}
          {channel === "email" && !selectedUser.has_email ? " — email manquant" : null}
          {channel === "sms" && !selectedUser.has_phone ? " — téléphone manquant" : null}
        </div>
      ) : null}

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
        <p
          className={`text-sm ${
            errorCode ? "text-red-700" : "text-slate-600"
          }`}
        >
          {errorCode ? `[${errorCode}] ` : ""}
          {result}
        </p>
      ) : null}

      <p className="text-xs text-slate-500">
        Chaque envoi est journalisé dans admin_communication_logs et
        admin_audit_logs. Le push nécessite un UUID Supabase et un
        expo_push_token enregistré.
      </p>
    </div>
  );
}
