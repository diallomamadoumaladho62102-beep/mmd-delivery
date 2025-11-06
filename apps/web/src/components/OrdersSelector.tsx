'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseBrowser';

type Order = { id: string; status: string };

export default function OrdersSelector() {
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id,status')
        .order('created_at', { ascending: false })
        .limit(10);
      if (!error && data) setOrders(data);
    })();
  }, []);

  return (
    <div className="p-4 border rounded-xl bg-white shadow-sm space-y-2">
      <h2 className="font-bold">Sélectionne une commande</h2>
      {orders.map((o) => (
        <Link
          key={o.id}
          href={`/orders/${o.id}/chat`}
          className="block text-blue-600 hover:underline"
        >
          {o.status || 'pending'} — {o.id.slice(0, 8)}
        </Link>
      ))}
    </div>
  );
}

