'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseBrowser';
import { v4 as uuidv4 } from 'uuid';

type Profile = { full_name?: string | null; avatar_url?: string | null };

type RowDB = {
  id: string;
  order_id: string;
  user_id: string;
  text: string | null;
  image_path: string | null;
  created_at: string;
  profiles?: Profile | Profile[] | null;
};

export type ChatRow = {
  id: string;
  order_id: string;
  user_id: string;
  text: string | null;
  image_path: string | null;
  created_at: string;
  profile?: Profile | null;
  _signedUrl?: string | null;
};

export default function ChatMessages({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectBase = useMemo(() => (
    supabase
      .from('order_messages')
      .select('id, order_id, user_id, text, image_path, created_at, profiles:profiles!inner (full_name, avatar_url)')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })
  ), [orderId]);

  const signIfNeeded = useCallback(async (items: RowDB[]): Promise<ChatRow[]> => {
    const out: ChatRow[] = [];
    for (const it of items) {
      let url: string | null = null;
      if (it.image_path) {
        const { data } = await supabase
          .storage
          .from('chat-images')
          .createSignedUrl(it.image_path, 60 * 60); // 1h
        url = data?.signedUrl ?? null;
      }
      const profile = Array.isArray(it.profiles) ? it.profiles[0] : (it.profiles ?? undefined);
      out.push({ ...it, profile: profile ?? undefined, _signedUrl: url });
    }
    return out;
  }, []);

  async function loadInitial() {
    setLoading(true);
    const { data, error } = await selectBase;
    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }
    const mapped = await signIfNeeded((data as RowDB[]) || []);
    setRows(mapped);
    setLoading(false);
  }

  useEffect(() => {
    loadInitial();
    // realtime
    const channel = supabase.channel(`chat:${orderId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` }, async (payload) => {
        const row = payload.new as RowDB;
        const mapped = await signIfNeeded([row]);
        setRows((prev) => [...prev, mapped[0]]);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` }, (payload) => {
        const id = (payload.old as any).id as string;
        setRows((prev) => prev.filter(x => x.id !== id));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orderId]);

  const handleSend = async () => {
    if (!text && !file) return;
    setSending(true);

    let image_path: string | null = null;
    try {
      if (file) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const path = `${orderId}/${uuidv4()}.${ext}`;
        const up = await supabase.storage.from('chat-images').upload(path, file, { upsert: false, contentType: file.type });
        if (up.error) throw up.error;
        image_path = path;
      }

      const ins = await supabase.from('order_messages').insert({ order_id: orderId, text: text || null, image_path }).select();
      if (ins.error) throw ins.error;
      setText('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e) {
      console.error(e);
      alert((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { data, error } = await supabase.rpc('delete_order_message', { p_msg_id: id });
      if (error) throw error;
      const deleted = (data as any)?.[0]?.deleted ?? false;
      const img = (data as any)?.[0]?.image_path as string | null;
      if (deleted && img) {
        await supabase.storage.from('chat-images').remove([img]);
      }
    } catch (e) {
      console.error(e);
      alert((e as Error).message);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="border rounded-2xl p-3 h-96 overflow-y-auto bg-white">
        {loading ? (
          <div className="text-sm text-gray-500">Chargement…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500">Aucun message.</div>
        ) : (
          <ul className="space-y-3">
            {rows.map((m) => (
              <li key={m.id} className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden">
                  {m.profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.profile.avatar_url} alt="avatar" className="w-10 h-10 object-cover" />
                  ) : null}
                </div>
                <div className="flex-1">
                  <div className="text-xs text-gray-600">{m.profile?.full_name ?? m.user_id} · {new Date(m.created_at).toLocaleString()}</div>
                  {m.text ? <div className="text-sm whitespace-pre-wrap">{m.text}</div> : null}
                  {m._signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m._signedUrl} alt="image" className="mt-2 rounded-xl max-h-64" />
                  ) : null}
                </div>
                <button onClick={() => handleDelete(m.id)} className="text-xs text-red-600 hover:underline">supprimer</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 border rounded-xl px-3 py-2"
          placeholder="Écrire un message…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button onClick={handleSend} disabled={sending} className="px-3 py-2 rounded-xl bg-black text-white">Envoyer</button>
      </div>
    </div>
  );
}
