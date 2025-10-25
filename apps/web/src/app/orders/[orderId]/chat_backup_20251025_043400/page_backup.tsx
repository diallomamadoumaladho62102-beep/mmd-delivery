'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../../lib/supabaseBrowser';

type Message = {
  id: number;
  user_id: string;
  order_id: string;
  message: string;
  created_at: string;
};

export default function Page({ params }: { params: { orderId: string } }) {
  const orderId = params.orderId;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const subscribedRef = useRef(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Auto-join (ajoute l'utilisateur comme membre)
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { error } = await supabase
          .from('order_members')
          .upsert({ order_id: orderId, user_id: user.id, role: 'member' }, { onConflict: 'order_id,user_id' });
        if (error) throw error;
      } catch (e: any) {
        setErr(e?.message || String(e));
      }
    })();
  }, [orderId]);

  // Charger messages initiaux
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('order_messages')
          .select('*')
          .eq('order_id', orderId)
          .order('created_at', { ascending: true });
        if (error) throw error;
        setMessages(data || []);
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
        setTimeout(() => listRef.current?.scrollTo({ top: 9e9, behavior: 'smooth' }), 0);
      }
    })();
  }, [orderId]);

  // Abonnement Realtime (protégé contre doubles abonnements)
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      subscribedRef.current = false;
    }

    const ch = supabase.channel(`order_msgs_${orderId}`);
    channelRef.current = ch;

    ch.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` },
      (payload) => {
        const row = payload.new as Message;
        setMessages((prev) => {
          if (prev.some((m) => m.id === row.id)) return prev;
          const next = [...prev, row];
          next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          setTimeout(() => listRef.current?.scrollTo({ top: 9e9, behavior: 'smooth' }), 0);
          return next;
        });
      }
    );

    if (!subscribedRef.current) {
      ch.subscribe();
      subscribedRef.current = true;
    }

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        subscribedRef.current = false;
      }
    };
  }, [orderId]);

  async function sendMessage() {
    const text = input.trim();
    if (!text) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setErr('Tu n’es pas connecté. Va sur /auth.');
      return;
    }

    setInput('');
    const { error } = await supabase.from('order_messages').insert({
      order_id: orderId,
      user_id: user.id,
      message: text,
    });
    if (error) {
      setInput(text);
      setErr(error.message);
    }
  }

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Chat commande #{orderId}</h1>

      {err && (
        <div className="bg-red-100 text-red-700 border border-red-300 rounded p-2">
          <b>Erreur:</b> {err}
        </div>
      )}

      <div
        ref={listRef}
        className="border rounded-lg p-4 space-y-2 h-72 overflow-y-auto bg-white/70"
      >
        {loading ? (
          <p className="text-gray-500">Chargement…</p>
        ) : messages.length === 0 ? (
          <p className="text-gray-500">Aucun message.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="text-sm leading-6">
              <span className="font-semibold">{m.user_id.slice(0, 8)}:</span>{' '}
              {m.message}{' '}
              <span className="text-gray-400">
                {new Date(m.created_at).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="flex space-x-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Écrire un message…"
          className="border rounded p-2 flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
        />
        <button
          onClick={sendMessage}
          className="bg-blue-500 text-white px-4 py-2 rounded"
        >
          Envoyer
        </button>
      </div>
    </main>
  );
}
