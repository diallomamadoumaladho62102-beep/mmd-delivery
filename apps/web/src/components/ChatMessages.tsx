'use client';
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Row = {
  id: string | number;            // ← compat UUID ou bigint
  order_id: string;
  user_id: string;
  content: string | null;
  image_path: string | null;
  created_at: string;
};

type Profile = { id: string; full_name?: string | null };

const PAGE = 50;

async function signUrl(path: string) {
  try {
    const { data, error } = await supabase.storage
      .from("chat-images")
      .createSignedUrl(path, 60 * 60); // 1h
    if (error) throw error;
    return data?.signedUrl ?? null;
  } catch { return null; }
}

export default function ChatMessages({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  const [from, setFrom] = useState<number | null>(null); // pagination cursor (offset)
  const [hasMore, setHasMore] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUid(session?.user?.id ?? null);
    })();
  }, []);

  const loadBatch = useCallback(async (initial = false) => {
    try {
      setLoading(true); setErr(null);

      // total
      const { count } = await supabase
        .from("order_messages")
        .select("*", { count: "exact", head: true })
        .eq("order_id", orderId);
      const total = count ?? 0;

      // window
      let start = 0, end = PAGE - 1;
      if (initial) {
        start = Math.max(0, total - PAGE);
        end   = Math.max(-1, total - 1);
        setFrom(start);
      } else if (from !== null) {
        const nextStart = Math.max(0, from - PAGE);
        const nextEnd   = Math.max(-1, from - 1);
        start = nextStart; end = nextEnd;
        setFrom(nextStart);
      }

      if (total === 0) { setRows([]); setHasMore(false); return; }
      if (!initial && (from === 0 || from === null)) { setHasMore(false); return; }

      const { data, error } = await supabase
        .from("order_messages")
        .select("id, order_id, user_id, content, image_path, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true })
        .range(start, end);
      if (error) throw error;

      const list = (data as Row[]) ?? [];
      if (initial) setRows(list);
      else setRows(prev => [...list, ...prev]);

      // profils
      const uids = Array.from(new Set(list.map(x => x.user_id))).filter(Boolean);
      if (uids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", uids);
        const map: Record<string, Profile> = {};
        (profs ?? []).forEach((p: any) => map[p.id] = p);
        setProfiles(prev => ({ ...map, ...prev }));
      }

      // URLs signées
      const paths = Array.from(new Set(list.map(x => x.image_path).filter(Boolean) as string[]));
      const signedMap: Record<string, string> = {};
      for (const p of paths) {
        const url = await signUrl(p);
        if (url) signedMap[p] = url;
      }
      setSigned(prev => ({ ...signedMap, ...prev }));

      if (initial) queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (e:any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [orderId, from]);

  useEffect(() => {
    setRows([]); setFrom(null); setHasMore(true);
    void loadBatch(true);

    const ch = supabase.channel(`chat-${orderId}`);
    ch.on("postgres_changes",
      { event: "INSERT", schema: "public", table: "order_messages", filter: `order_id=eq.${orderId}` },
      async (payload: any) => {
        const newRow = payload.new as Row;
        setRows(prev => [...prev, newRow]);

        // profil si besoin
        const u = newRow.user_id;
        if (u && !profiles[u]) {
          const { data: prof } = await supabase.from("profiles").select("id, full_name").eq("id", u).maybeSingle();
          if (prof) setProfiles(p => ({ ...p, [u]: prof as Profile }));
        }
        // signer image
        if (newRow.image_path && !signed[newRow.image_path]) {
          const url = await signUrl(newRow.image_path);
          if (url) setSigned(s => ({ ...s, [newRow.image_path!]: url }));
        }
        queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
    ).subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [orderId]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop < 40 && hasMore && !loading) {
      const pos = el.scrollHeight - el.scrollTop;
      void loadBatch(false).then(() => {
        queueMicrotask(() => {
          if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight - pos;
          }
        });
      });
    }
  }

  async function del(id: string | number) {
    if (!confirm("Supprimer ce message ?")) return;

    const isNumberLike = (v: any) => /^\d+$/.test(String(v));

    // choisir la bonne RPC
    let rpc = '';
    let params: any = {};
    if (typeof id === 'number' || isNumberLike(id)) {
      rpc = 'delete_order_message';         // bigint
      params = { p_msg_id: Number(id) };
    } else {
      rpc = 'delete_order_message_uuid';    // uuid
      params = { p_msg_id: String(id) };
    }

    const { error } = await supabase.rpc(rpc, params);
    if (error) {
      alert(error.message);
      return;
    }
    // Retirer localement
    setRows(prev => prev.filter(r => String(r.id) !== String(id)));
  }

  return (
    <div
      ref={listRef}
      onScroll={onScroll}
      className="flex flex-col gap-3 max-h-[60vh] overflow-auto pr-1"
    >
      {rows.length === 0 && <div className="text-sm text-gray-500">Aucun message pour le moment.</div>}
      {rows.map(m => {
        const name = profiles[m.user_id]?.full_name || m.user_id.slice(0,8);
        const time = new Date(m.created_at).toLocaleString();
        const imgUrl = m.image_path ? signed[m.image_path] : null;
        const mine = uid && m.user_id === uid;

        return (
          <div key={String(m.id)} className="border rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500">{name} • {time}</div>
              {mine && (
                <button onClick={() => del(m.id)} className="text-xs text-red-600 hover:underline">
                  supprimer
                </button>
              )}
            </div>
            {m.content && <div className="text-sm mt-1 whitespace-pre-wrap">{m.content}</div>}
            {imgUrl && (
              <div className="mt-2">
                <a href={imgUrl} target="_blank" rel="noreferrer">
                  <img src={imgUrl} alt="image" className="max-h-48 rounded" />
                </a>
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
      {loading && <div className="text-xs text-gray-500">Chargement…</div>}
      {!hasMore && rows.length > 0 && <div className="text-xs text-gray-400 text-center">— fin —</div>}
      {err && <div className="text-xs text-red-600 break-all">Erreur: {err}</div>}
    </div>
  );
}

async function handleDelete(id: string) {
  try {
    // Optimiste: retirer localement
    setRows(prev => prev.filter(r => String(r.id) !== String(id)));
    await deleteMessageAndImage(id);
  } catch (e: any) {
    alert(e?.message ?? "Erreur suppression message");
    // rollback simple optionnel (re-fetch)
  }
}




// Ajoute l’import en haut du fichier (zone imports) :
import MessageDeleteButton from "@/components/MessageDeleteButton";
// Et, dans le rendu de chaque message (là où tu mappes `messages` ou `rows`) :

