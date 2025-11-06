"use client";
import RecalcOrderButton from '@/components/RecalcOrderButton';

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Msg = {
  id: number;
  order_id: string;
  user_id: string | null;
  message: string;
  image_path?: string | null;
  created_at: string;
  profiles?: { full_name?: string | null; avatar_url?: string | null } | null;
};

export default function ChatBox({ orderId }: { orderId: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // qui suis-je ?
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));

    // charge l'historique
    (async () => {
      const { data, error } = await supabase
        .from("order_messages")
        .select(`
          id, order_id, user_id, message, image_path, created_at,
          profiles:profiles!order_messages_user_id_fkey(full_name, avatar_url)
        `)
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (!error) setMsgs((data ?? []) as Msg[]);
    })();

    // realtime
    const channel = supabase
      .channel(`realtime:order_messages:${orderId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_messages", filter: `order_id=eq.${orderId}` },
        (payload: any) => {
          setMsgs((old) => [...old, payload.new as Msg]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId]);

  useEffect(() => {
    // autoscroll bottom
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  const send = async () => {
    const text = input.trim();
    if (!text && !file) return;

    try {
      setSending(true);

      // UID pour l'insert
      let uid = me;
      if (!uid) {
        const { data } = await supabase.auth.getUser();
        uid = data.user?.id ?? null;
      }

      let image_path: string | null = null;

      if (file) {
        const filename = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const objectPath = `${orderId}/${filename}`;

        const { error: upErr } = await supabase
          .storage
          .from("chat-images")
          .upload(objectPath, file, { cacheControl: "3600", upsert: false });

        if (upErr) throw new Error(`Upload image: ${upErr.message}`);
        image_path = objectPath;
      }

      const { error: insErr } = await supabase.from("order_messages").insert({
        order_id: orderId,
        user_id: uid,
        message: text || "",
        image_path
      });
      if (insErr) throw new Error(`Insert message: ${insErr.message}`);

      setInput("");
      setFile(null);
    } catch (e: any) {
      alert(e?.message ?? "Erreur inconnue");
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const publicUrl = (p?: string | null) =>
    p ? supabase.storage.from("chat-images").getPublicUrl(p).data.publicUrl : null;

  return (
    <div className="flex items-center gap-3 mb-3">
  <RecalcOrderButton orderId={orderId} />
</div>
<div className="rounded-xl border">
      <div className="flex items-center gap-3 mb-3">
  <RecalcOrderButton orderId={orderId} />
</div>
<div ref={listRef} className="p-3 space-y-3 h-80 overflow-y-auto bg-white">
        {msgs.length === 0 && <p className="text-gray-500">Aucun message pour le moment.</p>}
        {msgs.map((m) => {
          const isMine = m.user_id && me && m.user_id === me;
          const fallbackId = (m.user_id ?? "").slice(0, 6) || "??????";
          const name = m.profiles?.full_name ?? (isMine ? "Moi" : fallbackId);
          const time = new Date(m.created_at).toLocaleTimeString();
          const img = publicUrl(m.image_path);
          return (
            <div className="flex items-center gap-3 mb-3">
  <RecalcOrderButton orderId={orderId} />
</div>
<div key={m.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
              <div className="flex items-center gap-3 mb-3">
  <RecalcOrderButton orderId={orderId} />
</div>
<div className={`max-w-[80%] rounded-2xl px-3 py-2 ${isMine ? "bg-black text-white" : "bg-gray-100"}`}>
                <div className="flex items-center gap-3 mb-3">
  <RecalcOrderButton orderId={orderId} />
</div>
<div className="text-xs opacity-70">{name} • {time}</div>
                {m.message?.trim() && <div className="flex items-center gap-3 mb-3">
  <RecalcOrderButton orderId={orderId} />
</div>
<div className="whitespace-pre-wrap break-words">{m.message}</div>}
                {img && (
                  <div className="flex items-center gap-3 mb-3">
  <RecalcOrderButton orderId={orderId} />
</div>
<div className="mt-2">
                    <img src={img} alt="Pièce jointe" className="max-w-xs max-h-72 rounded border" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mb-3">
  <RecalcOrderButton orderId={orderId} />
</div>
<div className="p-3 border-t flex flex-col gap-2">
        <div className="flex items-center gap-3 mb-3">
  <RecalcOrderButton orderId={orderId} />
</div>
<div className="flex items-end gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Écrire un message…"
            className="flex-1 border rounded-xl px-3 py-2"
          />
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="border rounded px-2 py-2"
          />
          <button
            onClick={send}
            disabled={(input.trim() === "" && !file) || sending}
            className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-40"
          >
            {sending ? "Envoi…" : "Envoyer"}
          </button>
        </div>
        {file && <div className="flex items-center gap-3 mb-3">
  <RecalcOrderButton orderId={orderId} />
</div>
<div className="text-xs text-gray-600">Fichier: {file.name}</div>}
      </div>
    </div>
  );
}


