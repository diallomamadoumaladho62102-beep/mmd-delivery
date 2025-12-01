"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import RevenueChart from "@/components/RevenueChart";

type Row = {
  order_id: string;
  created_at: string;
  currency: string;
  subtotal: number;
  platform_commission: number;
  take_rate: number | null;
};

function fmtMoney(n: number, c: string) {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: c || "USD" }).format(v);
}
function fmtPct(p: number | null) {
  if (p == null || !isFinite(p)) return "—";
  return (p * 100).toFixed(2) + "%";
}
function toISODate(d: Date) { const d2 = new Date(d); d2.setHours(0,0,0,0); return d2.toISOString(); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate()-n); return d; }

// --- Backfill commissions via RPC
async function backfillCommissions(fromISO: string, toISO: string) {
  const p_from = new Date(fromISO + "T00:00:00").toISOString();
  const p_to   = new Date(toISO   + "T23:59:59.999").toISOString();
  const { data, error } = await supabase.rpc("refresh_order_commissions_for_range", { p_from, p_to });
  if (error) {
    console.error(error);
    alert("Erreur backfill: " + error.message);
  } else {
    alert(`Recalcul terminé: ${data ?? 0} commandes traitées`);
  }
}

export default function RevenueSummary() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("USD");

  // Filtres
  const [from, setFrom] = useState(() => toISODate(daysAgo(30)).slice(0,10));
  const [to, setTo] = useState(() => toISODate(new Date()).slice(0,10));

  // Raccourcis
  function setRange(days:number) {
    setFrom(toISODate(daysAgo(days)).slice(0,10));
    setTo(toISODate(new Date()).slice(0,10));
  }

  async function load() {
    setLoading(true);
    const since = new Date(from + "T00:00:00");
    const until = new Date(to + "T23:59:59.999");

    const { data, error } = await supabase
      .from("v_order_platform_commission")
      .select("order_id, created_at, currency, subtotal, platform_commission, take_rate")
      .gte("created_at", since.toISOString())
      .lte("created_at", until.toISOString())
      .order("created_at", { ascending: false })
      .limit(5000);

    if (error) {
      console.error(error);
      setRows([]);
      setCurrency("USD");
    } else {
      const safe = (data ?? []).map((r:any) => ({
        order_id: r.order_id,
        created_at: r.created_at,
        currency: r.currency || "USD",
        subtotal: Number(r.subtotal ?? 0),
        platform_commission: Number(r.platform_commission ?? 0),
        take_rate: (r.take_rate ?? null) as number | null
      }));
      setRows(safe);
      setCurrency(safe[0]?.currency || "USD");
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []); // init

  // Export CSV
  function exportCSV() {
    const headers = ["date","order_id","currency","subtotal","platform_commission","take_rate"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const take = r.take_rate == null ? "" : (r.take_rate*100).toFixed(2) + "%";
      lines.push([
        new Date(r.created_at).toISOString(),
        r.order_id,
        r.currency,
        (Number.isFinite(r.subtotal)?r.subtotal:0).toFixed(2),
        (Number.isFinite(r.platform_commission)?r.platform_commission:0).toFixed(2),
        take
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `mmd_revenue_${from}_to_${to}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // Totaux
  const totals = useMemo(() => {
    let gmv = 0, plat = 0;
    for (const r of rows) {
      gmv += Number.isFinite(r.subtotal) ? r.subtotal : 0;
      plat += Number.isFinite(r.platform_commission) ? r.platform_commission : 0;
    }
    const take = gmv > 0 ? plat / gmv : null;
    return { gmv, plat, take };
  }, [rows]);

  return (
    <div className="space-y-6">
      {/* Filtres + raccourcis + export + backfill */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="text-xs text-gray-500">Du</div>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1" />
        </div>
        <div>
          <div className="text-xs text-gray-500">Au</div>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1" />
        </div>
        <button onClick={load} className="px-3 py-2 border rounded bg-white shadow-sm">Appliquer</button>
        <div className="flex items-center gap-1 text-[11px]">
          Raccourcis:
          <button onClick={() => setRange(7)}  className="px-2 py-1 border rounded">7j</button>
          <button onClick={() => setRange(30)} className="px-2 py-1 border rounded">30j</button>
          <button onClick={() => setRange(90)} className="px-2 py-1 border rounded">90j</button>
        </div>
        <button onClick={exportCSV} className="ml-auto px-3 py-2 border rounded bg-white shadow-sm">Export CSV</button>
        <button
          onClick={async () => { await backfillCommissions(from, to); await load(); }}
          className="px-3 py-2 border rounded bg-white shadow-sm"
          title="Recalcule les commissions pour toutes les commandes de l’intervalle"
        >
          Recalculer les commissions
        </button>
      </div>

      {/* Tuiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl p-4 border shadow-sm">
          <div className="text-xs text-gray-500">GMV (subtotal)</div>
          <div className="text-xl font-semibold">{fmtMoney(totals.gmv, currency)}</div>
        </div>
        <div className="rounded-2xl p-4 border shadow-sm">
          <div className="text-xs text-gray-500">Commission plateforme</div>
          <div className="text-xl font-semibold">{fmtMoney(totals.plat, currency)}</div>
        </div>
        <div className="rounded-2xl p-4 border shadow-sm">
          <div className="text-xs text-gray-500">Take rate</div>
          <div className="text-xl font-semibold">{fmtPct(totals.take)}</div>
        </div>
        <div className="rounded-2xl p-4 border shadow-sm">
          <div className="text-xs text-gray-500">Commandes</div>
          <div className="text-xl font-semibold">{rows.length}</div>
        </div>
      </div>

      {/* Graph (NYC) */}
      <RevenueChart from={from} to={to} />

      {/* Tableau */}
      <div>
        <h3 className="text-lg font-semibold mb-2">Commandes dans l’intervalle</h3>
        <div className="overflow-x-auto border rounded-2xl">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Order ID</th>
                <th className="text-right p-2">GMV</th>
                <th className="text-right p-2">Commission</th>
                <th className="text-right p-2">Take</th>
                <th className="text-right p-2">Détail</th>
              </tr>
            </thead>
            <tbody>
              {(loading ? [] : rows.slice(0,100)).map((r) => (
                <tr key={r.order_id} className="border-t">
                  <td className="p-2">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-2 font-mono text-xs">{r.order_id}</td>
                  <td className="p-2 text-right">{fmtMoney(r.subtotal, r.currency)}</td>
                  <td className="p-2 text-right">{fmtMoney(r.platform_commission, r.currency)}</td>
                  <td className="p-2 text-right">{fmtPct(r.take_rate)}</td>
                  <td className="p-2 text-right">
                    <a className="text-blue-600 hover:underline" href={`/orders/${r.order_id}/chat`} target="_blank" rel="noreferrer">Ouvrir</a>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-gray-500">Aucune commande.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

