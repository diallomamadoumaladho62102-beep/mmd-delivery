import { supabase } from '../lib/supabaseBrowser';
// Optionnel: si tu veux aussi logger manuellement au lieu d'un trigger SQL
// import { logStatusChange } from '../lib/statusHistory';

export async function updateOrderStatus(orderId: string, newStatus: string, userId: string) {
  // 1) récupérer l'ancien statut
  const { data, error: selErr } = await supabase.from('orders').select('status').eq('id', orderId).single();
  if (selErr) throw selErr;
  const oldStatus = (data?.status as string) ?? null;

  // 2) si pas de changement, on ne fait rien
  if (oldStatus === newStatus) return;

  // 3) mettre à jour la commande
  const { error: updErr } = await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
  if (updErr) throw updErr;

  // 4) Si tu n'utilises PAS le trigger SQL proposé, dé-commente ces lignes:
  // await logStatusChange(orderId, oldStatus, newStatus, userId);
}


