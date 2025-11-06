"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Row = { day_ny: string; orders_count: number; platform_total: number; gmv_total: number; take_rate: number | null; currency_hint: string };

function toISODate(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x.toISOString(); }

export default function RevenueChart({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // on charge large puis on filtre côté client par dates (simple)
      const { data, error } = await supabase
        .from("v_platform_commission_daily_ny")
        .select("*")
        .order("day_ny", { ascending: true })
        .limit(400);
      if (error) { console.error(error); setRows([]); setLoading(false); return; }
      const f = new Date(from + "T00:00:00");
      const t = new Date(to + "T23:59:59.999");
      const safe = (data ?? []).filter((r:any) => {
        const d = new Date(r.day_ny + "T00:00:00");
        return d >= f && d <= t;
      }).map((r:any) => ({
        day_ny: r.day_ny,
        orders_count: Number(r.orders_count||0),
        platform_total: Number(r.platform_total||0),
        gmv_total: Number(r.gmv_total||0),
        take_rate: r.take_rate ?? null,
        currency_hint: r.currency_hint || "USD",
      }));
      setRows(safe);
      setLoading(false);
    })();
  }, [from, to]);

  // data simples pour <svg>
  const points = useMemo(() => {
    if (rows.length === 0) return { w: 600, h: 180, path: "", yMax: 1, cur: "USD" };
    const w = Math.max(300, Math.min(900, rows.length * 24));
    const h = 180;
    const max = Math.max(...rows.map(r => r.platform_total), 1);
    const pad = 10;
    const step = (w - pad*2) / Math.max(rows.length - 1, 1);
    const path = rows.map((r, i) => {
      const x = pad + i * step;
      const y = h - pad - (r.platform_total / max) * (h - pad*2);
      return (i === 0 ? `M ${x},${y}` : `L ${x},${y}`);
    }).join(" ");
    return { w, h, path, yMax: max, cur: rows[0].currency_hint || "USD" };
  }, [rows]);

  if (loading) return <div className="text-sm text-gray-500">Chargement du graphique…</div>;
  if (rows.length === 0) return <div className="text-sm text-gray-500">Aucune donnée à afficher.</div>;

  const fmtMoney = (n:number,c:string) => new Intl.NumberFormat(undefined,{style:"currency",currency:c}).format(n);

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500">
        Total plateforme par jour (NYC) • Max jour: <span className="font-semibold">{fmtMoney(points.yMax, points.cur)}</span>
      </div>
      <div className="rounded-2xl border p-3 overflow-x-auto">
        <svg width={points.w} height={points.h} role="img" aria-label="Revenue line chart">
          <path d={points.path} fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
    </div>
  );
}
