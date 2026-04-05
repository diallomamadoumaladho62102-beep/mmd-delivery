'use client';
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const ROLES = ["client","driver","restaurant"];

export default function RoleSwitch({ orderId }: { orderId: string }) {
  const [role, setRole] = useState<string>("client");
  const [uid, setUid] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUid(session?.user?.id ?? null);
      if (session?.user?.id) {
        const { data } = await supabase
          .from('order_members')
          .select('role')
          .eq('order_id', orderId)
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (data?.role) setRole(data.role);
      }
    })();
  }, [orderId]);

  async function apply() {
    try {
      setLoading(true); setErr(null); setMsg(null);
      if (!uid) { setErr('Connecte-toi.'); return; }
      const { data, error } = await supabase.rpc('join_order_rpc', {
        p_order_id: orderId,
        p_user_id: uid,
        p_role: role
      });
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
      <div className="text-sm font-medium">Rôle</div>
      <div className="flex gap-2 items-center">
        <select className="border rounded px-2 py-1 text-sm" value={role} onChange={e => setRole(e.target.value)}>
          {ROLES.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <button onClick={apply} disabled={loading} className="px-3 py-1.5 rounded bg-zinc-800 text-white text-sm disabled:opacity-60">
          {loading ? '…' : 'Appliquer'}
        </button>
      </div>
      {msg && <div className="text-xs text-green-700 break-all">OK: {msg}</div>}
      {err && <div className="text-xs text-red-700 break-all">Erreur: {err}</div>}
    </div>
  );
}

