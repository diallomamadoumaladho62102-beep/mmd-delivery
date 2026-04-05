"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import JoinButton from "@/components/JoinButton";

type Profile = { full_name?: string | null; avatar_url?: string | null };

type Msg = {
  id: number;
  user_id: string;
  message: string | null;
  created_at: string;
  image_url?: string | null;    // chemin dans Storage (pas URL)
  profiles?: Profile | null;    // si FK vers profiles (facultatif)
  _signedUrl?: string | null;   // client-only (prévisualisation)
};

function getInitials(name?: string | null, fallback?: string) {
  const src = (name && name.trim()) || fallback || "";
  if (!src) return "";
  const parts = src.trim().split(/\s+/).slice(0, 2);
  const ini = parts.map(p => p[0]).join("") || src.slice(0, 2);
  return ini.toUpperCase();
}

// === Ajuste ce nom si ton bucket est différent (ex: "chat-images") ===
const CHAT_BUCKET = "chat-uploads";

export default function ChatPage() {
  // Next 16 en client: on récupère le param via useParams()
  const { orderId } = useParams<{ orderId: string }>();
  const orderIdStr = String(orderId);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isMember, setIsMember] = useState<boolean>(false);
  const [sending, setSending] = useState(false);

  // Pagination
  const PAGE_SIZE = 20;
  const [oldest, setOldest] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);

  // Avatars (URL publiques signées)
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});

  // Scroll
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollToBottom = () =>
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });

  // Signe un path Storage (URL temporaire 1h)
  async function signPath(path: string): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from(CHAT_BUCKET)
      .createSignedUrl(path, 60 * 60);
    return error ? null : data?.signedUrl ?? null;
  }

  // Résout avatar à partir de profiles.avatar_url (si c’est un path Storage)
  async function resolveAvatarUrl(raw?: string | null): Promise<string | null> {
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw; // déjà une URL
    // sinon on suppose un path dans un bucket public "avatars"
    const { data } = supabase.storage.from("avatars").getPublicUrl(raw);
    return data?.publicUrl ?? null;
  }

  // Qui suis-je ?
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
    })();
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Vérifier l’adhésion
  useEffect(() => {
    if (!userId || !orderIdStr) return;
    (async () => {
      const { data } = await supabase
        .from("order_members")
        .select("order_id")
        .eq("order_id", orderIdStr)
        .eq("user_id", userId)
        .maybeSingle();
      setIsMember(!!data);
    })();
  }, [orderIdStr, userId]);

  // Chargement initial (avec join profiles si dispo)
  useEffect(() => {
    if (!isMember || !orderIdStr) return;

    (async () => {
      const { data, error } = await supabase
        .from("order_messages")
        .select("id,user_id,message,image_url,created_at,profiles(full_name,avatar_url)")
        .eq("order_id", orderIdStr)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (error) {
        setErr(error.message);
        return;
      }

      // Chrono croissant pour affichage
      const rows = (data as Msg[]).slice().reverse();

      // Signer images
      const signed = await Promise.all(
        rows.map(async (m) => {
          const _signedUrl = m.image_url ? await signPath(m.image_url) : null;
          return { ...m, _signedUrl };
        })
      );

      // Préparer avatars (si profile)
      const entries = await Promise.all(
        signed.map(async (m) => {
          const url = await resolveAvatarUrl(m.profiles?.avatar_url ?? null);
          return [m.user_id, url] as const;
        })
      );
      const map: Record<string, string | null> = {};
      entries.forEach(([uid, url]) => {
        if (url && !map[uid]) map[uid] = url;
      });

      setAvatars((prev) => ({ ...map, ...prev }));
      setMessages(signed.filter(m => (m.message ?? "").trim() !== "" || m._signedUrl));
      setOldest(signed.length ? signed[0].created_at : null);
      setHasMore((data ?? []).length === PAGE_SIZE);
      scrollToBottom();
    })();
  }, [orderIdStr, isMember]);

  // Realtime: sur INSERT, on recharge la ligne (avec profiles) et on signe si image
  useEffect(() => {
    if (!isMember || !orderIdStr) return;

    const ch = supabase
      .channel(`order_chat_${orderIdStr}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_messages", filter: `order_id=eq.${orderIdStr}` },
        async (p) => {
          const newId = (p.new as any).id;
          const { data: row } = await supabase
            .from("order_messages")
            .select("id,user_id,message,image_url,created_at,profiles(full_name,avatar_url)")
            .eq("id", newId)
            .maybeSingle();

          let m = (row as Msg) ?? (p.new as Msg);
          const _signedUrl = m.image_url ? await signPath(m.image_url) : null;
          m = { ...m, _signedUrl };

          // avatar si pas encore résolu
          if (!avatars[m.user_id]) {
            const a = await resolveAvatarUrl(m.profiles?.avatar_url ?? null);
            if (a) setAvatars(prev => ({ ...prev, [m.user_id]: a }));
          }

          setMessages(prev => [...prev, m]);
          scrollToBottom();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [orderIdStr, isMember, avatars]);

  // Charger plus (pagination)
  async function loadMore() {
    if (loadingMore || !hasMore || !oldest) return;
    setLoadingMore(true);

    const { data, error } = await supabase
      .from("order_messages")
      .select("id,user_id,message,image_url,created_at,profiles(full_name,avatar_url)")
      .eq("order_id", orderIdStr)
      .lt("created_at", oldest)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    setLoadingMore(false);

    if (error) {
      setErr(error.message);
      return;
    }

    const rows = (data as Msg[]).slice().reverse();
    const signed = await Promise.all(
      rows.map(async (m) => {
        const _signedUrl = m.image_url ? await signPath(m.image_url) : null;
        return { ...m, _signedUrl };
      })
    );

    setMessages(prev => [...signed, ...prev]);
    if (signed.length) setOldest(signed[0].created_at);
    setHasMore((data ?? []).length === PAGE_SIZE);
  }

  // Envoi (optimiste + upload image privé)
  async function send() {
    setErr(null);
    if (!userId) return setErr("Tu dois être connecté.");
    if (!isMember) return setErr("Active d’abord l’accès au chat.");

    const body = text.trim();
    const hasImage = !!file;
    if (!body && !hasImage) return;

    setSending(true);

    // Upload image si besoin
    let storagePath: string | null = null;
    let signedUrl: string | null = null;

    if (file) {
      const clean = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${orderIdStr}/${userId}/${Date.now()}_${clean}`;
      const { error: upErr } = await supabase.storage
        .from(CHAT_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) {
        setSending(false);
        setErr(upErr.message);
        return;
      }
      storagePath = path;
      signedUrl = await signPath(path);
    }

    // Message optimiste
    const temp: Msg = {
      id: Date.now(),
      user_id: userId,
      message: body || null,
      image_url: storagePath,
      _signedUrl: signedUrl ?? null,
      created_at: new Date().toISOString(),
      profiles: { full_name: "Moi", avatar_url: null },
    };

    setMessages(prev => [...prev, temp]);
    setText("");
    setFile(null);
    scrollToBottom();

    // Écriture en DB — si RLS bloque l’INSERT direct, utilise RPC post_message
    const { data: inserted, error } = await supabase
      .from("order_messages")
      .insert({
        order_id: orderIdStr,
        user_id: userId,
        message: body || null,
        image_url: storagePath,
      })
      .select("id")
      .single();

    setSending(false);

    if (error) {
      setErr(error.message);
      return;
    }

    if (inserted?.id) {
      // remplace l’ID temporaire par l’ID réel si le realtime n’est pas encore passé
      setMessages(prev => prev.map(m => (m.id === temp.id ? { ...m, id: inserted.id } : m)));
    }
  }

  // Groupage par jour (séparateurs)
  const grouped = useMemo(() => {
    const out: { date: string; items: Msg[] }[] = [];
    for (const m of messages) {
      const key = new Date(m.created_at).toLocaleDateString();
      const last = out[out.length - 1];
      if (!last || last.date !== key) out.push({ date: key, items: [m] });
      else last.items.push(m);
    }
    return out;
  }, [messages]);

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Chat commande #{orderIdStr.slice(0, 8)}</h1>

      <div className="text-sm">
        {isMember ? (
          <span className="px-2 py-1 rounded bg-green-100 text-green-700 border border-green-300">
            Accès activé ✅
          </span>
        ) : (
          <span className="px-2 py-1 rounded bg-yellow-100 text-yellow-700 border border-yellow-300">
            Accès non activé
          </span>
        )}
      </div>

      {!isMember && <JoinButton orderId={orderIdStr} />}

      {err && (
        <div className="bg-red-100 text-red-700 border border-red-300 rounded p-2">
          <b>Erreur :</b> {err}
        </div>
      )}

      {isMember ? (
        <>
          {hasMore && (
            <div className="flex justify-center mb-2">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-3 py-1 rounded border text-sm disabled:opacity-50"
              >
                {loadingMore ? "Chargement…" : "Charger plus"}
              </button>
            </div>
          )}

          <div ref={listRef} className="space-y-3 bg-gray-50 rounded-2xl p-4 h-[60vh] overflow-auto">
            {grouped.map(({ date, items }) => (
              <div key={date} className="space-y-2">
                <div className="text-center text-xs text-gray-500">{date}</div>
                {items.map((m) => {
                  const isMine = userId ? m.user_id === userId : false;
                  const at = new Date(m.created_at).toLocaleTimeString();
                  const name =
                    m.profiles?.full_name?.trim() ||
                    (isMine ? "Moi" : m.user_id.slice(0, 6));
                  const avatar = avatars[m.user_id] ?? null;

                  return (
                    <div key={m.id} className={`flex items-start gap-2 ${isMine ? "justify-end" : "justify-start"}`}>
                      {!isMine && (
                        <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center overflow-hidden shrink-0">
                          {avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatar} alt={name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xs text-gray-700">{getInitials(m.profiles?.full_name, m.user_id)}</span>
                          )}
                        </div>
                      )}

                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow ${isMine ? "bg-black text-white" : "bg-white text-gray-800"}`}>
                        <div className="opacity-70 text-[11px]">
                          {name} • {at}
                        </div>

                        {m.message && (
                          <div className="mt-0.5 whitespace-pre-wrap break-words">{m.message}</div>
                        )}

                        {(m._signedUrl) && (
                          <div className="mt-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={m._signedUrl}
                              alt="Pièce jointe"
                              className="max-h-64 rounded-lg border"
                            />
                          </div>
                        )}
                      </div>

                      {isMine && (
                        <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center overflow-hidden shrink-0">
                          {avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatar} alt={name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xs text-gray-700">{getInitials(m.profiles?.full_name, m.user_id)}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {messages.length === 0 && (
              <p className="text-gray-500">Aucun message pour le moment.</p>
            )}
          </div>

          <div className="mt-3 flex gap-2 items-end">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              })}
              placeholder="Écrire un message…"
              className="flex-1 border rounded px-3 py-2 h-24"
            />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="border rounded px-2 py-2"
            />
            <button
              onClick={send}
              disabled={sending}
              className="px-4 py-2 rounded bg-black text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {sending ? "Envoi…" : "Envoyer"}
            </button>
          </div>
        </>
      ) : (
        <p className="text-gray-500">Clique “Activer accès chat”, puis rafraîchis la page.</p>
      )}
    </main>
  );
}
