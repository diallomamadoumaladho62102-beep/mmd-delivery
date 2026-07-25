-- Manual / CI SQL checks for wallet + webhook idempotency migration.
-- Run after applying 20260920120000_wallet_ledger_webhook_idempotency.sql
-- Does not modify production data beyond SELECT assertions.

begin;

do $$
begin
  if to_regclass('public.wallet_ledger') is null then
    raise exception 'wallet_ledger missing';
  end if;
  if to_regclass('public.payment_webhook_events') is null then
    raise exception 'payment_webhook_events missing';
  end if;
end;
$$;

-- Unique index must exist
select 1 / count(*) as wallet_ledger_idempotency_uidx_ok
from pg_indexes
where schemaname = 'public'
  and indexname = 'wallet_ledger_idempotency_uidx';

-- No remaining duplicate groups
select 1 / case when count(*) = 0 then 1 else 0 end as no_duplicate_idempotency_keys
from (
  select idempotency_key
  from public.wallet_ledger
  group by idempotency_key
  having count(*) > 1
) d;

-- Webhook status constraint values
select 1 / count(*) as webhook_status_column_ok
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payment_webhook_events'
  and column_name = 'status';

rollback;
