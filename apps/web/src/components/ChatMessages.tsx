// apps/web/src/components/ChatMessages.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Row = {
  id: number;
  order_id: string;
  user_id: string;
  text: string | null;
  image_path: string | null;
  created_at: string;
  _signedUrl?: string | null;
};

export default function ChatMessages({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // ✅ anti double-load concurrent
  const loadingRef = useRef(false);

  // ✅ cache signed urls (par image_path)
  const signedUrlCacheRef = useRef<Map<string, string | null>>(new Map());

  // ✅ timer fallback (si realtime ne refresh pas)
  const fallbackReloadRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToEnd = () => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  };

  async function getSignedUrlCached(image_path: string) {
    const key = image_path.replace(/^chat-images\//, "");

    if (signedUrlCacheRef.current.has(image_path)) {
      return signedUrlCacheRef.current.get(image_path) ?? null;
    }

    const { data: signed } = await supabase.storage
      .from("chat-images")
      .createSignedUrl(key, 60 * 30);

    const url = signed?.signedUrl ?? null;
    signedUrlCacheRef.current.set(image_path, url);
    return url;
  }

  async function load() {
    if (!orderId) return;
    if (loadingRef.current) return;

    loadingRef.current = true;
    try {
      const { data, error } = await supabase
        .from("order_messages")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error(error.message);
        return;
      }

      const base = (data || []) as Row[];

      const enriched: Row[] = await Promise.all(
        base.map(async (r) => {
          if (r.image_path) {
            const url = await getSignedUrlCached(r.image_path);
            return { ...r, _signedUrl: url };
          }
          return { ...r, _signedUrl: null };
        })
      );

      setRows(enriched);
      setTimeout(scrollToEnd, 50);
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    // reset caches per order
    signedUrlCacheRef.current = new Map();
    setRows([]);
    void load();

    const ch = supabase
      .channel(`order_messages:${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_messages",
          filter: `order_id=eq.${orderId}`,
        },
        () => {
          // realtime refresh
          void load();
        }
      )
      .subscribe();

    return () => {
      if (fallbackReloadRef.current) {
        clearTimeout(fallbackReloadRef.current);
        fallbackReloadRef.current = null;
      }
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function send() {
    if (!text && !file) return;
    if (!orderId) return;

    setSending(true);
    try {
      let image_path: string | null = null;

      if (file) {
        const uid = (await supabase.auth.getUser()).data.user?.id ?? "anon";
        const ext = file.name.split(".").pop() || "jpg";
        const key = `${orderId}/${Date.now()}_${Math.random().toString(36).slice(2)}_${uid}.${ext}`;

        const { error: upErr } = await supabase.storage.from("chat-images").upload(key, file, {
          cacheControl: "3600",
          upsert: false,
        });
        if (upErr) throw upErr;

        image_path = `chat-images/${key}`;
        // cache bust pour cette image
        signedUrlCacheRef.current.delete(image_path);
      }

      const { error: insErr } = await supabase.from("order_messages").insert({
        order_id: orderId,
        text: text || null,
        image_path,
      } as any);

      if (insErr) throw insErr;

      setText("");
      setFile(null);

      // ✅ IMPORTANT:
      // Ne pas appeler load() ici, car realtime va recharger.
      // Fallback si realtime ne déclenche pas (ou est lent).
      if (fallbackReloadRef.current) clearTimeout(fallbackReloadRef.current);
      fallbackReloadRef.current = setTimeout(() => {
        void load();
        fallbackReloadRef.current = null;
      }, 800);
    } catch (e: any) {
      alert(e.message || String(e));
    } finally {
      setSending(false);
    }
  }

  async function del(id: number, imagePath: string | null) {
    if (imagePath) {
      const key = imagePath.replace(/^chat-images\//, "");
      const { error: delObjErr } = await supabase.storage.from("chat-images").remove([key]);
      if (delObjErr) {
        console.warn("Storage remove failed:", delObjErr.message);
      }
      signedUrlCacheRef.current.delete(imagePath);
    }

    const { error: rpcErr } = await supabase.rpc("delete_order_message", { p_msg_id: id });
    if (rpcErr) {
      alert(rpcErr.message);
      return;
    }

    // ✅ update UI sans refetch
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="space-y-3">
      <div ref={listRef} className="h-96 overflow-y-auto rounded-xl border p-3">
        {rows.map((r) => (
          <div key={r.id} className="mb-3">
            <div className="text-xs text-gray-500">
              {new Date(r.created_at).toLocaleString()}
            </div>

            {r.text && <div className="whitespace-pre-wrap">{r.text}</div>}

            {r._signedUrl && (
              <a href={r._signedUrl} target="_blank" rel="noreferrer" className="block mt-1">
                <img src={r._signedUrl} alt="image" className="max-h-60 rounded-lg" />
              </a>
            )}

            <button
              onClick={() => del(r.id, r.image_path)}
              className="text-red-600 text-xs mt-1 hover:underline"
            >
              supprimer
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2 items-center">
        <input
          className="flex-1 border rounded-lg px-3 py-2"
          placeholder="Écrire un message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />

        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <button
          onClick={() => void send()}
          disabled={sending}
          className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-50"
        >
          Envoyer
        </button>
      </div>
    </div>
  );
}
