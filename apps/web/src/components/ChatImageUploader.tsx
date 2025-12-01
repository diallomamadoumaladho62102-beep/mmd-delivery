"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function ChatImageUploader({ orderId }: { orderId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    const safeName = (file.name || "upload").replace(/[^\w.\-]+/g, "-"); const path = `${orderId}/${Date.now()}-${safeName}`;
    const { data, error } = await supabase.storage.from("chat-uploads").upload(path, file);
    if (error) alert("Erreur upload: " + error.message);
    else {
      const { data: signed } = await supabase.storage
        .from("chat-uploads")
        .createSignedUrl(path, 300); // 5 min
      setUrl(signed?.signedUrl || null);
    }
    setUploading(false);
  }

  return (
    <div className="flex flex-col gap-2 border rounded-lg p-3">
      <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button disabled={!file || uploading} onClick={handleUpload} className="bg-blue-600 text-white px-3 py-1 rounded">
        {uploading ? "Envoi..." : "Envoyer l'image"}
      </button>
      {url && <img src={url} alt="aperçu" className="w-40 h-40 object-cover rounded-lg border" />}
    </div>
  );
}


