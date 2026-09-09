"use client";

import { useAdminT } from "@/i18n/useAdminT";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function ChatImageUploader({ orderId }: { orderId: string }) {
  const { t } = useAdminT();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    const safeName = (file.name || "upload").replace(/[^\w.\-]+/g, "-");
    const path = `${orderId}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("chat-uploads")
      .upload(path, file);
    if (uploadError) {
      setError(`${t("Erreur upload:")} ${uploadError.message}`);
    } else {
      const { data: signed } = await supabase.storage
        .from("chat-uploads")
        .createSignedUrl(path, 300);
      setUrl(signed?.signedUrl || null);
    }
    setUploading(false);
  }

  return (
    <div className="flex max-w-full flex-col gap-2 rounded-lg border p-3">
      <input
        type="file"
        accept="image/*"
        aria-label={t("Choose an image")}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        disabled={!file || uploading}
        onClick={() => void handleUpload()}
        aria-busy={uploading}
        className="min-h-11 rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
      >
        {uploading ? t("Envoi...") : t("Envoyer l'image")}
      </button>
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {url ? (
        <img
          src={url}
          alt={t("aperçu")}
          className="h-40 w-40 max-w-full rounded-lg border object-cover"
        />
      ) : null}
    </div>
  );
}
