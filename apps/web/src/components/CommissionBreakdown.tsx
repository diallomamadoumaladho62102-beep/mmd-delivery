'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseBrowser';

type Row = {
  order_id: string;
  client_fee: number;
  driver_fee: number;
  restaurant_fee: number;
  platform_fee: number;
  currency: string;
  updated_at: string;
};

function toNumber(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function CommissionBreakdown({ orderId }: { orderId: string }) {
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('order_commissions')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();

    if (error) console.error(error);

    setRow(
      data
        ? {
            ...data,
            client_fee: toNumber((data as any).client_fee),
            driver_fee: toNumber((data as any).driver_fee),
            restaurant_fee: toNumber((data as any).restaurant_fee),
            platform_fee: toNumber((data as any).platform_fee),
          }
        : null
    );
    setLoading(false);
  }

  useEffect(() => {
  load();

  const ch = supabase
    .channel('commissions-watch')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_commissions', filter: `order_id=eq.${orderId}` },
      () => { console.log('[realtime] order_commissions change for', orderId); load(); }
    )
    .subscribe();

  return () => { supabase.removeChannel(ch); };
}, [orderId]);

  if (loading) {
    return <div className="text-sm text-gray-500">Chargement des commissions…</div>;
  }

  if (!row) {
    return <div className="text-sm text-gray-500">Pas de données de commission.</div>;
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: row.currency || 'USD' })
      .format(Number.isFinite(n) ? n : 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="rounded-2xl p-4 shadow-sm border">
        <div className="text-xs text-gray-500">Client</div>
        <div className="text-lg font-semibold">{fmt(row.client_fee)}</div>
      </div>
      <div className="rounded-2xl p-4 shadow-sm border">
        <div className="text-xs text-gray-500">Driver</div>
        <div className="text-lg font-semibold">{fmt(row.driver_fee)}</div>
      </div>
      <div className="rounded-2xl p-4 shadow-sm border">
        <div className="text-xs text-gray-500">Restaurant</div>
        <div className="text-lg font-semibold">{fmt(row.restaurant_fee)}</div>
      </div>
      <div className="rounded-2xl p-4 shadow-sm border">
        <div className="text-xs text-gray-500">Plateforme</div>
        <div className="text-lg font-semibold">{fmt(row.platform_fee)}</div>
      </div>
      <div className="col-span-full text-[11px] text-gray-500">
        Maj: {new Date(row.updated_at).toLocaleString()} • Devise: {row.currency}
      </div>
    </div>
  );
}


