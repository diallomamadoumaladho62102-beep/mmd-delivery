'use client';
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseBrowser";
type Row = { id: string; order_id: string; user_id: string; text: string|null; image_path: string|null; created_at: string; };
export default function ChatMessages({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  async function deleteMessage(id: string) {
    setRows(prev => prev.filter(r => String(r.id) !== String(id)));
    const { data, error } = await supabase.rpc("delete_order_message", { p_msg_id: id });
    if (error) { alert(error.message); await reload(); return; }
    if (!data) await reload();
  }
  async function reload() {
    const { data } = await supabase.from("order_messages").select("*").eq("order_id", orderId).order("created_at", { ascending: true });
    if (data) setRows(data as Row[]);
  }
  return (
    <div className="space-y-3">
      {rows.map(m => (
        <div key={m.id} className="border rounded p-2">
          <div className="text-xs text-gray-500">{new Date(m.created_at).toLocaleString()}</div>
          {m.text && <div className="py-1">{m.text}</div>}
          {m.image_path && (
  <div className="py-1">
    {(() => {
      const { data } = supabase.storage.from('chat-images').getPublicUrl(m.image_path);
      const url = data?.publicUrl ?? '#';
      return <a href={url} target="_blank">Voir l’image</a>;
    })()}
  </div>
)}`} target="_blank">Voir l’image</a>
            </div>
          )}
          <button onClick={() => deleteMessage(m.id)} className="text-red-600 text-sm underline">supprimer</button>
        </div>
      ))}
    </div>
  );
}

