#!/usr/bin/env bash
docker exec supabase_db_MMD-Delivery psql -U postgres -d postgres -c "\df public.mmd_finance_recognize*"
docker exec supabase_db_MMD-Delivery psql -U postgres -d postgres -c "\df public.mmd_finance_enqueue*"
docker exec supabase_db_MMD-Delivery psql -U postgres -d postgres -c "\df public.mmd_finance_refresh*"
docker exec supabase_db_MMD-Delivery psql -U postgres -d postgres -Atc "select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'mmd_finance_%' order by 1;"
docker exec supabase_db_MMD-Delivery psql -U postgres -d postgres -Atc "select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname ilike '%marketing%reserve%' or p.proname ilike '%marketing%capture%' or p.proname ilike '%marketing%release%' or p.proname ilike '%marketing%reverse%' or p.proname ilike '%analytics%refresh%') order by 1;"
