'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/src/lib/supabaseBrowser';

type Message = {
  id: string;
  body: string;
  sender_id: string;
  created_at: string;
  conversation_id: string;
};

export default function OrderChatPage({ params }: { params: { orderId: string } }) {
  const orderId = params.orderId;
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // 1️⃣ Vérifie ou crée la conversation liée à la commande
  useEffect(() => {
    (async () => {
      const { data: convUpsert, error: convErr } = await supabase
        .from('conversations')
        .insert({ order_id: orderId })
        .select('*')
        .single();

      if (convErr?.code === '23505' || convErr?.message?.includes('duplicate')) {
        const { data: convGet } = await supabase
          .from('conversations')
          .select('id')
          .eq('order_id', orderId)
          .single();
        setConversationId(convGet?.id ?? null);
      } else {
        setConversationId(convUpsert?.id ?? null);
      }
    })();
  }, [orderId, supabase]);

  // 2️⃣ Charge les messages et écoute le temps réel
  useEffect(() => {
    if (!conversationId) return;
    (async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      setMessages((data as Message[]) ?? []);
    })();

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message])
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 3️⃣ Fonction pour envoyer un message
  const send = async () => {
    const body = text.trim();
    if (!body || !conversationId) return;

    const { data: { user } = {} as any } = await supabase.auth.getUser();
    if (!user?.id) {
      alert('Non connecté. Connecte-toi pour envoyer un message.');
      return;
    }

    const { error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: user.id, body });
    if (!error) setText('');
  };

  // 4️⃣ Interface utilisateur
  return (
    <div className="mx-auto max-w-2xl p-4 space-y-4">
      <h1 className="text-xl font-semibold">💬 Chat — Commande {orderId.slice(0, 8)}…</h1>

      <div className="border rounded-lg p-3 h-[60vh] overflow-y-auto bg-white">
        {messages.map((m) => (
          <div key={m.id} className="mb-3">
            <div className="inline-block rounded-xl px-3 py-2 border bg-gray-50">
              {m.body}
            </div>
            <div className="text-xs text-gray-500">
              {new Date(m.created_at).toLocaleString()}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Votre message…"
          className="flex-1 border rounded-lg px-3 py-2"
        />
        <button onClick={send} className="px-4 py-2 rounded-lg border hover:bg-gray-50">
          Envoyer
        </button>
      </div>
    </div>
  );
}
