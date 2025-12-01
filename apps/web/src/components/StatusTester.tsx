'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabaseBrowser';

const STATUSES = ['assigned','accepted','prepared','ready','dispatched','delivered'];

export default function StatusTester({ orderId }: { orderId: string }) {
  const [s, setS] = useState<string>('prepared');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function go() {
    try {
      setLoading(true); setErr(null); setMsg(null);
      const { data, error } = await supabase.rpc('set_order_status', { p_order_id: orderId, p_new_status: s });
      if (error) throw error;
      setMsg(JSON.stringify(data));
    } catch (e:any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="text-sm font-medium">Simuler un statut (bip)</div>
      <div className="flex gap-2 items-center">
        <select className="border rounded px-2 py-1 text-sm" value={s} onChange={e => setS(e.target.value)}>
          {STATUSES.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <button onClick={go} disabled={loading} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-60">
          {loading ? '…' : 'Mettre à jour'}
        </button>
      </div>
      {msg && <div className="text-xs text-green-700 break-all">OK: {msg}</div>}
      {err && <div className="text-xs text-red-700 break-all">Erreur: {err}</div>}
    </div>
  );
}

