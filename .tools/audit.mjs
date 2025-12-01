import { createClient } from '@supabase/supabase-js';

function log(section, status, detail) {
  return { section, status, detail };
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const out = { startedAt: new Date().toISOString(), urlOk: !!url, keyOk: !!key, checks: [] };

if (!url || !key) {
  out.checks.push(log('supabase:init', 'fail', 'URL or KEY missing'));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const s = createClient(url, key);

async function safe(fn, name) {
  try {
    const v = await fn();
    out.checks.push(log(name, 'ok', v));
  } catch (e) {
    out.checks.push(log(name, 'fail', e?.message || String(e)));
  }
}

await safe(async () => {
  const { data, error } = await s.from('orders').select('id,status,currency,subtotal').limit(1);
  if (error) throw new Error(error.message);
  return { sample: data?.[0] || null };
}, 'db:orders');

await safe(async () => {
  const { data, error } = await s.from('order_messages').select('id,image_path,created_at').limit(1);
  if (error) throw new Error(error.message);
  return { sample: data?.[0] || null };
}, 'db:order_messages');

await safe(async () => {
  const { data, error } = await s.from('order_members').select('order_id,user_id,role').limit(1);
  if (error) throw new Error(error.message);
  return { sample: data?.[0] || null };
}, 'db:order_members');

await safe(async () => {
  // Test existence de la RPC join_order (si inexistante, Supabase renvoie une erreur claire)
  const bogus = '00000000-0000-0000-0000-000000000000';
  const { error } = await s.rpc('join_order', { p_order_id: bogus, p_role: 'driver' });
  if (error) {
    // si l'erreur n'est PAS "function not found", on considère que la fonction existe (mauvais id attendu)
    const msg = String(error.message || error);
    return { exists: !/not exist|not found|function .* does not exist/i.test(msg), error: msg };
  }
  return { exists: true };
}, 'rpc:join_order');

await safe(async () => {
  const { data, error } = await s.storage.from('chat-images').list('', { limit: 50 });
  if (error) throw new Error(error.message);
  return { items: (data||[]).map(o => o.name) };
}, 'storage:chat-images:list');

console.log(JSON.stringify(out, null, 2));
