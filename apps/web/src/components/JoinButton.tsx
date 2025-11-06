'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseBrowser';

export default function JoinButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUserId(session?.user?.id ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  async function signInWithEmail() {
    try {
      setErr(null); setMsg(null);
      if (!email) { setErr('Entre un email.'); return; }
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.href : undefined }
      });
      if (error) throw error;
      setMsg('Magic link envoyé. Vérifie ta boîte mail.');
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function join() {
    try {
      setLoading(true); setErr(null); setMsg(null);
      if (!userId) { setErr('Connecte-toi avant.'); return; }
      const { data, error } = await supabase.rpc('join_order_rpc', {
        p_order_id: orderId,
        p_user_id: userId,
        p_role: 'client'
      });
      if (error) throw error;
      setMsg(data ? JSON.stringify(data) : 'ok');
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!userId) {
    return (
      <div className="space-y-2">
        <div className="text-sm text-gray-700">Se connecter par email</div>
        <div className="flex gap-2">
          <input type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} placeholder="ton@email.com" className="border rounded px-3 py-2 text-sm" />
          <button onClick={signInWithEmail} className="px-3 py-2 rounded bg-blue-600 text-white text-sm">Envoyer le lien</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button onClick={join} disabled={loading} className="px-3 py-2 rounded bg-black text-white text-sm disabled:opacity-60">
        {loading ? '…' : 'Rejoindre la commande'}
      </button>
      {msg && <div className="text-xs text-green-700 break-all">OK: {msg}</div>}
      {err && <div className="text-xs text-red-700 break-all">Erreur: {err}</div>}
      <div className="text-[11px] text-gray-500">userId: {userId ?? '—'}</div>
    </div>
  );
}
