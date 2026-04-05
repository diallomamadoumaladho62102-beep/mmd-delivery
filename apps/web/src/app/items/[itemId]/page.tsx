'use client';
import * as React from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type PageProps = { params: { orderId: string } };
type Msg = { id: string; order_id: string; user_id: string | null; text: string; created_at: string };

export default function OrderChatPage({ params }: PageProps) {
  const { orderId } = params;
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [text, setText] = React.useState('');

  // Charger l'historique
  React.useEffect(() => {
    let isMounted = true;
    (async () => {
      const { data, error } = await supabase
        .from('order_messages')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });
      if (!isMounted) return;
      if (!error && data) setMessages(data as Msg[]);
    })();
    return () => { isMounted = false; };
  }, [orderId]);

  // Realtime
  React.useEffect(() => {
    const channel = supabase
      .channel(`order_messages:${orderId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` },
        (payload) => {
          const newMsg = payload.new as Msg;
          setMessages((prev) => [...prev, newMsg]);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orderId]);

  const send = async () => {
    if (!text.trim()) return;
    const { error } = await supabase.from('order_messages').insert({
      order_id: orderId,
      text
      // user_id: sera null si pas d'auth; on le mettra quand on branchera Auth
    });
    if (!error) setText('');
  };

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Chat de la commande</h1>
      <p className="mt-2 text-sm text-gray-600">Commande ID: {orderId}</p>

      <div className="mt-6 border rounded-xl p-4 h-[60vh] flex flex-col">
        <div className="flex-1 overflow-y-auto space-y-2">
          {messages.length === 0 ? (
            <p className="text-gray-500">Aucun message pour l’instant…</p>
          ) : (
            messages.map(m => (
              <div key={m.id} className="px-3 py-2 rounded-lg border">
                <div className="text-xs text-gray-500">
                  {m.user_id ?? 'anonyme'} · {new Date(m.created_at).toLocaleTimeString()}
                </div>
                <div>{m.text}</div>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            className="flex-1 border rounded-lg px-3 py-2"
            placeholder="Écrire un message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button onClick={send} className="px-4 py-2 rounded-lg border">Envoyer</button>
        </div>
      </div>
    </main>
  );
}

