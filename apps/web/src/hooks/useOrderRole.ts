'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseBrowser';

export function useOrderRole(orderId: string) {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) { setRole(null); return; }
      const { data } = await supabase
        .from('order_members')
        .select('role')
        .eq('order_id', orderId)
        .eq('user_id', uid)
        .maybeSingle();
      setRole(data?.role ?? null);
    })();
  }, [orderId]);

  return role;
}

