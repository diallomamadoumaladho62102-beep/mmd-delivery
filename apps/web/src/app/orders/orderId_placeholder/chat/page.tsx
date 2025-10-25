"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseBrowser";

type Msg = { id: number; user_id: string; message: string; created_at: string };

export default function Chat({ params }: { params: { orderId: string } }) {
  const { orderId } = params;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("order_messages")
        .select("id, user_id, message, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (!error && data) setMsgs(data as Msg[]);
    };
    load();

    const channel = supabase
      .channel(`order-${orderId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_messages", filter: `order_id=eq.${orderId}` },
        (payload) => setMsgs((m) => [...m, payload.new as Msg])
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orderId]);

  const send = async () => {
    if (!input.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { alert("Connecte-toi d’abord"); return; }
    const { error } = await supabase.from("order_messages").insert({
      order_id: orderId,
      user_id: user.id,
      message: input.trim()
    });
    if (!error) setInput("");
  };

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold">Chat commande {orderId}</h1>
      <div className="border rounded p-3 h-80 overflow-y-auto">
        {msgs.map(m => (
          <div key={m.id} className="text-sm">
            <span className="font-mono opacity-60">{m.user_id.slice(0,8)}</span> : {m.message}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Écrire un message…"
          className="flex-1 border rounded px-3 py-2"
        />
        <button onClick={send} className="border rounded px-4">Envoyer</button>
      </div>
    </div>
  );
}
