'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseBrowser';

export default function ChatInput({ orderId }: { orderId: string }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUid(session?.user?.id ?? null);
    })();
  }, []);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setErr(null);
    if (preview) URL.revokeObjectURL(preview);
    if (f) setPreview(URL.createObjectURL(f));
    else setPreview(null);
  }

  function clearFile() {
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  }

  async function send() {
    try {
      setLoading(true); setErr(null);
      if (!uid) { setErr("Non connecté"); return; }

      let image_path: string | null = null;

      if (file) {
        const ext = (file.name.split(".").pop() || "bin").toLowerCase();
        const filename = `${Date.now()}.${ext}`;
        const path = `${orderId}/${uid}/${filename}`;
        const up = await supabase.storage.from("chat-images").upload(path, file, { upsert: false });
        if (up.error) throw up.error;
        image_path = path;
      }

      const { error } = await supabase
        .from("order_messages")
        .insert({
          order_id: orderId,
          user_id: uid,
          content: text || null,
          image_path
        });

      if (error) throw error;

      setText("");
      clearFile();
    } catch (e:any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Écrire un message… (Enter pour envoyer, Shift+Enter pour nouvelle ligne)"
        className="w-full h-24 border rounded px-3 py-2 text-sm"
      />

      {preview && (
        <div className="flex items-center gap-3">
          <img src={preview} alt="preview" className="h-16 w-auto rounded border" />
          <button type="button" onClick={clearFile} className="px-2 py-1 text-xs rounded bg-gray-200">
            Retirer
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="text-sm"
        />
        <button
          onClick={send}
          disabled={loading || (!text && !file)}
          className="px-3 py-2 rounded bg-emerald-600 text-white text-sm disabled:opacity-60"
        >
          {loading ? "…" : "Envoyer"}
        </button>
      </div>

      {err && <div className="text-xs text-red-600 break-all">Erreur: {err}</div>}
    </div>
  );
}
