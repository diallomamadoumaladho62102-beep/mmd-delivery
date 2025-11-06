'use client';
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Row = { old_status: string | null; new_status: string | null; changed_at?: string | null; created_at?: string | null; changed_by?: string | null };

export default function OrderStatusTimeline({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      setLoading(true); setErr(null);
      const { data, error } = await supabase
        .from("order_status_history")
        .select("old_status,new_status,changed_at,created_at,changed_by")
        .eq("order_id", orderId)
        .order("changed_at", { ascending: true });
      if (error) throw error;
      setRows((data as Row[]) ?? []);
    } catch (e:any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const ch = supabase.channel(`osh-${orderId}`);
    ch.on("postgres_changes",
      { event: "INSERT", schema: "public", table: "order_status_history", filter: `order_id=eq.${orderId}` },
      () => load()
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orderId]);

  if (loading) return <div className="text-sm text-gray-600">Chargement…</div>;
  if (err) return <div className="text-sm text-red-600">Erreur: {err}</div>;
  if (!rows.length) return <div className="text-sm text-gray-500">Aucun historique.</div>;

  return (
    <div className="text-sm">
      <div className="font-semibold mb-2">Historique des statuts</div>
      <ol className="relative border-s pl-4 space-y-3">
        {rows.map((r, i) => {
          const t = r.changed_at || r.created_at || null;
          return (
            <li key={i} className="ms-2">
              <div className="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full bg-gray-400"></div>
              <div className="text-xs text-gray-500">{t ? new Date(t).toLocaleString() : ""}</div>
              <div>
                <span className="font-medium">{r.old_status || "—"}</span>
                {" → "}
                <span className="font-medium">{r.new_status || "—"}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
