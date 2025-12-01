import { supabase } from '../lib/supabaseBrowser';

export async function logStatusChange(orderId: string, oldStatus: string|null, newStatus: string, userId?: string) {
  await supabase.from('order_status_history').insert({
    order_id: orderId,
    user_id: userId ?? null,
    old_status: oldStatus,
    new_status: newStatus,
  });
}


