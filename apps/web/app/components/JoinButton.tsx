'use client';

import { useAdminT } from "@/i18n/useAdminT";
import { supabase } from '@/lib/supabaseBrowser'; // ✅ chemin corrigé

export default function JoinButton({ orderId }: { orderId: string }) {
  const { t } = useAdminT();

  async function join() {
    const { data: { user }, error: uerr } = await supabase.auth.getUser();
    if (uerr || !user) {
      alert(t("Non connecté"));
      return;
    }

    const { error } = await supabase
      .from('order_members')
      .insert({ order_id: orderId, user_id: user.id }); // policies OK

    if (error) alert(error.message);
    else alert(t("Accès au chat activé ✅"));
  }

  return (
    <button
      onClick={join}
      className="px-3 py-2 rounded-lg bg-black text-white hover:bg-gray-800 transition"
    >
      {t("Activer accès chat")}
    </button>
  );
}


