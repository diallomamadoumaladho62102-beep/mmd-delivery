'use client';
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Row = { user_id: string; role: string; created_at: string; full_name?: string | null };

export default function MembersList({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true); setErr(null);
        const { data, error } = await supabase.rpc('list_order_members', { p_order_id: orderId });
        if (error) throw error;
        setRows((data as Row[]) || []);
      } catch (e:any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId]);

  if (loading) return <div className="text-sm text-gray-600">Chargement…</div>;
  if (err) return <div className="text-sm text-red-600">Erreur: {err}</div>;
  if (!rows.length) return <div className="text-sm text-gray-600">Aucun membre.</div>;

  return (
    <div className="text-sm space-y-1">
      {rows.map((r) => (
        <div key={r.user_id} className="flex items-center justify-between border rounded px-3 py-2">
          <div>
            <div className="font-medium">{r.full_name || r.user_id.slice(0,8)}</div>
            <div className="text-xs text-gray-500">{r.user_id}</div>
          </div>
          <span className="text-xs px-2 py-1 rounded bg-gray-100">{r.role}</span>
        </div>
      ))}
    </div>
  );
}
