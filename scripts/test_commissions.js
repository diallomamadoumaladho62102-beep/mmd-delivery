import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Charger les variables d'environnement depuis apps/web/.env.local
dotenv.config({ path: './apps/web/.env.local' });

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error('❌ Erreur : clés Supabase manquantes dans apps/web/.env.local');
  process.exit(1);
}

// Créer le client Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ID de commande à tester
const orderId = '3a3b6360-aa31-4bb9-aef4-e28229f1200d';

(async () => {
  console.log('🔎 Vérification des commissions pour', orderId, '\n');

  // Lire la vue
  const r1 = await supabase
    .from('v_order_commission_summary')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();

  console.log('💵 Vue (v_order_commission_summary):');
  console.log(r1.data || r1.error, '\n');

  // Lire la table brute
  const r2 = await supabase
    .from('order_commissions')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();

  console.log('🪙 Table (order_commissions):');
  console.log(r2.data || r2.error, '\n');

  console.log('✅ Test terminé.');
})();
