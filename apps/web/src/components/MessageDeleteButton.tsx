"use client";

import { supabase } from "@/lib/supabaseBrowser";
import { useState } from "react";

export default function MessageDeleteButton({
  msgId,
  onDeleted,
  className,
}: {
  msgId: string | number;
  onDeleted?: (id: string | number) => void;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (loading) return;
    setLoading(true);
    const { error } = await supabase.rpc("delete_order_message", { p_msg_id: String(msgId) });
    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }
    onDeleted?.(msgId);
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      className={className ?? "text-xs text-red-600 hover:underline"}
      aria-label="Supprimer le message"
    >
      {loading ? "…" : "supprimer"}
    </button>
  );
}
