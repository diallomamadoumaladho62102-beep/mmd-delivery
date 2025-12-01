'use client';
import { useState } from 'react';

export default function Checkout() {
  const [loading, setLoading] = useState(false);
  const pay = async () => {
    setLoading(true);
    const res = await fetch('/api/orders/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lineItems: [{ price_data: { currency: 'usd', product_data: { name: 'Plat Démo' }, unit_amount: 1500 }, quantity: 1 }],
        successUrl: window.location.origin + '/?success=1',
        cancelUrl: window.location.origin + '/checkout?canceled=1'
      })
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    setLoading(false);
  };
  return (
    <main>
      <h2 className="text-xl font-semibold mb-4">Paiement démo</h2>
      <button onClick={pay} className="px-4 py-2 bg-green-600 text-white rounded" disabled={loading}>
        {loading ? 'Redirection…' : 'Payer $15.00'}
      </button>
    </main>
  );
}


