"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Log = { order_id: string; status: string; changed_at: string };

type RangeKey = "today" | "7d" | "all";

function compactConsecutive(list: Log[]): Log[] {
  const out: Log[] = [];
  for (const item of list) {
    const last = out[out.length - 1];
    if (!last || last.status !== item.status) out.push(item);
  }
  return out;
}

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString();
}
function startOf7dISO() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0,0,0,0);
  return d.toISOString();
}

export default function OrderStatusTimeline({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("all");
  const [isPending, startTransition] = useTransition();

  const since = useMemo(() => {
    if (range === "today") return startOfTodayISO();
    if (range === "7d") return startOf7dISO();
    return null;
  }, [range]);

  async function load() {
    try {
      setLoading(true); setErr(null);
      let q = supabase
        .from("order_status_log")
        .select("order_id, status, changed_at")
        .eq("order_id", orderId)
        .order("changed_at", { ascending: true });
      if (since) q = q.gte("changed_at", since);
      const { data, error } = await q;
      if (error) throw error;
      setRows(compactConsecutive((data as Log[]) ?? []));
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [orderId, since]);

  useEffect(() => {
    const ch = supabase
      .channel(`order-status-${orderId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_status_log", filter: `order_id=eq.${orderId}` },
        () => { void load(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orderId, since]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">
          Historique des statuts
          {rows.length > 0 && <span className="ml-2 text-xs text-gray-500">({rows.length})</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded border p-0.5 text-xs">
            <button
              className={"px-2 py-1 rounded " + (range==="today" ? "bg-gray-200" : "")}
              onClick={() => setRange("today")}
            >Aujourd’hui</button>
            <button
              className={"px-2 py-1 rounded " + (range==="7d" ? "bg-gray-200" : "")}
              onClick={() => setRange("7d")}
            >7&nbsp;jours</button>
            <button
              className={"px-2 py-1 rounded " + (range==="all" ? "bg-gray-200" : "")}
              onClick={() => setRange("all")}
            >Tout</button>
          </div>
          <button
            onClick={() => startTransition(() => { void load(); })}
            className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
            disabled={isPending}
          >
            {isPending ? "Actualisation…" : "Actualiser"}
          </button>
        </div>
      </div>

      {loading && <div className="text-sm text-gray-500">Chargement…</div>}
      {err && <div className="text-sm text-red-600">Erreur: {err}</div>}
      {!loading && !err && rows.length === 0 && (
        <div className="text-sm text-gray-500">Aucun historique.</div>
      )}

      {!loading && !err && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={`${r.changed_at}-${i}`} className="text-sm">
              <span className="font-medium">{new Date(r.changed_at).toLocaleString()}</span>
              <span className="mx-2">•</span>
              <span className="uppercase tracking-wide">{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

