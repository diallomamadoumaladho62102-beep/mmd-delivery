'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseBrowser';

type Row = {
  order_id: string;
  client: number;
  driver: number;
  restaurant: number;
  platform: number;
  currency: string;
  updated_at: string;
};

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function CommissionBreakdown({ orderId }: { orderId: string }) {
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setErr(null);

      const { data, error } = await supabase
        .from('order_commissions')
        .select('order_id, client, driver, restaurant, platform, currency, updated_at')
        .eq('order_id', orderId)
        .single(); // exactement 1 ligne par commande

      if (error) throw error;

      setRow({
        ...data,
        client: toNumber((data as any).client),
        driver: toNumber((data as any).driver),
        restaurant: toNumber((data as any).restaurant),
        platform: toNumber((data as any).platform),
        currency: (data as any).currency || 'USD',
      } as Row);
    } catch (e: any) {
      setRow(null);
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!orderId) return;
    void load();

    // Canal dédié par commande pour éviter les collisions
    const ch = supabase
      .channel(`commissions-${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_commissions', filter: `order_id=eq.${orderId}` },
        () => { void load(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [orderId]);

  if (loading) {
    return <div className="text-sm text-gray-500">Chargement des commissions…</div>;
  }

  if (err) {
    return <div className="text-sm text-red-600">Erreur commissions: {err}</div>;
  }

  if (!row) {
    return <div className="text-sm text-gray-500">Pas de données de commission.</div>;
  }

  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: row.currency || 'USD' })
        .format(Number.isFinite(n) ? n : 0);
    } catch {
      // fallback devise invalide → USD
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })
        .format(Number.isFinite(n) ? n : 0);
    }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="rounded-2xl p-4 shadow-sm border">
        <div className="text-xs text-gray-500">Client</div>
        <div className="text-lg font-semibold">{fmt(row.client)}</div>
      </div>
      <div className="rounded-2xl p-4 shadow-sm border">
        <div className="text-xs text-gray-500">Driver</div>
        <div className="text-lg font-semibold">{fmt(row.driver)}</div>
      </div>
      <div className="rounded-2xl p-4 shadow-sm border">
        <div className="text-xs text-gray-500">Restaurant</div>
        <div className="text-lg font-semibold">{fmt(row.restaurant)}</div>
      </div>
      <div className="rounded-2xl p-4 shadow-sm border">
        <div className="text-xs text-gray-500">Plateforme</div>
        <div className="text-lg font-semibold">{fmt(row.platform)}</div>
      </div>

      <div className="col-span-full text-[11px] text-gray-500">
        Maj: {new Date(row.updated_at).toLocaleString()} • Devise: {row.currency || 'USD'}
      </div>
    </div>
  );
}

