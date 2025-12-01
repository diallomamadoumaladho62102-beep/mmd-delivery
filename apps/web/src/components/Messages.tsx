"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseBrowser";

type Msg = {
  id: number;
  order_id: string;
  user_id: string;
  message: string;
  created_at: string;
  image_path?: string | null;
  _optimistic?: boolean;       // client-only
  _imageUrl?: string | null;   // client-only (URL publique)
};

type Profile = { id: string; full_name?: string | null; avatar_url?: string | null };

function getInitials(name?: string | null) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "";
  return parts.map((p) => p[0]).join("").toUpperCase();
}

function formatTs(ts: string) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function publicUrl(path?: string | null) {
  if (!path) return null;
  const { data } = supabase.storage.from("chat-uploads").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function Avatar({ name, url }: { name?: string | null; url?: string | null }) {
  const initials = getInitials(name);
  return url ? (
    <img
      src={url}
      alt={name ?? "avatar"}
      className="h-8 w-8 rounded-full object-cover ring-1 ring-black/5"
    />
  ) : (
    <div className="h-8 w-8 rounded-full bg-gray-300 grid place-items-center text-xs font-semibold text-gray-700">
      {initials || "👤"}
    </div>
  );
}

export default function Messages({ orderId }: { orderId: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isMember, setIsMember] = useState<boolean | null>(null);

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const mounted = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Scroll en bas à chaque refresh
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  // Focus au chargement
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Utilisateur courant + membership
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id ?? null;
      setCurrentUserId(uid);

      if (uid) {
        const { data: mem, error: memErr } = await supabase
          .from("order_members")
          .select("order_id")
          .eq("order_id", orderId)
          .eq("user_id", uid)
          .limit(1);

        if (memErr) {
          console.warn("order_members read policy?", memErr);
          setIsMember(false);
        } else {
          setIsMember(!!mem?.length);
        }
      } else {
        setIsMember(false);
      }
    })();
  }, [orderId]);

  async function load() {
    setErr(null);
    const { data, error } = await supabase
      .from("order_messages")
      .select("id, order_id, user_id, message, created_at, image_path")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("load messages error:", error);
      setErr(error.message);
      return;
    }
    if (!mounted.current) return;

    const enriched: Msg[] = (data ?? []).map((m) => ({
      ...m,
      _imageUrl: publicUrl(m.image_path),
    }));
    setMsgs(enriched);

    // Charger les profils (uniques)
    const ids = Array.from(new Set((data ?? []).map((m) => m.user_id)));
    if (ids.length) {
      const { data: profs, error: pErr } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", ids);

      if (pErr) {
        console.warn("profiles read policy?", pErr);
      } else if (profs) {
        const map: Record<string, Profile> = {};
        for (const p of profs) map[p.id] = p;
        if (mounted.current) setProfiles(map);
      }
    } else {
      setProfiles({});
    }
  }

  // Realtime
  useEffect(() => {
    mounted.current = true;
    void load();

    const ch = supabase
      .channel(`omsg_${orderId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_messages", filter: `order_id=eq.${orderId}` },
        () => mounted.current && load()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "order_messages", filter: `order_id=eq.${orderId}` },
        () => mounted.current && load()
      )
      .subscribe();

    return () => {
      mounted.current = false;
      supabase.removeChannel(ch);
    };
  }, [orderId]);

  async function send() {
    try {
      const raw = text.replace(/\s+/g, " ").trim();
      const hasText = raw.length > 0;
      const hasFile = !!file;

      if (!hasText && !hasFile) return;
      if (hasText && raw.length > 500) throw new Error("Message trop long (max 500 caractères).");

      setSending(true);
      setErr(null);

      const { data: { user }, error: uerr } = await supabase.auth.getUser();
      if (uerr) throw uerr;
      if (!user) throw new Error("Veuillez vous connecter.");

      // Vérifie membership
      const { data: mem, error: memErr } = await supabase
        .from("order_members")
        .select("order_id")
        .eq("order_id", orderId)
        .eq("user_id", user.id)
        .limit(1);

      if (memErr) throw memErr;
      if (!mem?.length) {
        setIsMember(false);
        throw new Error("Tu dois rejoindre la commande avant d'écrire.");
      }

      // 1) Upload fichier si présent
      let image_path: string | null = null;
      if (hasFile && file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const key = `${orderId}/${user.id}/${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("chat-uploads")
          .upload(key, file, { cacheControl: "3600", upsert: false, contentType: file.type });

        if (upErr) throw upErr;
        image_path = key;
      }

      // 2) Optimistic UI
      const temp: Msg = {
        id: Date.now(),
        order_id: orderId,
        user_id: user.id,
        message: raw,
        created_at: new Date().toISOString(),
        image_path,
        _optimistic: true,
        _imageUrl: publicUrl(image_path),
      };
      setMsgs((prev) => [...prev, temp]);
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = ""; // reset input

      // 3) Insert DB
      const { error } = await supabase
        .from("order_messages")
        .insert({ order_id: orderId, user_id: user.id, message: raw, image_path });

      if (error) throw error;

      // 4) Sync
      void load();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  }

  const inputDisabled = sending || (!text.trim() && !file) || isMember === false;

  return (
    <div className="space-y-3">
      <div ref={listRef} className="max-h-80 overflow-auto border rounded-lg p-3 bg-white">
        {msgs.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Aucun message pour le moment.</p>
        ) : (
          <ul className="space-y-3">
            {msgs.map((m) => {
              const prof = profiles[m.user_id];
              const name = prof?.full_name || m.user_id.slice(0, 8);
              const isMine = m.user_id === currentUserId;

              return (
                <li key={m.id} className={`flex gap-2 ${isMine ? "justify-end" : "justify-start"}`}>
                  {!isMine && <Avatar name={prof?.full_name} url={prof?.avatar_url} />}

                  <div className={`max-w-[80%] ${isMine ? "items-end text-right" : "items-start text-left"} flex flex-col`}>
                    <span className="text-[11px] text-gray-500">{name}</span>

                    <div
                      className={[
                        "rounded-2xl px-3 py-2 text-sm shadow-sm space-y-1",
                        isMine ? "bg-black text-white rounded-br-sm" : "bg-gray-100 text-gray-900 rounded-bl-sm",
                        m._optimistic ? "opacity-70" : "",
                      ].join(" ")}
                    >
                      {m.message && <div className="leading-relaxed whitespace-pre-wrap">{m.message}</div>}
                      {m._imageUrl && (
                        <a href={m._imageUrl} target="_blank" rel="noreferrer" className="block">
                          <img
                            src={m._imageUrl}
                            alt="image"
                            className="max-h-60 rounded-lg ring-1 ring-black/5"
                            loading="lazy"
                          />
                        </a>
                      )}
                      <div className={`mt-1 text-[10px] ${isMine ? "text-gray-300" : "text-gray-500"}`}>
                        {formatTs(m.created_at)}
                        {m._optimistic ? " • envoi…" : ""}
                      </div>
                    </div>
                  </div>

                  {isMine && <Avatar name={prof?.full_name} url={prof?.avatar_url} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isMember === false && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
          Tu dois <strong>rejoindre la commande</strong> avant d’écrire.
        </p>
      )}

      {/* Zone saisie + upload */}
      <div className="flex flex-col gap-2">
        {/* Preview fichier */}
        {file && (
          <div className="flex items-center gap-2 text-sm">
            <span className="px-2 py-1 bg-gray-200 rounded">{file.name}</span>
            <button
              type="button"
              className="text-red-600 underline"
              onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
            >
              retirer
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Écrire un message…"
            className="flex-1 border rounded-lg px-3 py-2"
            disabled={isMember === false}
          />

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-48 text-sm file:mr-3 file:rounded-lg file:border file:px-3 file:py-2 file:bg-white file:hover:bg-gray-50 file:border-gray-300"
            disabled={isMember === false}
          />

          <button
            onClick={send}
            disabled={inputDisabled}
            className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
          >
            Envoyer
          </button>
        </div>
      </div>

      {err && <p className="text-red-600 text-sm">Erreur : {err}</p>}
    </div>
  );
}


