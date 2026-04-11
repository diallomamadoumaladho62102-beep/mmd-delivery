"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Obj = { name: string; id?: string; updated_at?: string; signed?: string | null };

export default function OrderFilesPage({ params }: { params: { orderId: string } }) {
  const orderId = params.orderId;
  const [items, setItems] = useState<Obj[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const list = async () => {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase
      .storage.from("chat-uploads")
      .list(orderId, { limit: 100, sortBy: { column: "updated_at", order: "desc" }});

    if (error) { setErr(error.message); setItems([]); setLoading(false); return; }

    const arr: Obj[] = await Promise.all(
      (data ?? []).map(async (o) => {
        const path = `${orderId}/${o.name}`;
        const s = await supabase.storage.from("chat-uploads").createSignedUrl(path, 60*60);
        return { name: o.name, updated_at: (o as any)?.updated_at, signed: s.data?.signedUrl ?? null };
      })
    );
    setItems(arr);
    setLoading(false);
  };

  useEffect(() => { list(); }, [orderId]);

  const upload = async () => {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setErr(null);
    const path = `${orderId}/${Date.now()}_${file.name}`.replace(/\s+/g, "_");
    const up = await supabase.storage.from("chat-uploads").upload(path, file);
    if (up.error) { setErr(up.error.message); return; }
    inputRef.current!.value = "";
    list();
  };

  const remove = async (name: string) => {
    setErr(null);
    const path = `${orderId}/${name}`;
    const rm = await supabase.storage.from("chat-uploads").remove([path]);
    if (rm.error) { setErr(rm.error.message); return; }
    list();
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold">Fichiers — commande #{orderId}</h1>

      <div className="flex items-center gap-3">
        <input type="file" ref={inputRef} accept="image/*" />
        <button onClick={upload} className="border rounded px-3 py-1">Uploader</button>
        <a className="text-blue-600 underline" href={`/orders/${orderId}/chat`}>Retour au chat</a>
      </div>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}
      {loading ? <div>Chargement…</div> : null}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {items.map((o) => (
          <div key={o.name} className="border rounded p-2 space-y-2">
            {o.signed ? (
              <a href={o.signed} target="_blank" rel="noreferrer">
                <img src={o.signed} alt={o.name} className="w-full h-32 object-cover rounded" />
              </a>
            ) : (
              <div className="w-full h-32 bg-gray-100 rounded" />
            )}
            <div className="text-xs break-all">{o.name}</div>
            <button onClick={() => remove(o.name)} className="text-sm text-red-600">Supprimer</button>
          </div>
        ))}
      </div>
    </div>
  );
}
