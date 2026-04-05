"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function ChatInput({
  orderId,
  onSent,
}: {
  orderId: string;
  onSent?: () => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setErr(null);
    const t = text.trim();
    if (!t && !file) return;

    setPending(true);
    try {
      let image_path: string | null = null;

      // upload image optionnel
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const key = `${orderId}/${crypto.randomUUID()}-${safeName}`;

        const up = await supabase.storage
          .from("chat-uploads")
          .upload(key, file, { upsert: false });

        if (up.error) throw new Error(up.error.message);
        image_path = key;
      }

      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("Non connecté.");

      // ✅ IMPORTANT: colonne = message (pas text)
      const { error } = await supabase.from("order_messages").insert({
        order_id: orderId,
        user_id: user.id,
        message: t || "", // ou null si tu préfères, mais ChatBox affiche message
        image_path,
      });

      if (error) throw new Error(error.message);

      setText("");
      setFile(null);
      onSent?.();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border rounded-xl p-3 space-y-2">
      {err && <div className="text-red-600 text-sm">Erreur: {err}</div>}

      <textarea
        className="w-full border rounded px-3 py-2 h-20"
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

      <div className="flex items-center gap-2">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <button
          onClick={() => void send()}
          disabled={pending || (!text.trim() && !file)}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        >
          {pending ? "Envoi…" : "Envoyer"}
        </button>
      </div>
    </div>
  );
}
