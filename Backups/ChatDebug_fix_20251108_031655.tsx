"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function ChatDebug({ orderId }: { orderId: string }) {
  const [msgCount, setMsgCount] = useState<number | null>(null);
  const [msgErr, setMsgErr] = useState<string | null>(null);

  const [commission, setCommission] = useState<any | null>(null);
  const [comErr, setComErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // messages count
      setMsgErr(null);
      const { data: countData, error: countErr } = await supabase
        .from("order_messages")
        .select("id", { count: "exact", head: true })
        .eq("order_id", orderId);
      if (countErr) setMsgErr(countErr.message);
      else setMsgCount(countData === null ? 0 : (countData as any)?.length ?? (countData as any) ?? 0);

      // commissions row
      setComErr(null);
      const { data: comData, error: cErr } = await supabase
        .from("order_commissions")
        .select("*")
        .eq("order_id", orderId)
        .maybeSingle();
      if (cErr) setComErr(cErr.message);
      else setCommission(comData ?? null);
    })();
  }, [orderId]);

  return (
    <div className="mt-4 rounded-xl border p-3 text-sm">
      <div className="font-semibold">🔎 Debug DB</div>
      <div>orderId: <code className="break-all">{orderId}</code></div>

      <div className="mt-2">
        <div className="font-medium">Messages count</div>
        {msgErr ? <div className="text-red-600">Erreur: {msgErr}</div> : <div>count = {msgCount}</div>}
      </div>

      <div className="mt-2">
        <div className="font-medium">Commission row</div>
        {comErr ? (
          <div className="text-red-600">Erreur: {comErr}</div>
        ) : commission ? (
          <pre className="overflow-auto max-h-64">{JSON.stringify(commission, null, 2)}</pre>
        ) : (
          <div>aucune ligne</div>
        )}
      </div>
    </div>
  );
}
