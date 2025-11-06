'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseBrowser';

export default function LeaveButton({ orderId }: { orderId: string }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUserId(session?.user?.id ?? null);
    })();
  }, []);

  async function leave() {
    try {
      setLoading(true); setErr(null); setMsg(null);
      if (!userId) { setErr('Non connecté.'); return; }

      const { error } = await supabase
        .from('order_members')
        .delete()
        .eq('order_id', orderId)
        .eq('user_id', userId);

      if (error) throw error;
      setMsg('Tu as quitté la commande.');
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!userId) return null;

  return (
    <div className='space-y-2'>
      <button
        onClick={leave}
        disabled={loading}
        className='px-3 py-2 rounded bg-gray-200 text-gray-800 text-sm disabled:opacity-60'
      >
        {loading ? '…' : 'Quitter la commande'}
      </button>
      {msg && <div className='text-xs text-green-700'>{msg}</div>}
      {err && <div className='text-xs text-red-700'>{err}</div>}
    </div>
  );
}
