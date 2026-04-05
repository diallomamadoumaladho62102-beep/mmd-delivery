'use client';
import { supabase } from '../lib/supabaseBrowser'; // ✅ chemin corrigé

export default function JoinButton({ orderId }: { orderId: string }) {
  async function join() {
    const { data: { user }, error: uerr } = await supabase.auth.getUser();
    if (uerr || !user) {
      alert('Non connecté');
      return;
    }

    const { error } = await supabase
      .from('order_members')
      .insert({ order_id: orderId, user_id: user.id }); // policies OK

    if (error) alert(error.message);
    else alert('Accès au chat activé ✅');
  }

  return (
    <button
      onClick={join}
      className="px-3 py-2 rounded-lg bg-black text-white hover:bg-gray-800 transition"
    >
      Activer accès chat
    </button>
  );
}


