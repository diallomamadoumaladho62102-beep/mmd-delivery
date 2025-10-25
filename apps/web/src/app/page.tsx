'use client';
import { supabase } from '../lib/supabaseBrowser';
export default function Page() {
  async function joinOrder(orderId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const user_id = user.id;

    // 1) Vérifier si déjà membre
    const { data: exists, error: checkErr } = await supabase
      .from('order_members')
      .select('order_id')
      .eq('order_id', orderId)
      .eq('user_id', user_id)
      .limit(1);

    if (checkErr) {
      console.error(checkErr);
      return;
    }
    if (exists && exists.length > 0) {
      // déjà membre → on ignore
      return;
    }

    // 2) Ajouter si pas membre
    const { error } = await supabase
      .from('order_members')
      .insert({ order_id: orderId, user_id });

    if (error) {
      if (error.code === '23505' || /duplicate key/i.test(error.message)) return;
      console.error(error);
    }
  }

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">MMD Delivery</h1>
      <button
        onClick={() => joinOrder('test-order-1')}
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        Activer l’accès au chat
      </button>
      <p className="text-sm text-zinc-500">
        Ensuite va sur <code>/orders/test-order-1/chat</code>.
      </p>
    </main>
  );
}




