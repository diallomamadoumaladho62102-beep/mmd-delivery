"use client";


import { useAdminT } from "@/i18n/useAdminT";
import { useState } from "react";
import { sendChatMessage } from "@/lib/chat";

export default function ChatInput({
  orderId,
  onSent,
  senderRole,
  targetRole,
}: {
  orderId: string;
  onSent?: () => void;
  senderRole?: string | null;
  targetRole?: string | null;
}) {
  const { t } = useAdminT();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setErr(null);
    const trimmed = text.trim();
    if (!trimmed && !file) return;

    setPending(true);
    try {
      await sendChatMessage(orderId, trimmed, file, {
        senderRole,
        targetRole,
      });

      setText("");
      setFile(null);
      onSent?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border rounded-xl p-3 space-y-2">
      {err && (
        <div className="text-red-600 text-sm" role="alert">
          {t("Erreur:")} {err}
        </div>
      )}

      <textarea
        className="w-full border rounded px-3 py-2 h-20"
        placeholder={t("Écrire un message…")}
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
          accept="image/jpeg,image/png,image/webp"
          aria-label={t("Choose an image")}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <button
          type="button"
          onClick={() => void send()}
          disabled={pending || (!text.trim() && !file)}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        >
          {pending ? t("Sending…") : t("Envoyer")}
        </button>
      </div>
    </div>
  );
}
